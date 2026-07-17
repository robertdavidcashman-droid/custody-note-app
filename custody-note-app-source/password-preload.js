const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pwdApi', {
  submit: (password) => ipcRenderer.send('recovery-pw-submit', password),
  cancel: () => ipcRenderer.send('recovery-pw-cancel'),
});
