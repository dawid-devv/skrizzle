'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const settings = require('./settings');

const FORMATS = new Set(['best', 'max', '720', 'audio']);
const MAX_BODY = 8 * 1024;

let server = null;
let activePort = null;

/** Zeitkonstanter Vergleich — verraet nicht, wie weit ein Versuch kam. */
function tokenOk(given) {
  const want = settings.load().token || '';
  if (!given || given.length !== want.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
  } catch {
    return false;
  }
}

function send(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // Schutz kommt vom Token, nicht von CORS. Die Erweiterung darf antworten lesen.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Skrizzle-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) {
        reject(new Error('Anfrage zu gross'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Nur echte Web-Links. Alles andere ginge ungeprueft an yt-dlp weiter. */
function cleanUrl(raw) {
  if (!raw) return null;
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.toString();
}

/**
 * Startet die Annahmestelle.
 * `onAdd(url, format)` legt Auftraege an und liefert sie zurueck.
 * `onStatus(id)` liefert den Stand eines Auftrags oder null.
 */
function start({ onAdd, onStatus }) {
  const cfg = settings.load();
  if (!cfg.serverEnabled) return Promise.resolve(null);

  const handler = async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});

    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      return send(res, 400, { error: 'Ungültige Anfrage' });
    }

    const token = req.headers['x-skrizzle-token'] || url.searchParams.get('token');
    if (!tokenOk(token)) return send(res, 401, { error: 'Token fehlt oder falsch' });

    if (url.pathname === '/ping') {
      return send(res, 200, { ok: true, app: 'skrizzle' });
    }

    if (url.pathname === '/add') {
      let params = Object.fromEntries(url.searchParams);
      if (req.method === 'POST') {
        try {
          const body = await readBody(req);
          if (body.trim()) params = { ...params, ...JSON.parse(body) };
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }

      const target = cleanUrl(params.url);
      if (!target) return send(res, 400, { error: 'Kein brauchbarer http(s)-Link' });

      const format = FORMATS.has(params.format) ? params.format : null;

      try {
        const jobs = await onAdd(target, format);
        return send(res, 200, {
          ok: true,
          queued: jobs.length,
          id: jobs[0]?.id ?? null,
          title: jobs[0]?.title,
        });
      } catch (err) {
        return send(res, 500, { error: err.message });
      }
    }

    if (url.pathname === '/job') {
      let params = Object.fromEntries(url.searchParams);
      if (req.method === 'POST') {
        try {
          const body = await readBody(req);
          if (body.trim()) params = { ...params, ...JSON.parse(body) };
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }

      const id = Number(params.id);
      if (!Number.isInteger(id)) return send(res, 400, { error: 'Keine Auftragsnummer' });

      const job = onStatus(id);
      if (!job) return send(res, 404, { error: 'Unbekannter Auftrag' });

      return send(res, 200, { ok: true, ...job });
    }

    return send(res, 404, { error: 'Unbekannter Pfad' });
  };

  // Port belegt? Die naechsten paar probieren, damit der Start nicht scheitert.
  const tryPort = (port, attemptsLeft) => new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        resolve(tryPort(port + 1, attemptsLeft - 1));
      } else {
        reject(err);
      }
    });
    s.listen(port, '127.0.0.1', () => {
      server = s;
      activePort = port;
      resolve(port);
    });
  });

  return tryPort(cfg.serverPort, 5);
}

function stop() {
  if (server) server.close();
  server = null;
  activePort = null;
}

const state = () => ({
  enabled: Boolean(settings.load().serverEnabled),
  running: Boolean(server),
  port: activePort,
  token: settings.load().token,
});

module.exports = { start, stop, state };
