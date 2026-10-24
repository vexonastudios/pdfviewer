const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paperdesk', {
  open: () => ipcRenderer.invoke('pdf:open'),
  openPacket: () => ipcRenderer.invoke('pdf:open-packet'),
  initialFile: () => ipcRenderer.invoke('pdf:initial'),
  reviewFile: (id, index) => ipcRenderer.invoke('pdf:review-file', id, index),
  updatePacketItem: (id, index, filePath) => ipcRenderer.invoke('pdf:packet-update', id, index, filePath),
  exportPacketFile: (id, index, bytes) => ipcRenderer.invoke('pdf:packet-export', id, index, bytes),
  save: data => ipcRenderer.invoke('pdf:save', data),
  recoverySave: record => ipcRenderer.invoke('pdf:recovery-save', record),
  recoveryClear: source => ipcRenderer.invoke('pdf:recovery-clear', source),
  recoveryList: kind => ipcRenderer.invoke('pdf:recovery-list', kind),
  recoveryRead: (kind, id) => ipcRenderer.invoke('pdf:recovery-read', kind, id),
  recoveryRemove: (kind, id) => ipcRenderer.invoke('pdf:recovery-remove', kind, id),
  mergeOpen: () => ipcRenderer.invoke('pdf:merge-open'),
  checkUpdates: () => ipcRenderer.invoke('pdf:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('pdf:download-update'),
  print: images => ipcRenderer.invoke('pdf:print', images),
  cancelPrint: () => ipcRenderer.invoke('pdf:print-cancel'),
  close: () => ipcRenderer.invoke('pdf:close'),
  onCloseRequest: callback => {
    const handler = () => callback();
    ipcRenderer.on('pdf:close-request', handler);
    return () => ipcRenderer.removeListener('pdf:close-request', handler);
  },
  exportPacketBatch: (id, entries) => ipcRenderer.invoke('pdf:packet-export-batch', id, entries),
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
