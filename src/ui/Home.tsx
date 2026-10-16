import { useRef, useState } from "react";
import type { Transcript } from "../lib/types";
import type { Options } from "../useTranscriber";
import { bridge, linkKind, looksLikeLink } from "../lib/bridge";
import { MEDIA_ACCEPT } from "../lib/media";
import { COMMON, LANGUAGES, languageName } from "../lib/languages";
import { MODELS, modelSpec, type Backend } from "../lib/models";
import { ago, clock, duration } from "../lib/time";
import { wordCount } from "../lib/segments";
import { Trash } from "./icons";

type Props = {
  options: Options;
  setOptions(o: Options): void;
  backend: Backend | null;
  recent: Transcript[] | null;
  onLink(url: string): void;
  onFile(f: File): void;
  onOpen(id: string): void;
  onDelete(id: string): void;
};

export function Home({ options, setOptions, backend, recent, onLink, onFile, onOpen, onDelete }: Props) {
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const desktop = !!bridge();
  const spec = modelSpec(options.model);
  const variant = backend ? spec.variants[backend] : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = link.trim();
    if (!v) return setLinkError("Paste a link first, or choose a file below.");
    if (!looksLikeLink(v)) return setLinkError("That doesn't look like a link. It should start like youtube.com/… or drive.google.com/…");
    if (!desktop) return setLinkError("Links need the Scribe desktop app, because browsers block downloads from YouTube and Drive. Here, download the video and drop the file in.");
    setLinkError("");
    onLink(/^https?:/i.test(v) ? v : `https://${v}`);
  };

  const kind = looksLikeLink(link) ? linkKind(link) : null;

  return (
    <div className="home">
      <section className="intake">
        <h1>
          Every word,
          <br />
          <em>written down.</em>
        </h1>
        <p className="lede">
          Paste a YouTube or Google Drive link, or drop in a video or recording. Scribe listens on this computer and writes out what's said, with a timestamp on every paragraph.
        </p>

        <form className="linkform" onSubmit={submit} noValidate>
          <label className="sr" htmlFor="link">Video link</label>
          <input
            id="link"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://youtube.com/watch?v=…"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setLinkError("");
            }}
            aria-invalid={!!linkError}
            aria-describedby="link-msg"
          />
          <button className="primary" type="submit">Transcribe</button>
        </form>
        <p id="link-msg" className={linkError ? "field-error" : "field-hint"} aria-live="polite">
          {linkError ||
            (kind === "drive"
              ? "Drive files must be shared as 'Anyone with the link'."
              : kind === "other"
                ? "Vimeo, TikTok, Instagram, X, Facebook and direct .mp4 links work too."
                : desktop
                  ? "YouTube, Google Drive, Vimeo, TikTok and most other video sites."
                  : "On the web Scribe takes files. Links work in the desktop app.")}
        </p>

        <div className="or-file">
          <button className="secondary" onClick={() => picker.current?.click()}>Choose a video or audio file</button>
          <span>or drop it anywhere on this window</span>
          <input
            ref={picker}
            type="file"
            accept={MEDIA_ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </div>

        <div className="sentence" aria-label="Transcription settings">
          <span>Use the</span>
          <label>
            <span className="sr">Model</span>
            <select value={options.model} onChange={(e) => setOptions({ ...options, model: e.target.value as Options["model"] })}>
              {MODELS.map((m) => (
                <option key={m.key} value={m.key} disabled={backend === "wasm" && !m.variants.wasm}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <span>model, in</span>
          <label>
            <span className="sr">Spoken language</span>
            <select value={options.language ?? ""} onChange={(e) => setOptions({ ...options, language: e.target.value || null })}>
              <option value="">any language</option>
              <optgroup label="Common">
                {COMMON.map((c) => (
                  <option key={c} value={c}>{languageName(c)}</option>
                ))}
              </optgroup>
              <optgroup label="All">
                {LANGUAGES.filter(([c]) => !COMMON.includes(c)).map(([c, n]) => (
                  <option key={c} value={c}>{n}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <span>,</span>
          <label>
            <span className="sr">Output</span>
            <select value={options.task} onChange={(e) => setOptions({ ...options, task: e.target.value as Options["task"] })}>
              <option value="transcribe">written as spoken</option>
              <option value="translate">translated to English</option>
            </select>
          </label>
          <span>.</span>
        </div>
        <p className="model-note">
          {spec.blurb}
          {variant ? ` ${variant.mb} MB download, once.` : ""}
          {backend === "wasm" ? " No graphics card found, so it runs on the processor: expect about real time or slower." : ""}
          {options.language == null ? " The language is detected from the loudest 30 seconds." : ""}
        </p>
      </section>

      <section className="recent" aria-labelledby="recent-h">
        <h2 id="recent-h">On this computer</h2>
        {recent == null ? (
          <p className="quiet">Opening your transcripts…</p>
        ) : recent.length === 0 ? (
          <div className="recent-empty">
            <p>Nothing transcribed yet.</p>
            <p className="quiet">Transcripts are kept here on this device and never uploaded. A 10-minute talk is usually done in under a minute with a graphics card.</p>
          </div>
        ) : (
          <ul className="ledger">
            {recent.map((t) => (
              <li key={t.id}>
                <button className="ledger-open" onClick={() => onOpen(t.id)}>
                  <span className="l-title">{t.title || "Untitled"}</span>
                  <span className="l-meta">
                    {t.duration > 0 && <span>{duration(t.duration)}</span>}
                    {t.language && <span>{languageName(t.language)}</span>}
                    <span>{wordCount(t.segments).toLocaleString()} words</span>
                    {!t.done && <span className="l-flag">stopped at {clock(t.segments.at(-1)?.end ?? 0)}</span>}
                  </span>
                  <span className="l-date">{ago(t.updatedAt)}</span>
                </button>
                {confirmDelete === t.id ? (
                  <span className="confirm">
                    <button className="danger small" onClick={() => onDelete(t.id)} autoFocus>Delete</button>
                    <button className="tool small" onClick={() => setConfirmDelete(null)}>Keep</button>
                  </span>
                ) : (
                  <button className="icon" aria-label={`Delete ${t.title}`} onClick={() => setConfirmDelete(t.id)}>
                    <Trash />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
