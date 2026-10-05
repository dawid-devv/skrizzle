'use strict';

const FORMATS = [
  { id: 'best', label: 'Beste — überall abspielbar' },
  { id: 'max', label: 'Maximum — bis 4K' },
  { id: '720', label: '720p — kleine Datei' },
  { id: 'audio', label: 'Nur Ton — MP3' },
];

const HOST_ID = 'skrizzle-host';

// Sichtbar im Web-Konsolen-Tab der YouTube-Seite. Beim Einrichten und bei
// jedem spaeteren YouTube-Umbau ist das die erste Anlaufstelle.
const log = (msg, kind = 'log') => console[kind](`[Skrizzle] ${msg}`);

// Verlaesslichster Anker ist der Gefaellt-mir-Knopf selbst: daneben gehoert
// unserer hin. Container-IDs benennt YouTube regelmaessig um, die Knoepfe nicht.
const LIKE_SELECTORS = [
  'ytd-watch-metadata segmented-like-dislike-button-view-model',
  'ytd-watch-metadata like-button-view-model',
  'ytd-watch-metadata ytd-segmented-like-dislike-button-renderer',
  'ytd-watch-metadata ytd-toggle-button-renderer',
];

// Nur als Rueckfall, wenn kein Gefaellt-mir-Knopf zu finden ist.
const SLOTS = [
  'ytd-watch-metadata #top-level-buttons-computed',
  'ytd-watch-metadata #actions-inner',
  'ytd-watch-metadata #actions',
  '#above-the-fold #top-row',
];

/** Sauberer Link ohne Playlist, Zeitmarke und Verweisparameter. */
function videoUrl() {
  if (!location.pathname.startsWith('/watch')) return null;
  const v = new URL(location.href).searchParams.get('v');
  return v ? `https://www.youtube.com/watch?v=${v}` : null;
}

function findSlot() {
  for (const sel of SLOTS) {
    const node = document.querySelector(sel);
    if (node) return node;
  }
  return null;
}

/**
 * Sucht den Gefaellt-mir-Knopf und liefert die Knopfreihe samt dem direkten
 * Kind, hinter das unser Knopf gehoert.
 */
function findAnchor() {
  for (const sel of LIKE_SELECTORS) {
    const node = document.querySelector(sel);
    if (!node) continue;

    const row = node.closest('#top-level-buttons-computed') || node.parentElement;
    if (!row) continue;

    // Vom Knopf aus hoch bis zum direkten Kind der Reihe.
    let child = node;
    while (child.parentElement && child.parentElement !== row) child = child.parentElement;
    if (child.parentElement === row) return { row, after: child };
  }
  return null;
}

/**
 * YouTubes Dunkelmodus laesst sich nicht zuverlaessig an einem Attribut
 * ablesen. Darum messen wir die tatsaechliche Hintergrundhelligkeit.
 */
function isDark() {
  const probe = document.querySelector('ytd-app') || document.body;
  const parts = getComputedStyle(probe).backgroundColor.match(/[\d.]+/g);
  if (!parts || parts.length < 3) {
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }
  const [r, g, b, a] = parts.map(Number);
  // Durchsichtiger Hintergrund verraet nichts — dann die Systemeinstellung.
  if (a === 0) return matchMedia('(prefers-color-scheme: dark)').matches;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128;
}

function arrowIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'skrizzle-icon');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M8 1.5v7.4M4.7 6.2 8 9.5l3.3-3.3M2.5 12.5h11');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.6');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

let resetTimer = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fuellstand des Knopfes; null nimmt die Fuellung wieder weg. */
function setProgress(host, percent) {
  if (percent == null) host.style.removeProperty('--sk-progress');
  else host.style.setProperty('--sk-progress', `${Math.round(percent * 100)}%`);
}

function setState(host, text, kind, holdMs = 4000, full = null) {
  const label = host.querySelector('.skrizzle-label');
  const btn = host.querySelector('.skrizzle-btn');
  if (!label) return;

  label.textContent = text;
  // Gekuerzte Fehlermeldungen bleiben so beim Darueberfahren lesbar.
  if (btn) btn.title = kind ? (full || text) : 'Mit Skrizzle laden';
  host.classList.remove('is-ok', 'is-err', 'is-busy');
  if (kind) host.classList.add(`is-${kind}`);

  clearTimeout(resetTimer);
  if (kind === 'ok' || kind === 'err') {
    resetTimer = setTimeout(() => {
      setProgress(host, null);
      setState(host, 'Laden', null);
    }, holdMs);
  }
}

