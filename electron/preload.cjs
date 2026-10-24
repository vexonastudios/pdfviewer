const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paperdesk', {
  open: () => ipcRenderer.invoke('pdf:open'),
  openPacket: () => ipcRenderer.invoke('pdf:open-packet'),
  initialFile: () => ipcRenderer.invoke('pdf:initial'),
  reviewFile: (id, index) => ipcRenderer.invoke('pdf:review-file', id, index),
  updatePacketItem: (id, index, filePath) => ipcRenderer.invoke('pdf:packet-update', id, index, filePath),
  exportPacketFile: (id, index, bytes) => ipcRenderer.invoke('pdf:packet-export', id, index, bytes),
  save: data => ipcRenderer.invoke('pdf:save', data),
  listSignatures: () => ipcRenderer.invoke('pdf:signatures-list'),
  saveSignature: record => ipcRenderer.invoke('pdf:signatures-save', record),
  setSignatureWidth: (signer, width, kind) => ipcRenderer.invoke('pdf:signatures-size', signer, width, kind),
  removeSignature: (signer, kind) => ipcRenderer.invoke('pdf:signatures-remove', signer, kind),
  setDirty: value => ipcRenderer.send('pdf:dirty', value),
  showOutput: filePath => ipcRenderer.invoke('pdf:show-output', filePath),
  onOpen: callback => {
    const handler = (_, file) => callback(file);
    ipcRenderer.on('pdf:open-file', handler);
    return () => ipcRenderer.removeListener('pdf:open-file', handler);
  },
  onReview: callback => {
    const handler = (_, review) => callback(review);
    ipcRenderer.on('pdf:open-review', handler);
    return () => ipcRenderer.removeListener('pdf:open-review', handler);
  },
});
