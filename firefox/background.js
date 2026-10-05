'use strict';

// Der Hintergrundteil redet mit der App. Der Inhaltsskript-Teil auf der
// YouTube-Seite darf das nicht selbst tun: dort gilt die CSP der Seite,
// und der Token hat auf einer fremden Seite nichts zu suchen.

const DEFAULTS = { port: 7337, token: '' };

async function config() {
  const c = await browser.storage.local.get(DEFAULTS);
  return { port: Number(c.port) || DEFAULTS.port, token: String(c.token || '') };
}

async function call(path, body) {
  const { port, token } = await config();

  if (!token) {
    return { ok: false, error: 'Kein Token — bitte in den Einstellungen eintragen' };
  }

  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Skrizzle-Token': token,
      },
      body: JSON.stringify(body || {}),
    });
  } catch {
    // Kein Server erreichbar: App zu, oder anderer Port.
    return { ok: false, error: `Skrizzle antwortet nicht auf Port ${port}` };
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* leere oder unlesbare Antwort */
  }

  if (res.status === 401) return { ok: false, error: 'Token stimmt nicht' };
  if (!res.ok) return { ok: false, error: data.error || `Fehler ${res.status}` };

  return { ok: true, ...data };
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'download') {
    return call('/add', { url: msg.url, format: msg.format });
  }
  if (msg?.type === 'status') {
    return call('/job', { id: msg.id });
  }
  if (msg?.type === 'ping') {
    return call('/ping', {});
  }
  return Promise.resolve({ ok: false, error: 'Unbekannte Anfrage' });
});
