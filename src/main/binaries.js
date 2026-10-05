'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFile } = require('node:child_process');
const { app } = require('electron');

const settings = require('./settings');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

// Eine aus dem Finder gestartete App hat eine nackte PATH und kennt Homebrew
// nicht. Darum suchen wir die ueblichen Orte von Hand ab.
const EXTRA_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  path.join(process.env.HOME || '', '.local/bin'),
];

const managedDir = () => path.join(app.getPath('userData'), 'bin');

function isRunnable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Sucht `name` in den Zusatzpfaden und in PATH. */
function findOnDisk(name) {
  const exe = IS_WIN ? `${name}.exe` : name;
  const dirs = [managedDir(), ...EXTRA_DIRS, ...(process.env.PATH || '').split(path.delimiter)];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, exe);
    if (isRunnable(candidate)) return candidate;
  }
  return null;
}

/** Im gepackten App-Bundle mitgeliefert? */
function findBundled(name) {
  if (!app.isPackaged) return null;
  const exe = IS_WIN ? `${name}.exe` : name;
  const candidate = path.join(process.resourcesPath, 'bin', exe);
  return isRunnable(candidate) ? candidate : null;
}

function ytDlpAssetName() {
  if (IS_MAC) return 'yt-dlp_macos';
  if (IS_WIN) return process.arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe';
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}

function get(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'skrizzle' } }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        if (redirectsLeft === 0) return reject(new Error('Zu viele Weiterleitungen'));
        return get(headers.location, redirectsLeft - 1).then(resolve, reject);
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode} bei ${url}`));
      }
      resolve(res);
    }).on('error', reject);
  });
}

/**
 * Laedt yt-dlp in den App-eigenen bin-Ordner. onProgress bekommt 0..1,
 * bzw. null solange die Gesamtgroesse unbekannt ist.
 */
async function downloadYtDlp(onProgress = () => {}) {
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpAssetName()}`;
  const dir = managedDir();
  fs.mkdirSync(dir, { recursive: true });

  const target = path.join(dir, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');
  const tmp = `${target}.part`;

  const res = await get(url);
  const total = Number(res.headers['content-length']) || 0;
  let seen = 0;

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.on('data', (chunk) => {
      seen += chunk.length;
      onProgress(total ? seen / total : null);
    });
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
  });

  fs.renameSync(tmp, target);
  fs.chmodSync(target, 0o755);

  // macOS haengt heruntergeladenen Dateien ein Quarantaene-Attribut an, das
  // die Ausfuehrung blockiert. Wegnehmen, sonst startet das Binary nie.
  if (IS_MAC) {
    await new Promise((resolve) => {
      execFile('/usr/bin/xattr', ['-d', 'com.apple.quarantine', target], () => resolve());
    });
  }

  return target;
}

function version(bin, args = ['--version']) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 15000 }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim().split('\n')[0]);
    });
  });
}

/** Wo stehen wir? Wird beim Start und nach jeder Reparatur abgefragt. */
async function probe() {
  const cfg = settings.load();

  const ytdlp = findBundled('yt-dlp') || findOnDisk('yt-dlp');
  const ffmpeg = (cfg.ffmpegPath && isRunnable(cfg.ffmpegPath) ? cfg.ffmpegPath : null)
    || findBundled('ffmpeg') || findOnDisk('ffmpeg');

  return {
    ytdlp: { path: ytdlp, version: ytdlp ? await version(ytdlp) : null },
    ffmpeg: {
      path: ffmpeg,
      version: ffmpeg ? (await version(ffmpeg, ['-version']))?.replace(/^ffmpeg version /, '') : null,
      autoInstallable: !IS_MAC, // offizielle Builds gibt es nicht fuer macOS
    },
  };
}

module.exports = { probe, downloadYtDlp, managedDir, isRunnable };
