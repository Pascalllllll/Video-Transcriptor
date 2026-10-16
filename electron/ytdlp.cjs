// yt-dlp does the downloading. YouTube changes something every few weeks and yt-dlp's
// nightly build usually catches up within a day, so Scribe fetches the binary on first use
// and updates it in the background instead of shipping a copy that goes stale.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const RELEASES = "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/";

function assetName() {
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "darwin") return "yt-dlp_macos";
  return process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
}

class YtDlp {
  constructor(dir, mediaDir) {
    this.dir = dir;
    this.mediaDir = mediaDir;
    this.bin = path.join(dir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
    this.child = null;
    this.updating = null;
  }

  async ensure(onProgress) {
    if (fs.existsSync(this.bin)) {
      this.maybeUpdate();
      return;
    }
    fs.mkdirSync(this.dir, { recursive: true });
    const res = await fetch(RELEASES + assetName(), { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`Could not download yt-dlp (HTTP ${res.status}). Check your internet connection.`);
    const total = Number(res.headers.get("content-length")) || 0;
    const part = this.bin + ".part";
    const out = fs.createWriteStream(part);
    let got = 0;
    for await (const chunk of res.body) {
      out.write(chunk);
      got += chunk.length;
      if (total) onProgress({ stage: "tool", percent: (got / total) * 100 });
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    fs.chmodSync(part, 0o755);
    fs.renameSync(part, this.bin);
  }

  // At most once every two days, and never while a download is running.
  maybeUpdate() {
    try {
      const age = Date.now() - fs.statSync(this.bin).mtimeMs;
      if (age < 2 * 864e5 || this.updating || this.child) return;
      this.updating = spawn(this.bin, ["--update-to", "nightly"], { stdio: "ignore" });
      this.updating.on("exit", () => {
        this.updating = null;
        try {
          fs.utimesSync(this.bin, new Date(), new Date());
        } catch {}
      });
    } catch {}
  }

  fetch(url, onProgress) {
    fs.mkdirSync(this.mediaDir, { recursive: true });
    const args = [
      // YouTube's player challenges need a JavaScript runtime. Electron is one, so nothing extra is installed.
      "--js-runtimes", `node:${process.execPath}`,
      "--remote-components", "ejs:github",
      // Audio only when the site offers it (smaller and faster); WebM/Opus decodes everywhere in Chromium.
      "-f", "ba[ext=webm]/ba[ext=m4a]/ba/b[height<=480]/b",
      "--no-playlist",
      "--newline",
      "--progress-template", "download:SCRIBE %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
      "--print", "after_move:SCRIBEJSON %(.{title,duration,thumbnail,webpage_url,vcodec,filepath})j",
      "--no-simulate",
      "-o", path.join(this.mediaDir, "%(extractor_key)s-%(id)s.%(ext)s"),
      url,
    ];
    return new Promise((resolve, reject) => {
      onProgress({ stage: "info" });
      const child = spawn(this.bin, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true });
      this.child = child;
      let info = null;
      let errText = "";
      let buf = "";
      const onLine = (line) => {
        const p = line.match(/SCRIBE\s+([\d.]+)%\|([^|]*)\|(.*)$/);
        if (p) return onProgress({ stage: "download", percent: Number(p[1]), speed: p[2].trim(), eta: p[3].trim() });
        const j = line.indexOf("SCRIBEJSON ");
        if (j >= 0) {
          try {
            info = JSON.parse(line.slice(j + 11));
          } catch {}
        }
      };
      child.stdout.on("data", (d) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach(onLine);
      });
      child.stderr.on("data", (d) => (errText += d.toString()));
      child.on("error", (e) => reject(e));
      child.on("close", (code, signal) => {
        this.child = null;
        if (buf) onLine(buf);
        if (signal) return reject(new Error("cancelled"));
        if (code === 0 && info && info.filepath) {
          return resolve({
            path: info.filepath,
            title: info.title || path.basename(info.filepath),
            url: info.webpage_url || url,
            thumbnail: info.thumbnail || undefined,
            duration: info.duration || undefined,
            isVideo: !!info.vcodec && info.vcodec !== "none",
          });
        }
        reject(new Error(friendly(errText) || `yt-dlp stopped (exit ${code}).`));
      });
    });
  }

  cancel() {
    if (this.child) this.child.kill();
  }
}

// yt-dlp's errors are written for developers; these are the ones people actually hit.
function friendly(stderr) {
  const line = (stderr.match(/ERROR: (.*)/g) || []).pop() || "";
  const s = line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/, "");
  if (/Private video/i.test(s)) return "This video is private. Only its owner can open it.";
  if (/confirm your age|age-restricted/i.test(s)) return "YouTube wants a signed-in adult account for this video, so it can't be downloaded here.";
  if (/not a bot|Sign in to confirm/i.test(s)) return "YouTube is asking for a sign-in check from this network. Try again in a few minutes, or download the video and drop the file in.";
  if (/Unsupported URL/i.test(s)) return "Scribe can't read video from this link. YouTube, Google Drive, Vimeo, TikTok, Instagram, X and direct video links work.";
  if (/Video unavailable|has been removed|does not exist/i.test(s)) return "That video is unavailable. It may have been removed or blocked in your country.";
  if (/getaddrinfo|Unable to download webpage|timed out|Connection/i.test(s)) return "Couldn't reach the site. Check your internet connection.";
  if (/Google Drive|drive\.google/i.test(line) && /403|permission|quota/i.test(s)) return "Drive won't share this file. Set it to 'Anyone with the link', or wait if the daily download limit was hit.";
  return s.trim();
}

module.exports = { YtDlp, friendly };
