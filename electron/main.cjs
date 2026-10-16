const { app, BrowserWindow, ipcMain, protocol, shell, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { Readable } = require("node:stream");
const { YtDlp } = require("./ytdlp.cjs");

const MIME = {
  ".webm": "video/webm", ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
  ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac", ".aac": "audio/aac",
};

// Whisper runs on the graphics card through WebGPU. Linux Chromium still keeps it behind a flag.
app.commandLine.appendSwitch("enable-unsafe-webgpu");
if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "Vulkan,WebGPU");

protocol.registerSchemesAsPrivileged([
  { scheme: "scribe-media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } },
]);

const DEV = process.env.SCRIBE_DEV;
let win = null;
let ytdlp = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: "Scribe",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#191813" : "#f5f1e8",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(DEV || "file:")) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  if (DEV) win.loadURL(DEV);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  const data = app.getPath("userData");
  ytdlp = new YtDlp(path.join(data, "bin"), path.join(data, "media"));

  // Serves local media to the page. <video> seeks with HTTP Range requests, so those get a
  // proper 206 slice; fetch() from the file:// page needs CORS headers. Only absolute paths to
  // real files are served.
  protocol.handle("scribe-media", async (req) => {
    const p = new URL(req.url).searchParams.get("p");
    if (!p || !path.isAbsolute(p) || !fs.existsSync(p)) return new Response("not found", { status: 404 });
    const size = (await fs.promises.stat(p)).size;
    const headers = {
      "Content-Type": MIME[path.extname(p).toLowerCase()] || "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
    };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      const stream = fs.createReadStream(p, { start, end });
      return new Response(Readable.toWeb(stream), {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(p)), { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  });

  ipcMain.handle("link:fetch", async (e, url) => {
    const send = (p) => !e.sender.isDestroyed() && e.sender.send("link:progress", p);
    try {
      await ytdlp.ensure(send);
      return { result: await ytdlp.fetch(url, send) };
    } catch (err) {
      return { error: err.message === "cancelled" ? "cancelled" : err.message };
    }
  });
  ipcMain.on("link:cancel", () => ytdlp.cancel());
  ipcMain.handle("media:read", async (_e, p) => {
    const b = await fs.promises.readFile(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  });
  ipcMain.handle("media:exists", (_e, p) => typeof p === "string" && fs.existsSync(p));
  ipcMain.on("open-external", (_e, url) => /^https?:/.test(url) && shell.openExternal(url));

  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on("window-all-closed", () => {
  ytdlp && ytdlp.cancel();
  if (process.platform !== "darwin") app.quit();
});