/**
 * Uebersetzt den Stand aus der App in die Knopfbeschriftung. Bewusst kurz:
 * der Knopf hat eine feste Breite, damit er YouTubes Reihe nicht verschiebt.
 * Die ausfuehrliche Fassung steht im Tooltip und im App-Fenster.
 */
function describe(job) {
  switch (job.state) {
    case 'queued': return { text: 'Wartet', kind: 'busy' };
    case 'done': return { text: 'Fertig!', kind: 'ok' };
    case 'error': return { text: job.error || 'Fehlgeschlagen', kind: 'err', full: job.error };
    case 'cancelled': return { text: 'Abgebrochen', kind: 'err' };
    default:
      if (job.percent != null) return { text: `${Math.round(job.percent * 100)} %`, kind: 'busy' };
      // Nachbearbeitung: ein fester kurzer Begriff statt des App-Wortlauts,
      // sonst haengt die Knopfbreite an einer Formulierung woanders.
      if (job.stage) return { text: 'Abschluss', kind: 'busy', full: job.stage };
      return { text: 'Lädt', kind: 'busy' };
  }
}

const FINAL = ['done', 'error', 'cancelled'];

/** Fragt den Stand ab, bis der Auftrag durch ist oder der Knopf verschwindet. */
async function track(host, id) {
  for (;;) {
    await sleep(600);
    // Beim Seitenwechsel oder Umhaengen hoert die Verfolgung von selbst auf.
    if (!host.isConnected) return;

    let res;
    try {
      res = await browser.runtime.sendMessage({ type: 'status', id });
    } catch {
      setState(host, 'Erweiterung nicht erreichbar', 'err');
      return;
    }

    if (!res || !res.ok) {
      setState(host, (res && res.error) || 'Stand unbekannt', 'err');
      return;
    }

    const { text, kind, full } = describe(res);
    setProgress(host, res.state === 'running' ? res.percent : null);
    setState(host, text, kind, res.state === 'done' ? 6000 : 4000, full);

    if (FINAL.includes(res.state)) {
      log(`Auftrag ${id}: ${res.state}`);
      return;
    }
  }
}

async function send(host, format) {
  const url = videoUrl();
  if (!url) return;

  setProgress(host, null);
  setState(host, 'Sende', 'busy');

  let res;
  try {
    res = await browser.runtime.sendMessage({ type: 'download', url, format });
  } catch {
    setState(host, 'Erweiterung nicht erreichbar', 'err');
    return;
  }

  if (!res || !res.ok) {
    setState(host, (res && res.error) || 'Fehlgeschlagen', 'err');
    return;
  }

  setState(host, 'Wartet', 'busy');

  // Ohne Auftragsnummer bleibt nur die Bestaetigung ohne Fortschritt.
  if (res.id == null) {
    setState(host, 'In Warteschlange', 'ok');
    return;
  }
  track(host, res.id);
}

// Das Menue haengt am Seitenkoerper, nicht im Knopf: YouTubes Knopfreihe
// beschneidet ueberstehende Inhalte, und dann klappt es unsichtbar auf.
let openHost = null;

function menuOf(host) {
  return host && host.__skrizzleMenu;
}

function closeMenu() {
  const menu = menuOf(openHost);
  if (menu) menu.hidden = true;
  openHost = null;
}

