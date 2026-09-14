'use strict'

// ---------------------------------------------------------------------------
// Preload: the only bridge between the renderer and the main process.
// Every channel is explicit — the renderer gets no Node access.
// ---------------------------------------------------------------------------

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('whale', {
  // --- state ---
  getState: () => ipcRenderer.invoke('whale:get-state'),
  onState: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('whale:state', handler)
    return () => ipcRenderer.removeListener('whale:state', handler)
  },

  // --- balance ---
  getBalance: (manual) => ipcRenderer.invoke('whale:balance', !!manual),
  onBalance: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('whale:balance', handler)
    return () => ipcRenderer.removeListener('whale:balance', handler)
  },

  // --- display modes ---
  onKey: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('whale:key', handler)
    return () => ipcRenderer.removeListener('whale:key', handler)
  },

  // --- dialogue ---
  pickLines: () => ipcRenderer.invoke('whale:pick-lines'),

  // --- config ---
  setConfig: (patch) => ipcRenderer.invoke('whale:set-config', patch),
  reload: () => ipcRenderer.invoke('whale:reload'),

  // --- window ---
  resize: (size) => ipcRenderer.invoke('whale:resize', size),
  setAnchors: (anchors) => ipcRenderer.send('whale:anchors', anchors),
  setPassthrough: (ignore) => ipcRenderer.send('whale:passthrough', !!ignore),
  // Native-feeling drag driven by the main process polling the global cursor, so
  // the window follows the mouse anywhere on screen (and the pet keeps receiving
  // hover events, which a `-webkit-app-region` drag would swallow).
  dragBegin: (offset) => ipcRenderer.send('whale:drag-begin', offset),
  dragEnd: () => ipcRenderer.send('whale:drag-end'),
  moveBy: (delta) => ipcRenderer.send('whale:move-by', delta),
  drop: () => ipcRenderer.invoke('whale:drop'),

  // --- files / app ---
  openPath: (which) => ipcRenderer.invoke('whale:open-path', which),
  readFile: (which) => ipcRenderer.invoke('whale:read-file', which),
  writeFile: (which, text) => ipcRenderer.invoke('whale:write-file', which, text),
  hide: () => ipcRenderer.invoke('whale:hide'),
  toggleDualPet: (enabled) => ipcRenderer.invoke('whale:toggle-dual-pet', !!enabled),
  setFlip: (enabled) => ipcRenderer.invoke('whale:set-flip', !!enabled),
  setSkin: (name) => ipcRenderer.invoke('whale:set-skin', name),
  setSound: (patch) => ipcRenderer.invoke('whale:set-sound', patch),
  quit: () => ipcRenderer.invoke('whale:quit'),
})
