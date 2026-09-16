// Ponte segura entre as interfaces (index.html / bubble.html) e o processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clickup', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  saveToken: (token) => ipcRenderer.invoke('app:save-token', token),
  setTeam: (teamId) => ipcRenderer.invoke('app:set-team', teamId),
  setTheme: (theme) => ipcRenderer.invoke('app:set-theme', theme),
  setScope: (scope) => ipcRenderer.invoke('app:set-scope', scope),
  setBubble: (on) => ipcRenderer.invoke('app:set-bubble', on),
  setBubbleOpacity: (v) => ipcRenderer.invoke('app:set-bubble-opacity', v),
  setAutostart: (on) => ipcRenderer.invoke('app:set-autostart', on),
  diagnose: () => ipcRenderer.invoke('app:diagnose'),

  tasks: (scope) => ipcRenderer.invoke('tasks:list', scope),
  current: () => ipcRenderer.invoke('timer:current'),
  start: (taskId) => ipcRenderer.invoke('timer:start', taskId),
  stop: () => ipcRenderer.invoke('timer:stop'),

  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  hide: () => ipcRenderer.invoke('win:hide'),
  toggleMain: () => ipcRenderer.invoke('win:toggle-main'),
  bubbleHide: () => ipcRenderer.invoke('bubble:hide'),
  bubbleMenu: () => ipcRenderer.invoke('bubble:menu'),
  tooltip: (text) => ipcRenderer.send('tray:tooltip', text),

  onRefresh: (cb) => ipcRenderer.on('refresh', () => cb()),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
});
