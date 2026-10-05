'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { app } = require('electron');

const FILE = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  // Der "vorgegebene Ordner" — hier landen die Dateien.
  downloadDir: path.join(os.homedir(), 'Movies'),
  format: 'best',          // best | max | 720 | audio
  playlist: false,         // Playlist-Links: nur das eine Video, oder alles?
  ffmpegPath: '',          // manuell gewaehlt, leer = automatisch suchen

  // Annahmestelle fuer den Knopf in Firefox.
  serverEnabled: true,
  serverPort: 7337,
  token: '',               // wird beim ersten Start erzeugt
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(FILE(), 'utf8');
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULTS };
  }
  // Ohne Token nimmt die Annahmestelle nichts an. 128 Bit, nicht zu erraten.
  if (!cache.token) {
    cache.token = crypto.randomBytes(16).toString('hex');
    save({ token: cache.token });
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('Einstellungen konnten nicht gespeichert werden:', err.message);
  }
  return cache;
}

module.exports = { load, save, DEFAULTS };
