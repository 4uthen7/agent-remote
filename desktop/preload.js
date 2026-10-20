const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hostApi", {
  getState: () => ipcRenderer.invoke("host:get-state"),
  start: () => ipcRenderer.invoke("host:start"),
  stop: () => ipcRenderer.invoke("host:stop"),
  refreshTools: () => ipcRenderer.invoke("host:refresh-tools"),
  refreshSetup: () => ipcRenderer.invoke("host:refresh-setup"),
  installTool: (id) => ipcRenderer.invoke("host:install-tool", id),
  openExternal: (url) => ipcRenderer.invoke("host:open-external", url),
  saveSettings: (settings) => ipcRenderer.invoke("host:save-settings", settings),
  copy: (text) => ipcRenderer.invoke("host:copy", text),
  openData: () => ipcRenderer.invoke("host:open-data"),
  openDocs: () => ipcRenderer.invoke("host:open-docs"),
  chooseFolder: () => ipcRenderer.invoke("host:choose-folder"),
  clearLogs: () => ipcRenderer.invoke("host:clear-logs"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("host:state", listener);
    return () => ipcRenderer.removeListener("host:state", listener);
  },
});
