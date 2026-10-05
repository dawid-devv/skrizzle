'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const P = '@@P@@'; // Fortschrittszeile
const F = '@@F@@'; // endgueltiger Dateipfad

const PROGRESS_TEMPLATE = `download:${P}%(progress.status)s|%(progress.downloaded_bytes)s`
  + '|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s'
  + '|%(progress.speed)s|%(progress.eta)s';

/** yt-dlp schreibt "NA" fuer unbekannte Werte. */
function num(raw) {
  if (raw === undefined || raw === 'NA' || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Qualitaetsstufen. Ohne ffmpeg kann yt-dlp Bild und Ton nicht zusammenfuegen,
 * dann bleibt nur ein bereits fertig gemuxtes Format (bei YouTube meist 720p).
 */
function formatArgs(format, hasFfmpeg) {
  if (!hasFfmpeg) return ['-f', 'b'];

  switch (format) {
    case 'max':
      // Hoechste Aufloesung, notfalls VP9/AV1 — spielt QuickTime nicht immer.
      return ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'];
    case '720':
      // Letzter Rueckfall ist bewusst `w` (worst), nicht `b`: kennt eine Quelle
      // keine Bildhoehe, waere die groesste Datei das Gegenteil des Gewollten.
      return ['-f', 'bv*[height<=720]+ba/b[height<=720]/wv*+ba/w',
        '--merge-output-format', 'mp4'];
    case 'audio':
      return ['-x', '--audio-format', 'mp3', '--audio-quality', '0',
        '--embed-thumbnail', '--embed-metadata'];
    case 'best':
    default:
      // avc1 + mp4a laeuft ueberall nativ; sonst Rueckfall auf das Beste.
      return ['-f', 'bv*[vcodec^=avc1]+ba[acodec^=mp4a]/bv*+ba/b',
        '--merge-output-format', 'mp4'];
  }
}

function commonArgs({ dir, format, playlist, bins }) {
  const args = [
    '--newline', '--no-simulate', '--progress',
    '--progress-template', PROGRESS_TEMPLATE,
    '-O', `after_move:${F}%(filepath)s`,
    '-o', path.join(dir, '%(title)s [%(id)s].%(ext)s'),
    '--retries', '10',
    '--no-overwrites',
    playlist ? '--yes-playlist' : '--no-playlist',
    ...formatArgs(format, Boolean(bins.ffmpeg.path)),
  ];
  if (bins.ffmpeg.path) args.push('--ffmpeg-location', bins.ffmpeg.path);
  return args;
}

/** Titel/Dauer/Bild vorab holen, ohne etwas herunterzuladen. */
function fetchInfo(url, bins) {
  return new Promise((resolve, reject) => {
    const child = spawn(bins.ytdlp.path, [
      '--dump-single-json', '--no-warnings', '--no-playlist', url,
    ]);

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(cleanError(err) || `yt-dlp endete mit Code ${code}`));
      try {
        const j = JSON.parse(out);
        resolve({
          title: j.title || url,
          uploader: j.uploader || j.channel || '',
          duration: j.duration || null,
          thumbnail: j.thumbnail || null,
        });
      } catch {
        reject(new Error('Antwort von yt-dlp war nicht lesbar'));
      }
    });
  });
}

function cleanError(text) {
  const lines = String(text).split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('ERROR:'));
  if (!lines.length) return '';
  return lines[lines.length - 1].replace(/^ERROR:\s*/, '');
}

/**
 * Startet einen Download. `onEvent` bekommt {type:'progress'|'file'|'stage'}.
 * Rueckgabe: { promise, cancel }.
 */
function start({ url, dir, format, playlist, bins }, onEvent) {
  const args = [...commonArgs({ dir, format, playlist, bins }), url];
  const child = spawn(bins.ytdlp.path, args);

  let stderr = '';
  let filepath = null;
  let cancelled = false;

  const handleLine = (line) => {
    if (line.startsWith(P)) {
      const [status, downloaded, total, estimate, speed, eta] = line.slice(P.length).split('|');
      const totalBytes = num(total) ?? num(estimate);
      const got = num(downloaded);
      onEvent({
        type: 'progress',
        status,
        downloaded: got,
        total: totalBytes,
        speed: num(speed),
        eta: num(eta),
        percent: totalBytes && got != null ? Math.min(got / totalBytes, 1) : null,
      });
      return;
    }
    if (line.startsWith(F)) {
      filepath = line.slice(F.length).trim();
      onEvent({ type: 'file', path: filepath });
      return;
    }
    // Zusammenfuegen und Umwandeln dauern merkbar — als Status melden.
    if (/^\[Merger\]|^\[ExtractAudio\]|^\[VideoRemuxer\]/.test(line)) {
      onEvent({ type: 'stage', text: 'Zusammenfuegen …' });
    }
  };

  const lineReader = (stream) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop();
      for (const line of parts) handleLine(line);
    });
  };

  lineReader(child.stdout);
  child.stderr.on('data', (d) => { stderr += d; });

  const promise = new Promise((resolve, reject) => {
    child.on('error', (err) => reject(new Error(`yt-dlp liess sich nicht starten: ${err.message}`)));
    child.on('close', (code) => {
      if (cancelled) return reject(Object.assign(new Error('Abgebrochen'), { cancelled: true }));
      if (code === 0) return resolve({ path: filepath });
      reject(new Error(cleanError(stderr) || `yt-dlp endete mit Code ${code}`));
    });
  });

  return {
    promise,
    cancel() {
      cancelled = true;
      child.kill('SIGTERM');
    },
  };
}

module.exports = { start, fetchInfo };
