# Scribe

Turn a YouTube link, a Google Drive link or a video file into a full transcript, on your own computer.

- **Links or files.** YouTube, Google Drive, Vimeo, TikTok, Instagram, X and most other video sites (through [yt-dlp](https://github.com/yt-dlp/yt-dlp)), or drop in MP4, MOV, WebM, MP3, M4A, WAV and more.
- **Whisper on your graphics card.** OpenAI's Whisper speech model runs locally through WebGPU ([transformers.js](https://github.com/huggingface/transformers.js)). Nothing is uploaded and there is no account, quota or server.
- **99 languages, detected for you.** transformers.js has no language detection yet and silently assumes English. Scribe asks Whisper itself: one decoder step on the loudest 30 seconds, then it reads the language token's probability.
- **Readable, not a wall of words.** Punctuated text grouped into paragraphs at the speaker's pauses, with a timestamp per paragraph. Click any line to play from there, and the line being spoken is highlighted as it plays.
- **Chapters and key lines.** Chapters come from TextTiling (Hearst, 1997): the talk is cut where its vocabulary changes, and each part is named by the words it uses most. Key lines come from TextRank: real sentences quoted word for word, never rewritten.
- **Fix it fast.** Find (Ctrl+F) with Replace all for a misheard name, and inline editing.
- **Save as** Word (.docx), plain text, Markdown, SRT or WebVTT subtitles.
- **Stop and continue.** Stopping keeps everything written so far, and Continue picks up from that point.

## Models

| Preset   | Model                  | Download (GPU) | Good for |
|----------|------------------------|----------------|----------|
| Fast     | whisper-base           | 146 to 206 MB  | Clear speech. A 60 s clip took 4.1 s on an RTX 5060 Laptop GPU. |
| Balanced | whisper-small          | 485 to 586 MB  | Accents, noise, Indonesian and other languages |
| Accurate | whisper-large-v3-turbo | 563 to 759 MB  | Names, jargon, fast talkers. GPU only. |

Each model downloads once from Hugging Face and is cached. Without WebGPU, Fast and Balanced run on the processor instead, which is slower.

## Run it

```bash
npm install
npm run app        # build and open the desktop app
npm run app:dev    # desktop app with hot reload
npm run dev        # web version in the browser (files only)
npm run check      # engine checks: windowing, cleanup, chapters, exports
```

The first time you paste a link, Scribe downloads the yt-dlp binary into its own data folder. After that it updates itself in the background every two days. YouTube changes often, and yt-dlp's nightly build usually keeps up.

## Why a desktop app

Browsers block web pages from downloading YouTube and Drive videos. A server could do it, but YouTube blocks most cloud servers, and free servers are slow and capped. The desktop app downloads from your own connection and runs Whisper on your own GPU, so it costs nothing to run and has no usage limit. The web version (GitHub Pages) does the same for files you drop in.

## Release

- `git tag v0.1.0 && git push --tags` builds installers for Windows, macOS and Linux on GitHub Actions and attaches them to a draft release.
- Every push to `main` publishes the web version to GitHub Pages.

Both are free on public repositories. The builds are unsigned, so Windows SmartScreen and macOS Gatekeeper will warn on first launch.

## How it works

```
link ─ yt-dlp (Electron's built-in Node solves YouTube's player challenge) ─┐
file ───────────────────────────────────────────────────────────────────────┴─ decode to 16 kHz mono
  → detect language (one Whisper decoder step)
  → cut into ≤30 s windows at the quietest 150 ms between 20 s and 29.5 s, so words aren't split
  → skip near-silent windows (Whisper invents "Thank you." on silence)
  → Whisper, window by window, in a Web Worker; text streams in as each window finishes
  → drop phantom lines and repetition loops → paragraphs at pauses → chapters, key lines
```

Transcripts are stored in IndexedDB on the device. Downloaded audio is kept in the app's data folder so playback works later.
