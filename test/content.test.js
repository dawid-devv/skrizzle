// Prueft die Einhaenge-Logik der Firefox-Erweiterung gegen eine nachgestellte
// YouTube-Struktur. Naechstes Mal, wenn YouTube umbaut: hier die Struktur
// anpassen und sehen, was bricht.

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'firefox', 'content.js'), 'utf8');

let pass = 0;
let fail = 0;

const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${extra ? '  → ' + extra : ''}`); }
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function run(html, url, { dark = false, quiet = true, reply = null } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = () => ({ matches: dark, addEventListener() {}, removeEventListener() {} });
  w.browser = { runtime: { sendMessage: async (m) => {
    w.__sent = m;
    (w.__log = w.__log || []).push(m);
    if (reply) return reply(m);
    return { ok: true };
  } } };
  if (quiet) w.console.log = w.console.warn = w.console.error = () => {};
  w.eval(CODE);
  return dom;
}

const ROW = (likeTag = 'segmented-like-dislike-button-view-model') => `
  <div id="top-level-buttons-computed">
    <${likeTag} id="like"></${likeTag}>
    <yt-button-view-model id="share">Teilen</yt-button-view-model>
    <yt-button-view-model id="save">Speichern</yt-button-view-model>
  </div>`;

const PAGE = `<body><ytd-app><ytd-watch-metadata>
  <div id="above-the-fold"><div id="top-row">
    <div id="owner"><a>Kanal</a></div>
    <div id="actions"><div id="actions-inner"><ytd-menu-renderer>
      ${ROW()}
    </ytd-menu-renderer></div></div>
  </div></div>