/** Legt das Menue unter den Knopf, ohne ueber den Fensterrand zu laufen. */
function placeMenu(host) {
  const menu = menuOf(host);
  if (!menu) return;

  menu.hidden = false; // erst sichtbar, sonst ist die Breite 0
  const r = host.getBoundingClientRect();
  const width = menu.offsetWidth;

  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${r.bottom + 6}px`;
}

function toggleMenu(host) {
  if (openHost === host && !menuOf(host).hidden) {
    closeMenu();
    return;
  }
  closeMenu();
  openHost = host;
  placeMenu(host);
}

/** Knopf samt zugehoerigem Menue entfernen — sonst bleiben Menues liegen. */
function destroy(host) {
  if (!host) return;
  if (openHost === host) openHost = null;
  const menu = menuOf(host);
  if (menu) menu.remove();
  host.remove();
}

function build() {
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.className = `skrizzle-host ${isDark() ? 'skrizzle-dark' : 'skrizzle-light'}`;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'skrizzle-btn';
  btn.title = 'Mit Skrizzle laden';

  const label = document.createElement('span');
  label.className = 'skrizzle-label';
  label.textContent = 'Laden';

  const caret = document.createElement('span');
  caret.className = 'skrizzle-caret';
  caret.textContent = '▾';

  btn.append(arrowIcon(), label, caret);

  const menu = document.createElement('div');
  menu.className = `skrizzle-menu ${isDark() ? 'skrizzle-dark' : 'skrizzle-light'}`;
  menu.hidden = true;

  for (const f of FORMATS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'skrizzle-item';
    item.textContent = f.label;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeMenu();
      log(`Qualität gewählt: ${f.id}`);
      send(host, f.id);
    });
    menu.append(item);
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggleMenu(host);
  });

  host.__skrizzleMenu = menu;
  host.append(btn);
  document.body.append(menu);
  return host;
}

/** Beste gerade erreichbare Stelle. */
function placement() {
  const anchor = findAnchor();
  if (anchor) return { kind: 'anchor', anchor };

  const slot = findSlot();
  if (slot) return { kind: 'slot', slot };

  return { kind: 'floating' };
}

/**
 * Haengt den Knopf ein und liefert, wo er gelandet ist:
 * 'none' | 'anchor' | 'slot' | 'floating'.
 * Sitzt er freischwebend und taucht spaeter eine richtige Stelle auf,
 * wird er dorthin umgehaengt — YouTube baut die Knopfreihe oft verzoegert.
 */
function mount() {
  const existing = document.getElementById(HOST_ID);

  if (!videoUrl()) {
    if (existing) {
      destroy(existing);
      log('keine Videoseite — Knopf entfernt');
    }
    return 'none';
  }

  const place = placement();

  if (existing) {
    const floating = existing.classList.contains('skrizzle-floating');
    if (!floating) return 'placed';
    if (place.kind === 'floating') return 'floating';
    destroy(existing);
    log(`bessere Stelle gefunden (${place.kind}) — Knopf wird umgehängt`);
  }

  const host = build();

  if (place.kind === 'anchor') {
    place.anchor.row.insertBefore(host, place.anchor.after.nextSibling);
  } else if (place.kind === 'slot') {
    place.slot.append(host);
  } else {
    host.classList.add('skrizzle-floating');
    document.body.append(host);
    log('keine bekannte Stelle im Menü gefunden — Knopf hängt oben rechts', 'warn');
  }

  if (place.kind !== 'floating') log(`Knopf eingehängt (${place.kind})`);
  return place.kind;
}

/** YouTube laedt Seiten ohne Neuladen; die Knopfreihe entsteht oft verzoegert. */
function mountWithRetries() {
  let tries = 0;
  const tick = () => {
    tries += 1;
    let where;
    try {
      where = mount();
    } catch (err) {
      log(`Einhängen fehlgeschlagen: ${err.message}`, 'error');
      return;
    }
    // Nur freischwebend untergekommen? Dann lohnt ein weiterer Versuch.
    if (where === 'floating' && tries < 30) setTimeout(tick, 500);
  };
  tick();
}

// Einmalig, nicht pro Knopf: sonst sammeln sich die Zuhoerer an.
document.addEventListener('click', closeMenu);
window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

document.addEventListener('yt-navigate-finish', mountWithRetries);
window.addEventListener('popstate', mountWithRetries);

// Rueckfall, falls das YouTube-Ereignis einmal ausbleibt.
let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    mountWithRetries();
    return;
  }
  if (!videoUrl()) return;

  const host = document.getElementById(HOST_ID);

  // YouTube baut die Knopfreihe gelegentlich neu und wirft uns dabei raus.
  if (!host) return mountWithRetries();

  // Oder die Reihe ist inzwischen da, waehrend wir noch frei hängen.
  if (host.classList.contains('skrizzle-floating')) {
    try {
      mount();
    } catch (err) {
      log(`Umhängen fehlgeschlagen: ${err.message}`, 'error');
    }
  }
  return undefined;
}, 1000);

try {
  log(`geladen auf ${location.pathname}`);
  mountWithRetries();
} catch (err) {
  log(`Start fehlgeschlagen: ${err.message}`, 'error');
}
