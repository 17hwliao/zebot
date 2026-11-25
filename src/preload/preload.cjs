const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  onUpdate(callback) {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('pet:update', listener);
    return () => ipcRenderer.removeListener('pet:update', listener);
  },
  onCharacter(callback) {
    const listener = (_event, character) => callback(character);
    ipcRenderer.on('pet:character', listener);
    return () => ipcRenderer.removeListener('pet:character', listener);
  },
  onMotion(callback) {
    const listener = (_event, word) => callback(word);
    ipcRenderer.on('pet:motion', listener);
    return () => ipcRenderer.removeListener('pet:motion', listener);
  },
  selectCharacter(character) {
    return ipcRenderer.invoke('pet:select-character', character);
  },
  setHit(hit) {
    ipcRenderer.send('pet:hit', Boolean(hit));
  },
  input(event) {
    ipcRenderer.send('pet:input', event);
  },
  menu() {
    ipcRenderer.send('pet:menu');
  },
  quit() {
    ipcRenderer.send('pet:quit');
  },
  config() {
    return ipcRenderer.invoke('pet:config');
  },
  saveCalibration(calibration) {
    return ipcRenderer.invoke('pet:save-calibration', calibration);
  },
});

