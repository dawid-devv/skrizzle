'use strict';

// Startet Electron als Electron. Notwendig, weil manche Umgebungen
// ELECTRON_RUN_AS_NODE=1 setzen (z. B. wenn der Aufrufer selbst eine
// Electron-App ist) — dann startet `electron .` nur einen Node-Prozess
// und `require('electron')` liefert kein ipcMain.

const { spawn } = require('node:child_process');
const electronBinary = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => process.exit(code ?? 0));
