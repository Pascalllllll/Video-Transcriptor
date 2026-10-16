const { contextBridge, ipcRenderer, webUtils } = require("electron");

let progressHandler = null;
ipcRenderer.on("link:progress", (_e, p) => progressHandler && progressHandler(p));

contextBridge.exposeInMainWorld("scribe", {
  platform: process.platform,
  async fetchLink(url, onProgress) {
    progressHandler = onProgress;
    try {
      const r = await ipcRenderer.invoke("link:fetch", url);
      if (r.error) throw new Error(r.error);
      return r.result;
    } finally {
      progressHandler = null;
    }
  },
  cancelLink: () => ipcRenderer.send("link:cancel"),
  pathForFile: (file) => webUtils.getPathForFile(file),
  mediaUrl: (p) => "scribe-media://local/?p=" + encodeURIComponent(p),
  readMedia: (p) => ipcRenderer.invoke("media:read", p),
  mediaExists: (p) => ipcRenderer.invoke("media:exists", p),
  openExternal: (url) => ipcRenderer.send("open-external", url),
});
