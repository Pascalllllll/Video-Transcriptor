import { useCallback, useEffect, useRef, useState } from "react";
import type { Transcript } from "./lib/types";
import { deleteTranscript, getTranscript, listTranscripts, saveTranscript } from "./lib/store";
import { detectBackend, type Backend } from "./lib/models";
import { rememberMedia, useTranscriber, type Options } from "./useTranscriber";
import { Home } from "./ui/Home";
import { Doc } from "./ui/Doc";
import { Moon, Sun } from "./ui/icons";

type Theme = "light" | "dark";

const read = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export function App() {
  const [view, setView] = useState<{ kind: "home" } | { kind: "doc"; id: string }>({ kind: "home" });
  const [doc, setDoc] = useState<Transcript | null>(null);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [recent, setRecent] = useState<Transcript[] | null>(null);
  const [options, setOptionsState] = useState<Options>(() => read("scribe.options", { model: "fast", language: null, task: "transcribe" }));
  const [backend, setBackend] = useState<Backend | null>(null);
  const [theme, setTheme] = useState<Theme | null>(() => read<Theme | null>("scribe.theme", null));
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(0);

  const say = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }, []);

  const onLive = useCallback((t: Transcript) => {
    setLiveId(t.id);
    setDoc((d) => (d == null || d.id === t.id ? t : d));
  }, []);
  const { job, start, resume, cancel } = useTranscriber(onLive);

  useEffect(() => {
    void detectBackend().then(setBackend);
    void listTranscripts().then(setRecent);
  }, []);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme ? theme === "dark" : systemDark();
  const flipTheme = () => {
    const next: Theme = isDark ? "light" : "dark";
    const apply = () => {
      setTheme(next);
      write("scribe.theme", next);
    };
    const d = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (d.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) d.startViewTransition(apply);
    else apply();
  };

  const setOptions = (o: Options) => {
    setOptionsState(o);
    write("scribe.options", o);
  };

  const goHome = useCallback(() => {
    setView({ kind: "home" });
    void listTranscripts().then(setRecent);
    window.scrollTo({ top: 0 });
  }, []);

  const open = useCallback(async (id: string) => {
    const t = await getTranscript(id);
    if (!t) return;
    setDoc(t);
    setView({ kind: "doc", id });
    window.scrollTo({ top: 0 });
  }, []);

  const begin = (src: { file: File } | { link: string }) => {
    setDoc(null);
    setView({ kind: "doc", id: "pending" });
    void start(src, options);
  };

  // Once the job has created its transcript, point the view at it.
  useEffect(() => {
    if (view.kind === "doc" && view.id === "pending" && doc) setView({ kind: "doc", id: doc.id });
  }, [doc, view]);

  const change = useCallback((t: Transcript) => {
    setDoc(t);
    void saveTranscript(t);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) {
      const text = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
      if (text && /^https?:/.test(text)) begin({ link: text.trim() });
      return;
    }
    if (!/^(audio|video)\//.test(f.type) && !/\.(mkv|m4a|opus|flac|mov|webm|mp4|mp3|wav|ogg)$/i.test(f.name)) {
      say(`${f.name} isn't audio or video.`);
      return;
    }
    // Dropping the original onto an unfinished transcript picks it up where it stopped.
    if (view.kind === "doc" && doc && !doc.done && liveId !== doc.id) {
      rememberMedia(doc.id, URL.createObjectURL(f));
      void resume(doc, f);
      setLiveId(doc.id);
      return;
    }
    if (view.kind === "doc" && doc?.done && doc.source.kind === "file" && doc.source.name === f.name) {
      rememberMedia(doc.id, URL.createObjectURL(f));
      setDoc({ ...doc });
      say("Playback is back on for this file.");
      return;
    }
    begin({ file: f });
  };

  const live = doc != null && doc.id === liveId;

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].some((t) => t === "Files" || t === "text/uri-list")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.relatedTarget == null && setDragging(false)}
      onDrop={onDrop}
    >
      <a className="skip" href="#main">Skip to content</a>
      <header className="bar">
        <button className="wordmark" onClick={goHome} aria-label="Scribe, all transcripts">
          Scribe
        </button>
        <button className="icon" onClick={flipTheme} aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}>
          {isDark ? <Sun /> : <Moon />}
        </button>
      </header>

      <div id={view.kind === "home" ? "main" : undefined} className="view" key={view.kind}>
        {view.kind === "home" ? (
          <Home
            options={options}
            setOptions={setOptions}
            backend={backend}
            recent={recent}
            onLink={(url) => begin({ link: url })}
            onFile={(f) => begin({ file: f })}
            onOpen={open}
            onDelete={async (id) => {
              await deleteTranscript(id);
              setRecent((r) => r?.filter((t) => t.id !== id) ?? null);
              say("Transcript deleted.");
            }}
          />
        ) : doc ? (
          <Doc
            t={doc}
            job={job}
            live={live}
            onBack={goHome}
            onChange={change}
            onCancel={cancel}
            onResume={() => {
              setLiveId(doc.id);
              void resume(doc);
            }}
            say={say}
          />
        ) : (
          <Starting job={job} onBack={goHome} onCancel={cancel} />
        )}
      </div>

      {dragging && (
        <div className="drop" aria-hidden="true">
          <p>Let go to transcribe</p>
        </div>
      )}
      <div className={`toast ${toast ? "is-on" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}

/** Shown while a link is being opened, before the transcript record exists. */
function Starting({ job, onBack, onCancel }: { job: ReturnType<typeof useTranscriber>["job"]; onBack(): void; onCancel(): void }) {
  const p = job.link;
  const error = job.phase === "error";
  return (
    <main className="starting" id="main">
      {error ? (
        <>
          <h2>That didn't work</h2>
          <p className="field-error">{job.error}</p>
          <button className="primary" onClick={onBack}>Back to start</button>
        </>
      ) : (
        <>
          <h2>{p?.stage === "tool" ? "Setting up the downloader" : p?.stage === "download" ? "Downloading the audio" : "Opening the link"}</h2>
          <p className="quiet">
            {p?.stage === "tool"
              ? "Scribe fetches yt-dlp, the open-source downloader, the first time you use a link."
              : p?.stage === "download"
                ? `${Math.round(p.percent)}%${p.speed && p.speed !== "Unknown" ? ` at ${p.speed}` : ""}`
                : "Asking the site for the audio track."}
          </p>
          <div className={`meter ${p && "percent" in p ? "" : "is-unknown"}`} aria-hidden="true">
            <span style={{ width: `${p && "percent" in p ? p.percent : 100}%` }} />
          </div>
          <button className="tool" onClick={() => {
            onCancel();
            onBack();
          }}>
            Cancel
          </button>
        </>
      )}
    </main>
  );
}