</ytd-watch-metadata></ytd-app></body>`;

const WATCH = 'https://www.youtube.com/watch?v=7xZdOoMQ4Nc';

async function main() {
  // --- 1. Platzierung in der fertigen Knopfreihe ---------------------------
  console.log('\n1) Platzierung in der Knopfreihe');
  {
    const dom = run(PAGE, WATCH);
    const host = dom.window.document.getElementById('skrizzle-host');

    ok('Knopf wurde eingehängt', Boolean(host));
    ok('liegt in der Knopfreihe', host && host.parentElement.id === 'top-level-buttons-computed',
      host && host.parentElement.id);
    ok('steht direkt hinter "Gefällt mir"', host && host.previousElementSibling.id === 'like',
      host && host.previousElementSibling && host.previousElementSibling.id);
    ok('steht direkt vor "Teilen"', host && host.nextElementSibling.id === 'share',
      host && host.nextElementSibling && host.nextElementSibling.id);
    const menu = dom.window.document.querySelector('.skrizzle-menu');
    ok('Menü hat vier Qualitätsstufen',
      menu && menu.querySelectorAll('.skrizzle-item').length === 4);
    ok('Menü hängt am Seitenkörper, nicht im Knopf — sonst schneidet YouTube es ab',
      menu && menu.parentElement === dom.window.document.body,
      menu && menu.parentElement && menu.parentElement.tagName);
    ok('Menü startet zugeklappt', menu && menu.hidden);
    ok('nicht freischwebend', host && !host.classList.contains('skrizzle-floating'));
    dom.window.close();
  }

  // --- 2. Helligkeit messen ------------------------------------------------
  console.log('\n2) Farbwahl nach gemessener Helligkeit');
  {
    const mk = (bg) => `<body><ytd-app style="background-color: ${bg}">
      <ytd-watch-metadata>${ROW('like-button-view-model')}</ytd-watch-metadata></ytd-app></body>`;

    const d1 = run(mk('rgb(15, 15, 15)'), WATCH);
    const h1 = d1.window.document.getElementById('skrizzle-host');
    ok('dunkle Seite → skrizzle-dark', h1 && h1.classList.contains('skrizzle-dark'), h1 && h1.className);
    d1.window.close();

    const d2 = run(mk('rgb(255, 255, 255)'), WATCH);
    const h2 = d2.window.document.getElementById('skrizzle-host');
    ok('helle Seite → skrizzle-light', h2 && h2.classList.contains('skrizzle-light'), h2 && h2.className);
    d2.window.close();
  }

  // --- 3. Rueckfaelle ------------------------------------------------------
  console.log('\n3) Rückfälle, wenn YouTube umbaut');
  {
    const d1 = run(`<body><ytd-app><ytd-watch-metadata>
      <div id="actions"><yt-button-view-model id="share">Teilen</yt-button-view-model></div>
    </ytd-watch-metadata></ytd-app></body>`, WATCH);
    const h1 = d1.window.document.getElementById('skrizzle-host');
    ok('ohne Gefällt-mir: in den Aktionsbereich', h1 && h1.parentElement.id === 'actions',
      h1 && h1.parentElement.id);
    ok('dort hinten angehängt, nicht vorn', h1 && h1.previousElementSibling.id === 'share');
    d1.window.close();

    const d2 = run('<body><ytd-app><div>nichts bekanntes</div></ytd-app></body>', WATCH);
    const h2 = d2.window.document.getElementById('skrizzle-host');
    ok('völlig fremdes DOM: freischwebend', h2 && h2.classList.contains('skrizzle-floating'));
    ok('und überhaupt vorhanden', Boolean(h2));
    d2.window.close();
  }

  // --- 4. Nur auf Videoseiten ---------------------------------------------
  console.log('\n4) Nur auf Videoseiten');
  {
    const d1 = run(PAGE, 'https://www.youtube.com/');
    ok('Startseite: kein Knopf', !d1.window.document.getElementById('skrizzle-host'));
    d1.window.close();

    const d2 = run(PAGE, 'https://www.youtube.com/results?search_query=test');
    ok('Suchergebnisse: kein Knopf', !d2.window.document.getElementById('skrizzle-host'));
    d2.window.close();
  }

  // --- 5. Nachricht an den Hintergrundteil ---------------------------------
  console.log('\n5) Nachricht an den Hintergrundteil');
  {
    const dom = run(PAGE, 'https://www.youtube.com/watch?v=7xZdOoMQ4Nc&list=PLabc&t=320s');
    const w = dom.window;
    w.document.querySelectorAll('.skrizzle-item')[3]
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(30);

    ok('Typ stimmt', w.__sent && w.__sent.type === 'download');
    ok('Qualität durchgereicht (4. Eintrag = audio)', w.__sent && w.__sent.format === 'audio',
      w.__sent && w.__sent.format);
    ok('Link gekürzt — keine Playlist, keine Zeitmarke',
      w.__sent && w.__sent.url === 'https://www.youtube.com/watch?v=7xZdOoMQ4Nc',
      w.__sent && w.__sent.url);
    w.close();
  }

  // --- 6. Knopfreihe entsteht erst spaeter ---------------------------------
  console.log('\n6) Knopfreihe entsteht verzögert (der eigentliche Stolperstein)');
  {
    const dom = run('<body><ytd-app></ytd-app></body>', WATCH);
    const w = dom.window;
    const d = w.document;

    const before = d.getElementById('skrizzle-host');
    ok('zunächst freischwebend statt gar nicht',
      before && before.classList.contains('skrizzle-floating'));

    // Jetzt baut YouTube die Knopfreihe nach.
    const meta = d.createElement('ytd-watch-metadata');
    meta.innerHTML = ROW();
    d.querySelector('ytd-app').append(meta);

    await wait(800);

    const after = d.getElementById('skrizzle-host');
    ok('wird in die Knopfreihe umgehängt',
      after && after.parentElement.id === 'top-level-buttons-computed',
      after && after.parentElement && after.parentElement.id);
    ok('hängt nicht mehr frei', after && !after.classList.contains('skrizzle-floating'));
    ok('steht hinter "Gefällt mir"', after && after.previousElementSibling.id === 'like');
    ok('existiert genau einmal', d.querySelectorAll('#skrizzle-host').length === 1,
      String(d.querySelectorAll('#skrizzle-host').length));
    w.close();
  }

  // --- 7. Knopf wird von YouTube entfernt ----------------------------------
  console.log('\n7) YouTube wirft den Knopf raus');
  {
    const dom = run(PAGE, WATCH);
    const w = dom.window;
    const d = w.document;

    d.getElementById('skrizzle-host').remove();
    ok('Ausgangslage: Knopf weg', !d.getElementById('skrizzle-host'));

    await wait(1400);
    const back = d.getElementById('skrizzle-host');
    ok('kommt von selbst zurück', Boolean(back));
    ok('und zwar an der richtigen Stelle',
      back && back.parentElement.id === 'top-level-buttons-computed');
    w.close();
  }

  // --- 8. Menue auf- und zuklappen -----------------------------------------
  console.log('\n8) Menü auf- und zuklappen');
  {
    const dom = run(PAGE, WATCH);
    const w = dom.window;
    const d = w.document;
    const btn = d.querySelector('.skrizzle-btn');
    const menu = d.querySelector('.skrizzle-menu');

    const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

    ok('Ausgangslage: zu', menu.hidden);

    click(btn);
    ok('Klick auf den Knopf klappt auf', !menu.hidden);

    click(btn);
    ok('zweiter Klick klappt wieder zu', menu.hidden);

    click(btn);
    click(d.body);
    ok('Klick daneben schließt', menu.hidden);

    click(btn);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok('Escape schließt', menu.hidden);
    w.close();
  }

  // --- 9. Keine herrenlosen Menues ------------------------------------------
  console.log('\n9) Keine herrenlosen Menüs beim Umhängen');
  {
    const dom = run('<body><ytd-app></ytd-app></body>', WATCH);
    const w = dom.window;
    const d = w.document;

    ok('freischwebend: genau ein Menü', d.querySelectorAll('.skrizzle-menu').length === 1,
      String(d.querySelectorAll('.skrizzle-menu').length));

    const meta = d.createElement('ytd-watch-metadata');
    meta.innerHTML = ROW();
    d.querySelector('ytd-app').append(meta);
    await wait(800);

    ok('nach dem Umhängen immer noch genau eins',
      d.querySelectorAll('.skrizzle-menu').length === 1,
      String(d.querySelectorAll('.skrizzle-menu').length));

    const menu = d.querySelector('.skrizzle-menu');
    const btn = d.querySelector('.skrizzle-btn');
    btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    ok('das verbliebene Menü gehört zum neuen Knopf und klappt auf', !menu.hidden);
    w.close();
  }

  // --- 10. Fortschritt im Knopf --------------------------------------------
  console.log('\n10) Fortschritt auf dem Knopf');
  {
    // Die App antwortet in dieser Reihenfolge.
    const stands = [
      { ok: true, state: 'queued', percent: null },
      { ok: true, state: 'running', percent: 0.25 },
      { ok: true, state: 'running', percent: 0.8 },
      { ok: true, state: 'running', percent: null, stage: 'Zusammenfügen …' },
      { ok: true, state: 'done', percent: 1 },
    ];
    let n = 0;

    const dom = run(PAGE, WATCH, {
      reply: (m) => {
        if (m.type === 'download') return { ok: true, id: 7 };
        if (m.type === 'status') return stands[Math.min(n++, stands.length - 1)];
        return { ok: true };
      },
    });

    const w = dom.window;
    const d = w.document;
    const label = d.querySelector('.skrizzle-label');
    const host = d.getElementById('skrizzle-host');

    // Beschriftung mitschreiben
    const seen = [];
    const watcher = setInterval(() => {
      const t = label.textContent;
      if (seen[seen.length - 1] !== t) seen.push(t);
    }, 50);

    d.querySelectorAll('.skrizzle-item')[0]
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

    await wait(4200);
    clearInterval(watcher);

    ok('Auftragsnummer wird abgefragt',
      (w.__log || []).some((m) => m.type === 'status' && m.id === 7));
    ok('zeigt zwischendurch Prozente', seen.includes('25 %') && seen.includes('80 %'),
      seen.join(' → '));
    ok('zeigt die Nachbearbeitung', seen.includes('Abschluss'), seen.join(' → '));
    ok('endet mit "Fertig!"', seen.includes('Fertig!'), seen.join(' → '));
    ok('Füllstand wurde gesetzt und wieder geräumt',
      host.style.getPropertyValue('--sk-progress') === '',
      host.style.getPropertyValue('--sk-progress'));
    ok('hört nach dem Ende auf zu fragen',
      (w.__log || []).filter((m) => m.type === 'status').length <= stands.length,
      String((w.__log || []).filter((m) => m.type === 'status').length));
    w.close();
  }

  // --- 11. Fehler aus der App landen auf dem Knopf --------------------------
  console.log('\n11) Fehlermeldung durchreichen');
  {
    const dom = run(PAGE, WATCH, {
      reply: (m) => (m.type === 'download'
        ? { ok: false, error: 'Skrizzle antwortet nicht auf Port 7337' }
        : { ok: true }),
    });
    const w = dom.window;
    const d = w.document;

    d.querySelectorAll('.skrizzle-item')[0]
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(60);

    ok('Fehlertext steht auf dem Knopf',
      d.querySelector('.skrizzle-label').textContent === 'Skrizzle antwortet nicht auf Port 7337',
      d.querySelector('.skrizzle-label').textContent);
    ok('und ist als Fehler gekennzeichnet',
      d.getElementById('skrizzle-host').classList.contains('is-err'));
    w.close();
  }

  // --- 12. Knopfbreite bleibt stabil ---------------------------------------
  console.log('\n12) Keine springende Knopfbreite');
  {
    // content.css gibt dem Text feste 10ch. Laengere Texte sprengen das und
    // wuerden YouTubes Knopfreihe bei jedem Schritt verschieben.
    const BUDGET = 10;

    const stands = [
      { ok: true, state: 'queued', percent: null },
      { ok: true, state: 'running', percent: 0 },
      { ok: true, state: 'running', percent: 0.07 },
      { ok: true, state: 'running', percent: 1 },
      { ok: true, state: 'running', percent: null, stage: 'Zusammenfügen …' },
      { ok: true, state: 'done', percent: 1 },
    ];
    let n = 0;

    const dom = run(PAGE, WATCH, {
      reply: (m) => (m.type === 'download'
        ? { ok: true, id: 3 }
        : stands[Math.min(n++, stands.length - 1)]),
    });

    const w = dom.window;
    const d = w.document;
    const label = d.querySelector('.skrizzle-label');

    const seen = ['Laden'];
    const watcher = setInterval(() => {
      const t = label.textContent;
      if (seen[seen.length - 1] !== t) seen.push(t);
    }, 40);

    d.querySelectorAll('.skrizzle-item')[0]
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await wait(4600);
    clearInterval(watcher);

    const tooLong = seen.filter((t) => t.length > BUDGET);
    ok(`alle regulären Texte ≤ ${BUDGET} Zeichen`, tooLong.length === 0,
      tooLong.length ? tooLong.map((t) => `"${t}" (${t.length})`).join(', ') : '');
    ok('Ablauf vollständig durchlaufen', seen.includes('Fertig!'), seen.join(' → '));
    console.log(`       gesehen: ${seen.join(' → ')}`);

    const btn = d.querySelector('.skrizzle-btn');
    ok('langer App-Wortlaut steckt im Tooltip, nicht im Knopf',
      btn.title === 'Zusammenfügen …' || seen.includes('Abschluss'), btn.title);
    w.close();
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
}

main();
