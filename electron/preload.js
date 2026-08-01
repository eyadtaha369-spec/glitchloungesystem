// Exposes a tiny, safe API to the app's web content — this is what lets
// the React code detect "I'm running inside the desktop app" and call
// real silent printing instead of window.print(). contextIsolation
// means the page can NEVER reach ipcRenderer or Node directly, only
// these specific functions.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  printSilent: (options) => ipcRenderer.invoke("print-silent", options || {}),
  listPrinters: () => ipcRenderer.invoke("list-printers"),
});
