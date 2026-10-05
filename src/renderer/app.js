'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  url: $('url'),
  go: $('go'),
  folder: $('folder'),
  folderValue: $('folder-value'),
  format: $('format'),
  playlist: $('playlist'),
  queue: $('queue'),
  empty: $('empty'),
  clear: $('clear'),
  openFolder: $('open-folder'),
  status: $('status'),
  setup: $('setup'),
  setupTitle: $('setup-title'),
  setupBody: $('setup-body'),
  setupActions: $('setup-actions'),
};

const rows = new Map(); // job.id -> { li, refs }
let bins = null;

// --- Formatierung ---------------------------------------------------------

function bytes(n) {
  if (n == null) return '';
  const units = ['B', 'kB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function speed(n) {
  return n == null ? '' : `${bytes(n)}/s`;
}

function clock(sec) {
  if (sec == null) return '';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${two(m % 60)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

const STATE_TEXT = {
  queued: 'Wartet',
  running: 'Lädt',
  done: 'Fertig',
  error: 'Fehler',
  cancelled: 'Abgebrochen',
};

// --- Warteschlange zeichnen ----------------------------------------------

function makeRow(job) {
  const li = document.createElement('li');
  li.className = 'job';

  const top = document.createElement('div');
  top.className = 'job-top';
  const title = document.createElement('span');
  title.className = 'job-title';
  const pct = document.createElement('span');
  pct.className = 'job-pct';
  top.append(title, pct);

  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('i');
  bar.append(fill);

  const meta = document.createElement('div');
  meta.className = 'job-meta';
  const msg = document.createElement('span');
  msg.className = 'msg';
  const grow = document.createElement('span');
  grow.className = 'grow';
  const openBtn = document.createElement('button');
  openBtn.className = 'ghost';
  openBtn.textContent = 'Öffnen';
  openBtn.hidden = true;
  const action = document.createElement('button');
  action.className = 'ghost';
  meta.append(msg, grow, openBtn, action);

  li.append(top, bar, meta);
  el.queue.append(li);

  const refs = { title, pct, fill, msg, openBtn, action };
  rows.set(job.id, { li, refs });
  return rows.get(job.id);
}

function renderJob(job) {
  const row = rows.get(job.id) || makeRow(job);
  const { li, refs } = row;

  li.className = `job ${job.state}`;
  refs.title.textContent = job.title || job.url;
  refs.title.title = job.url;

  const running = job.state === 'running';
  const known = job.percent != null;

  if (running && !known) li.classList.add('indeterminate');

  if (job.state === 'done') {
    refs.fill.style.width = '100%';
    refs.pct.textContent = '';
  } else if (known) {
    refs.fill.style.width = `${(job.percent * 100).toFixed(1)}%`;
    refs.pct.textContent = `${Math.round(job.percent * 100)} %`;
  } else {
    refs.pct.textContent = '';
    if (!running) refs.fill.style.width = '0';
  }

  // Mittlere Zeile: Status, Tempo, Restzeit oder Fehlermeldung
  if (job.state === 'error') {
    refs.msg.textContent = job.error || 'Fehlgeschlagen';
  } else if (job.state === 'done') {
    refs.msg.textContent = 'Fertig';
  } else if (job.state === 'cancelled') {
    refs.msg.textContent = 'Abgebrochen';
  } else if (running) {
    const parts = [job.stage || STATE_TEXT.running];
    if (job.total) parts.push(`${bytes(job.downloaded)} / ${bytes(job.total)}`);
    if (job.speed) parts.push(speed(job.speed));
    if (job.eta) parts.push(`noch ${clock(job.eta)}`);
    refs.msg.textContent = parts.join(' · ');
  } else {
    refs.msg.textContent = STATE_TEXT[job.state] || '';
  }

  // Rechter Knopf wechselt mit dem Zustand
  const act = refs.action;
  act.onclick = null;

  const canOpen = job.state === 'done' && Boolean(job.path);
  refs.openBtn.hidden = !canOpen;
  refs.openBtn.onclick = canOpen ? async () => {
    const problem = await window.api.open(job.path);
    if (problem) refs.msg.textContent = problem;
  } : null;

  if (job.state === 'done') {
    act.hidden = false;
    act.textContent = 'Im Finder zeigen';
    act.onclick = () => window.api.reveal(job.path);
  } else if (job.state === 'running' || job.state === 'queued') {
    act.hidden = false;
    act.textContent = 'Abbrechen';
    act.onclick = () => window.api.cancel(job.id);
  } else {
    act.hidden = true;
  }

  el.empty.hidden = rows.size > 0;
}

// --- Einrichtung ----------------------------------------------------------

function button(label, primary, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  if (primary) b.className = 'primary';
  b.onclick = onClick;
  return b;
}

function renderSetup() {
  el.setupActions.replaceChildren();

  if (!bins.ytdlp.path) {
    el.setup.hidden = false;
    el.setupTitle.textContent = 'yt-dlp fehlt';
    el.setupBody.textContent = 'Das Programm, das die Videos holt. Ich kann es automatisch laden (etwa 30 MB).';
    el.setupActions.append(button('Jetzt laden', true, async () => {
      el.setupBody.textContent = 'Lädt …';
      el.setupActions.replaceChildren();
      try {
        bins = await window.api.installYtdlp();
        renderSetup();
      } catch (err) {
        el.setupBody.textContent = `Fehlgeschlagen: ${err.message}`;
      }
    }));
    el.go.disabled = true;
    return;
  }

  el.go.disabled = false;

  if (!bins.ffmpeg.path) {
    el.setup.hidden = false;
    el.setupTitle.textContent = 'ffmpeg fehlt — Qualität begrenzt';
    el.setupBody.textContent = 'Ohne ffmpeg lässt sich Bild und Ton nicht zusammenfügen. '
      + 'Es wird nur eine fertige Einzeldatei geladen, bei YouTube meist 720p. '
      + 'Im Terminal: brew install ffmpeg';
    el.setupActions.append(button('ffmpeg auswählen …', false, async () => {
      try {
        const next = await window.api.pickFfmpeg();
        if (next) { bins = next; renderSetup(); }
      } catch (err) {
        el.setupBody.textContent = err.message;
      }
    }));
    el.setupActions.append(button('Erneut suchen', false, async () => {
      bins = await window.api.probe();
      renderSetup();
    }));
    return;
  }

  el.setup.hidden = true;
  el.status.textContent = `yt-dlp ${bins.ytdlp.version || '?'}`;
}

// --- Verdrahtung ----------------------------------------------------------

async function submit() {
  const text = el.url.value.trim();
  if (!text) return;
  el.url.value = '';
  const added = await window.api.add(text);
  added.forEach(renderJob);
}

el.go.onclick = submit;
el.url.onkeydown = (e) => { if (e.key === 'Enter') submit(); };

el.folder.onclick = async () => {
  const next = await window.api.pickFolder();
  if (next) el.folderValue.textContent = next.downloadDir;
};

el.format.onchange = () => window.api.setSettings({ format: el.format.value });
el.playlist.onchange = () => window.api.setSettings({ playlist: el.playlist.checked });
el.openFolder.onclick = () => window.api.openFolder();

el.clear.onclick = async () => {
  const remaining = await window.api.clearFinished();
  const keep = new Set(remaining.map((j) => j.id));
  for (const [id, row] of rows) {
    if (!keep.has(id)) { row.li.remove(); rows.delete(id); }
  }
  el.empty.hidden = rows.size > 0;
};

window.api.onJobUpdate(renderJob);
window.api.onJobAdded(renderJob);


// --- Kopplung mit der Firefox-Erweiterung --------------------------------

const srv = {
  dot: $('srv-dot'),
  label: $('srv-label'),
  on: $('srv-on'),
  port: $('srv-port'),
  token: $('srv-token'),
  copy: $('srv-copy'),
  neu: $('srv-new'),
  msg: $('srv-msg'),
};

let msgTimer = null;

function note(text, kind = '') {
  srv.msg.textContent = text;
  srv.msg.className = `hint ${kind}`;
  clearTimeout(msgTimer);
  if (text) msgTimer = setTimeout(() => { srv.msg.textContent = ''; }, 4000);
}

function renderServer(state) {
  srv.on.checked = Boolean(state.enabled);
  srv.token.value = state.token || '';

  if (state.error) {
    srv.dot.className = 'dot off';
    srv.label.textContent = state.error;
    return;
  }
  if (state.running) {
    srv.dot.className = 'dot on';
    srv.label.textContent = `127.0.0.1:${state.port}`;
    // Der tatsaechliche Port kann abweichen, wenn der gewuenschte belegt war.
    if (document.activeElement !== srv.port) srv.port.value = state.port;
  } else {
    srv.dot.className = 'dot';
    srv.label.textContent = 'aus';
  }
}

srv.on.onchange = async () => {
  renderServer(await window.api.serverSetEnabled(srv.on.checked));
};

async function applyPort() {
  try {
    renderServer(await window.api.serverSetPort(srv.port.value));
    note('Port übernommen', 'ok');
  } catch (err) {
    note(err.message, 'warn');
  }
}

srv.port.onkeydown = (e) => { if (e.key === 'Enter') srv.port.blur(); };
srv.port.onblur = applyPort;

srv.copy.onclick = async () => {
  const state = await window.api.serverState();
  await window.api.copy(`Port: ${state.port}\nToken: ${state.token}`);
  note('In die Zwischenablage kopiert', 'ok');
};

srv.neu.onclick = async () => {
  renderServer(await window.api.serverNewToken());
  note('Neuer Token — in der Erweiterung ebenfalls eintragen', 'warn');
};

(async function init() {
  const cfg = await window.api.getSettings();
  el.folderValue.textContent = cfg.downloadDir;
  el.format.value = cfg.format;
  el.playlist.checked = cfg.playlist;

  bins = await window.api.probe();
  renderSetup();

  renderServer(await window.api.serverState());

  el.url.focus();
}());
