'use strict';

const $ = (id) => document.getElementById(id);

const portEl = $('port');
const tokenEl = $('token');
const msgEl = $('msg');

function note(text, kind = '') {
  msgEl.textContent = text;
  msgEl.className = `msg ${kind}`;
}

async function load() {
  const c = await browser.storage.local.get({ port: 7337, token: '' });
  portEl.value = c.port;
  tokenEl.value = c.token;
}

function readPort() {
  const n = Number(portEl.value);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) return null;
  return n;
}

async function save() {
  const port = readPort();
  if (port === null) return note('Port muss zwischen 1024 und 65535 liegen', 'err');

  const token = tokenEl.value.trim();
  if (!token) return note('Token fehlt', 'err');

  await browser.storage.local.set({ port, token });
  note('Gespeichert', 'ok');
  return undefined;
}

async function test() {
  const port = readPort();
  if (port === null) return note('Port muss zwischen 1024 und 65535 liegen', 'err');

  // Erst sichern, sonst prueft der Test noch die alten Werte.
  await browser.storage.local.set({ port, token: tokenEl.value.trim() });

  note('Prüfe …');
  const res = await browser.runtime.sendMessage({ type: 'ping' });
  if (res && res.ok) note('Verbindung steht', 'ok');
  else note((res && res.error) || 'Keine Verbindung', 'err');
  return undefined;
}

/** Liest "Port: 7337 / Token: abc…" aus dem eingefuegten Text. */
function parseBulk() {
  const text = $('bulk').value;
  const port = text.match(/port\s*[:=]?\s*(\d{4,5})/i);
  const token = text.match(/token\s*[:=]?\s*([0-9a-f]{20,})/i);

  if (!port && !token) return note('Darin steckt weder Port noch Token', 'err');
  if (port) portEl.value = port[1];
  if (token) tokenEl.value = token[1];
  return save();
}

$('save').addEventListener('click', save);
$('test').addEventListener('click', test);
$('parse').addEventListener('click', parseBulk);

load();
