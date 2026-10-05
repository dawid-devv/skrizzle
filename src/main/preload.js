'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  probe: () => ipcRenderer.invoke('bins:probe'),
  installYtdlp: () => ipcRenderer.invoke('bins:installYtdlp'),

  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickFfmpeg: () => ipcRenderer.invoke('dialog:pickFfmpeg'),

  add: (text) => ipcRenderer.invoke('queue:add', text),
  cancel: (id) => ipcRenderer.invoke('queue:cancel', id),
  clearFinished: () => ipcRenderer.invoke('queue:clearFinished'),

  open: (p) => ipcRenderer.invoke('shell:open', p),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  openFolder: () => ipcRenderer.invoke('shell:openFolder'),

  serverState: () => ipcRenderer.invoke('server:state'),
  serverSetEnabled: (on) => ipcRenderer.invoke('server:setEnabled', on),
  serverSetPort: (port) => ipcRenderer.invoke('server:setPort', port),
  serverNewToken: () => ipcRenderer.invoke('server:newToken'),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),

  onJobUpdate: (cb) => ipcRenderer.on('job:update', (_e, job) => cb(job)),
  onJobAdded: (cb) => ipcRenderer.on('job:added', (_e, job) => cb(job)),
  onInstallProgress: (cb) => ipcRenderer.on('install:progress', (_e, p) => cb(p)),
});
