'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');

const settings = require('./settings');
const binaries = require('./binaries');
const downloader = require('./downloader');
const server = require('./server');

let win = null;
let bins = null;

// --- Warteschlange: ein Download zur Zeit, der Reihe nach ------------------

const jobs = new Map();
let active = null;
let nextId = 1;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function patchJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
  send('job:update', job);
}

async function pump() {
  if (active) return;

  const next = [...jobs.values()].find((j) => j.state === 'queued');
  if (!next) return;

  const cfg = settings.load();
  patchJob(next.id, { state: 'running', stage: 'Vorbereiten …' });

  // Titel vorab holen, damit nicht nur die URL in der Liste steht.
  try {
    const info = await downloader.fetchInfo(next.url, bins);
    patchJob(next.id, { title: info.title, uploader: info.uploader, duration: info.duration });
  } catch {
    // Nicht kritisch — der Download selbst meldet echte Fehler.
  }

  try {
    fs.mkdirSync(cfg.downloadDir, { recursive: true });
  } catch (err) {
    patchJob(next.id, { state: 'error', error: `Zielordner nicht nutzbar: ${err.message}` });
    return pump();
  }

  const handle = downloader.start(
    {
      url: next.url,
      dir: cfg.downloadDir,
      format: next.format || cfg.format,
      playlist: cfg.playlist,
      bins,
    },
    (ev) => {
      if (ev.type === 'progress') {
        patchJob(next.id, {
          percent: ev.percent,
          speed: ev.speed,
          eta: ev.eta,
          downloaded: ev.downloaded,
          total: ev.total,
          stage: null,
        });
      } else if (ev.type === 'stage') {
        patchJob(next.id, { stage: ev.text });
      } else if (ev.type === 'file') {
        patchJob(next.id, { path: ev.path });
      }
    },
  );

  active = { id: next.id, handle };

  try {
    const res = await handle.promise;
    patchJob(next.id, { state: 'done', percent: 1, stage: null, path: res.path || jobs.get(next.id)?.path });
  } catch (err) {
    patchJob(next.id, {
      state: err.cancelled ? 'cancelled' : 'error',
      error: err.cancelled ? null : err.message,
      stage: null,
    });
  } finally {
    active = null;
    pump();
  }
}

// --- IPC ------------------------------------------------------------------

ipcMain.handle('settings:get', () => settings.load());
ipcMain.handle('settings:set', (_e, patch) => settings.save(patch));

ipcMain.handle('bins:probe', async () => {
  bins = await binaries.probe();
  return bins;
});

ipcMain.handle('bins:installYtdlp', async () => {
  await binaries.downloadYtDlp((p) => send('install:progress', p));
  bins = await binaries.probe();
  return bins;
});

ipcMain.handle('dialog:pickFolder', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Zielordner wählen',
    defaultPath: settings.load().downloadDir,
    buttonLabel: 'Hierhin speichern',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return settings.save({ downloadDir: res.filePaths[0] });
});

ipcMain.handle('dialog:pickFfmpeg', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'ffmpeg auswählen',
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  if (!binaries.isRunnable(res.filePaths[0])) {
    throw new Error('Diese Datei ist nicht ausführbar.');
  }
  settings.save({ ffmpegPath: res.filePaths[0] });
  bins = await binaries.probe();
  return bins;
});

/**
 * Legt Auftraege an. `format` ueberschreibt die gespeicherte Qualitaet nur
 * fuer diese Auftraege (so kommt die Auswahl aus dem Browser durch).
 */
function addUrls(text, format = null) {
  const urls = String(text).split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const added = [];
  for (const url of urls) {
    const job = {
      id: nextId++,
      url,
      title: url,
      format,
      state: 'queued',
      percent: null,
      speed: null,
      eta: null,
      stage: null,
      path: null,
      error: null,
    };
    jobs.set(job.id, job);
    added.push(job);
    send('job:added', job);
  }
  pump();
  return added;
}

ipcMain.handle('queue:add', (_e, text) => addUrls(text));

ipcMain.handle('queue:cancel', (_e, id) => {
  if (active && active.id === id) {
    active.handle.cancel();
  } else {
    patchJob(id, { state: 'cancelled' });
  }
});

ipcMain.handle('queue:clearFinished', () => {
  for (const [id, job] of jobs) {
    if (['done', 'error', 'cancelled'].includes(job.state)) jobs.delete(id);
  }
  return [...jobs.values()];
});

ipcMain.handle('shell:open', async (_e, p) => {
  if (!p || !fs.existsSync(p)) return 'Datei nicht gefunden';
  // Leerer Rueckgabewert von openPath heisst: hat geklappt.
  return shell.openPath(p);
});

ipcMain.handle('shell:reveal', (_e, p) => {
  if (p && fs.existsSync(p)) shell.showItemInFolder(p);
  else shell.openPath(settings.load().downloadDir);
});

ipcMain.handle('shell:openFolder', () => shell.openPath(settings.load().downloadDir));

// --- Annahmestelle fuer den Browser-Knopf -------------------------------

let serverError = null;

async function startServer() {
  serverError = null;
  try {
    await server.start({
      onAdd: (url, format) => addUrls(url, format),
      onStatus: (id) => {
        const job = jobs.get(id);
        if (!job) return null;
        // Nur den Stand nach draussen geben, nicht den Dateipfad.
        const { state, percent, title, stage, error } = job;
        return { state, percent, title, stage, error };
      },
    });
  } catch (err) {
    serverError = err.message;
  }
  return { ...server.state(), error: serverError };
}

ipcMain.handle('server:state', () => ({ ...server.state(), error: serverError }));

ipcMain.handle('server:setEnabled', async (_e, enabled) => {
  settings.save({ serverEnabled: Boolean(enabled) });
  server.stop();
  if (enabled) return startServer();
  serverError = null;
  return { ...server.state(), error: null };
});

ipcMain.handle('server:setPort', async (_e, port) => {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    throw new Error('Port muss zwischen 1024 und 65535 liegen');
  }
  settings.save({ serverPort: n });
  server.stop();
  return startServer();
});

ipcMain.handle('server:newToken', async () => {
  const token = require('node:crypto').randomBytes(16).toString('hex');
  settings.save({ token });
  return { ...server.state(), error: serverError };
});

ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text)));

// --- Fenster --------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 580,
    height: 720,
    minWidth: 460,
    minHeight: 420,
    title: 'Skrizzle',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#1b1b1f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Beim Entwickeln: Meldungen aus dem Fenster im Terminal sichtbar machen.
  if (!app.isPackaged) {
    const levels = ['debug', 'info', 'warn', 'error'];
    win.webContents.on('console-message', (e) => {
      console.log(`[renderer/${levels[e.level] || e.level}] ${e.message}`);
    });
    win.webContents.on('render-process-gone', (_e, d) => {
      console.error('[renderer] abgestuerzt:', d.reason);
    });
  }

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus(); }
  });

  app.whenReady().then(async () => {
    bins = await binaries.probe();
    createWindow();
    startServer();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => server.stop());
