const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paperdesk', {
  open: () => ipcRenderer.invoke('pdf:open'),
  initialFile: () => ipcRenderer.invoke('pdf:initial'),
  save: data => ipcRenderer.invoke('pdf:save', data),
  setDirty: value => ipcRenderer.send('pdf:dirty', value),
  showOutput: filePath => ipcRenderer.invoke('pdf:show-output', filePath),
  onOpen: callback => {
    const handler = (_, file) => callback(file);
    ipcRenderer.on('pdf:open-file', handler);
    return () => ipcRenderer.removeListener('pdf:open-file', handler);
  },
});
