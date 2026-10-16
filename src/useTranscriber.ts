import { useCallback, useEffect, useRef, useState } from "react";
import type { FromWorker, ToWorker } from "./worker/asr.worker";
import { bridge, type LinkProgress } from "./lib/bridge";
import { decodeToPcm, isVideoName } from "./lib/media";
import { detectBackend, type Backend } from "./lib/models";
import { newId, saveTranscript } from "./lib/store";
import type { ModelKey, Transcript } from "./lib/types";

export type Phase = "idle" | "fetching" | "reading" | "model" | "transcribing" | "done" | "error" | "cancelled";

export type Job = {
  phase: Phase;
  link?: LinkProgress;
  model?: { loaded: number; total: number };
  upTo?: number;
  eta?: number;
  error?: string;
  notice?: string;
  language?: { code: string; confidence: number };
  backend?: Backend;
};

export type Options = { model: ModelKey; language: string | null; task: "transcribe" | "translate" };
export type Source = { file: File } | { link: string };

const makeWorker = () => new Worker(new URL("./worker/asr.worker.ts", import.meta.url), { type: "module" });

export function useTranscriber(onChange: (t: Transcript) => void) {
  const [job, setJob] = useState<Job>({ phase: "idle" });
  const worker = useRef<Worker | null>(null);
  const current = useRef<Transcript | null>(null);
  const backend = useRef<Backend | null>(null);
  const saveTimer = useRef(0);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => () => {
    worker.current?.terminate();
    objectUrls.current.forEach(URL.revokeObjectURL);
  }, []);

  const commit = useCallback(
    (t: Transcript, now = false) => {
      current.current = t;
      onChange(t);
      window.clearTimeout(saveTimer.current);
      if (now) void saveTranscript(t);
      else saveTimer.current = window.setTimeout(() => void saveTranscript(t), 1500);
    },
    [onChange],
  );

  const talk = useCallback((msg: ToWorker, transfer: Transferable[] = []) => {
    if (!worker.current) worker.current = makeWorker();
    worker.current.postMessage(msg, transfer);
  }, []);

  /** Loads the model (downloading it the first time), falling back to the CPU if the GPU path fails. */
  const loadModel = useCallback(
    (model: ModelKey) =>
      new Promise<Backend>((resolve, reject) => {
        const attempt = async (b: Backend) => {
          if (!worker.current) worker.current = makeWorker();
          const w = worker.current;
          const onMsg = (e: MessageEvent<FromWorker>) => {
            const m = e.data;
            if (m.type === "download") setJob((j) => ({ ...j, phase: "model", model: { loaded: m.loaded, total: m.total } }));
            if (m.type === "ready") {
              w.removeEventListener("message", onMsg);
              resolve(b);
            }
            if (m.type === "error" && m.stage === "load") {
              w.removeEventListener("message", onMsg);
              console.error("[scribe] model load failed on", b, m.message);
              if (/fetch|network|Failed to|HTTP|load_failed|ERR_/i.test(m.message) && !/webgpu|shader|adapter|device/i.test(m.message)) {
                reject(new Error("The model download was interrupted. Check your connection and press Continue; finished files are kept."));
              } else if (b === "webgpu-f16") {
                // Some drivers advertise half precision but fail on it; full precision usually works.
                w.terminate();
                worker.current = null;
                backend.current = "webgpu";
                void attempt("webgpu");
              } else if (b !== "wasm" && model !== "accurate") {
                setJob((j) => ({ ...j, notice: "Your graphics card couldn't run the model, so Scribe switched to the processor. It works, only slower." }));
                w.terminate();
                worker.current = null;
                backend.current = "wasm";
                void attempt("wasm");
              } else reject(new Error(m.message));
            }
          };
          w.addEventListener("message", onMsg);
          talk({ type: "load", model, backend: b });
        };
        void (async () => {
          backend.current ??= await detectBackend();
          if (model === "accurate" && backend.current === "wasm") {
            reject(new Error("The Accurate model needs a graphics card with WebGPU, and none was found here. Choose Fast or Balanced."));
            return;
          }
          setJob((j) => ({ ...j, phase: "model", backend: backend.current! }));
          void attempt(backend.current);
        })();
      }),
    [talk],
  );

  const transcribe = useCallback(
    async (t: Transcript, pcm: Float32Array, opts: Options) => {
      setJob((j) => ({ ...j, phase: "model", error: undefined }));
      const b = await loadModel(opts.model);
      setJob((j) => ({ ...j, phase: "transcribing", backend: b, upTo: t.segments.at(-1)?.end ?? 0 }));
      const started = performance.now();
      const from = t.segments.at(-1)?.end ?? 0;
      await new Promise<void>((resolve, reject) => {
        const w = worker.current!;
        const onMsg = (e: MessageEvent<FromWorker>) => {
          const m = e.data;
          const cur = current.current!;
          if (m.type === "language") {
            const tip =
              m.code !== "en" && opts.model === "fast"
                ? "Whisper's Fast model was trained mostly on English. For this language, Balanced makes far fewer mistakes; start again with it if the text looks off."
                : undefined;
            setJob((j) => ({ ...j, language: { code: m.code, confidence: m.confidence }, notice: j.notice ?? tip }));
            commit({ ...cur, language: m.code, updatedAt: Date.now() });
          } else if (m.type === "segments") {
            const rate = (m.upTo - from) / ((performance.now() - started) / 1000);
            const eta = rate > 0 ? (cur.duration - m.upTo) / rate : undefined;
            setJob((j) => ({ ...j, upTo: m.upTo, eta }));
            commit({ ...cur, segments: [...cur.segments, ...m.segments], updatedAt: Date.now() });
          } else if (m.type === "done") {
            w.removeEventListener("message", onMsg);
            commit({ ...current.current!, done: true, updatedAt: Date.now() }, true);
            resolve();
          } else if (m.type === "error" && m.stage === "run") {
            w.removeEventListener("message", onMsg);
            reject(new Error(m.message));
          }
        };
        w.addEventListener("message", onMsg);
        talk(
          {
            type: "run",
            pcm,
            language: opts.language ?? (t.segments.length ? t.language : null),
            task: opts.task,
            from,
            nextId: (t.segments.at(-1)?.id ?? -1) + 1,
            prev: t.segments.slice(-3),
          },
          [pcm.buffer],
        );
      });
      setJob((j) => ({ ...j, phase: "done", eta: 0 }));
    },
    [commit, loadModel, talk],
  );

  const fail = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    if (message === "cancelled") return;
    setJob((j) => ({ ...j, phase: "error", error: message }));
    if (current.current) commit({ ...current.current, updatedAt: Date.now() }, true);
  };

  const start = useCallback(
    async (src: Source, opts: Options) => {
      const b = bridge();
      setJob({ phase: "idle" });
      try {
        let data: ArrayBuffer;
        let t: Transcript;
        const base = { id: newId(), language: opts.language ?? "", task: opts.task, model: opts.model, createdAt: Date.now(), updatedAt: Date.now(), segments: [], done: false } as const;
        if ("file" in src) {
          const f = src.file;
          const mediaPath = b ? b.pathForFile(f) || undefined : undefined;
          let url = mediaPath && b ? b.mediaUrl(mediaPath) : undefined;
          if (!url) {
            url = URL.createObjectURL(f);
            objectUrls.current.push(url);
          }
          t = { ...base, segments: [], title: f.name.replace(/\.[^.]+$/, ""), duration: 0, source: { kind: "file", name: f.name, mediaPath, isVideo: f.type.startsWith("video") || isVideoName(f.name) } };
          commit({ ...t }, true);
          rememberMedia(t.id, url);
          setJob({ phase: "reading" });
          data = await f.arrayBuffer();
        } else {
          if (!b) throw new Error("Links work in the desktop app. On the web, download the video and drop the file here.");
          setJob({ phase: "fetching", link: { stage: "info" } });
          const r = await b.fetchLink(src.link, (p) => setJob((j) => ({ ...j, phase: "fetching", link: p })));
          t = { ...base, segments: [], title: r.title, duration: r.duration ?? 0, source: { kind: "link", name: r.title, url: r.url, mediaPath: r.path, thumbnail: r.thumbnail, isVideo: r.isVideo } };
          commit({ ...t }, true);
          setJob({ phase: "reading" });
          data = await (await fetch(b.mediaUrl(r.path))).arrayBuffer();
        }
        const { pcm, duration } = await decodeToPcm(data);
        t = { ...current.current!, duration };
        commit(t, true);
        await transcribe(t, pcm, opts);
      } catch (e) {
        fail(e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, transcribe],
  );

  /** Continues an unfinished transcript from where it stopped. Needs the media again. */
  const resume = useCallback(
    async (t: Transcript, file?: File) => {
      const b = bridge();
      try {
        current.current = t;
        setJob({ phase: "reading" });
        let data: ArrayBuffer;
        const kept = mediaSrc(t);
        if (file) data = await file.arrayBuffer();
        else if (b && t.source.mediaPath && (await b.mediaExists(t.source.mediaPath))) data = await (await fetch(b.mediaUrl(t.source.mediaPath))).arrayBuffer();
        else if (kept) data = await (await fetch(kept)).arrayBuffer();
        else throw new Error("Scribe needs the original file to continue. Drop it onto this window.");
        const { pcm } = await decodeToPcm(data);
        await transcribe(t, pcm, { model: t.model, language: t.language || null, task: t.task });
      } catch (e) {
        fail(e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transcribe],
  );

  const cancel = useCallback(() => {
    bridge()?.cancelLink();
    worker.current?.terminate();
    worker.current = null;
    setJob((j) => ({ ...j, phase: "cancelled" }));
    if (current.current) commit({ ...current.current, updatedAt: Date.now() }, true);
  }, [commit]);

  const reset = useCallback(() => setJob({ phase: "idle" }), []);

  return { job, start, resume, cancel, reset };
}

/** Where the player should load media for a transcript, if anywhere. */
export function mediaSrc(t: Transcript): string | undefined {
  const local = (window as unknown as { __scribeMedia?: Record<string, string> }).__scribeMedia?.[t.id];
  if (local) return local;
  const b = bridge();
  if (b && t.source.mediaPath) return b.mediaUrl(t.source.mediaPath);
  return undefined;
}

export function rememberMedia(id: string, url: string) {
  const w = window as unknown as { __scribeMedia?: Record<string, string> };
  w.__scribeMedia = { ...w.__scribeMedia, [id]: url };
}
