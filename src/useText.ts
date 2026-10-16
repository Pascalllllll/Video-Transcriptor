import { useCallback, useEffect, useRef, useState } from "react";
import type { FromText, ToText } from "./worker/text.worker";
import type { Transcript } from "./lib/types";
import { detectBackend } from "./lib/models";
import { target, targetName } from "./lib/targets";

export type TextJob =
  | { kind: "idle" }
  | { kind: "translate" | "summary"; phase: "download" | "working"; lang: string; loaded?: number; total?: number; done?: number; of?: number; stage?: string; draft?: string }
  | { kind: "error"; message: string };

// Omit applied to each member of the union, so each message keeps its own fields.
type Request = ToText extends infer T ? (T extends unknown ? Omit<T, "device"> : never) : never;

const makeWorker = () => new Worker(new URL("./worker/text.worker.ts", import.meta.url), { type: "module" });

// Download sizes, so the first-run message can say what it costs.
export const TRANSLATE_MB = { webgpu: 1254, wasm: 895 };
export const SUMMARY_MB = 1222;

/** Translation and summary for one transcript, in a worker of their own so the page never stalls. */
export function useText(t: Transcript | null, onChange: (t: Transcript) => void) {
  const [job, setJob] = useState<TextJob>({ kind: "idle" });
  const worker = useRef<Worker | null>(null);
  const latest = useRef(t);
  latest.current = t;
  const device = useRef<"webgpu" | "wasm" | null>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const run = useCallback(async (msg: Request, onMsg: (m: FromText) => void) => {
    device.current ??= (await detectBackend()) === "wasm" ? "wasm" : "webgpu";
    worker.current ??= makeWorker();
    const w = worker.current;
    return new Promise<void>((resolve) => {
      const handler = (e: MessageEvent<FromText>) => {
        onMsg(e.data);
        if (e.data.type === "done" || e.data.type === "error") {
          w.removeEventListener("message", handler);
          resolve();
        }
      };
      w.addEventListener("message", handler);
      w.postMessage({ ...msg, device: device.current } as ToText);
    });
  }, []);

  const translate = useCallback(
    async (tgt: string) => {
      const cur = latest.current;
      if (!cur) return;
      // A transcript made with "translated to English" is already English.
      const srcCode = cur.task === "translate" ? "en" : cur.language;
      const src = target(srcCode);
      const dst = target(tgt);
      if (!src) return setJob({ kind: "error", message: `Translating from ${srcCode} isn't supported yet.` });
      if (!dst) return setJob({ kind: "error", message: "That language isn't available." });
      const have = cur.translations?.[tgt]?.lines ?? {};
      const lines = cur.segments.filter((s) => have[s.id] == null && s.text.trim()).map((s) => ({ id: s.id, text: s.text }));
      if (!lines.length) return;
      setJob({ kind: "translate", phase: "working", lang: tgt, done: 0, of: lines.length });
      await run({ type: "translate", lines, src: src.nllb, tgt: dst.nllb }, (m) => {
        if (m.type === "download") setJob({ kind: "translate", phase: "download", lang: tgt, loaded: m.loaded, total: m.total });
        else if (m.type === "translated") {
          const now = latest.current!;
          const prev = now.translations?.[tgt] ?? { lines: {}, done: false, updatedAt: 0 };
          const merged = { ...prev.lines };
          for (const it of m.items) merged[it.id] = it.text;
          onChange({ ...now, translations: { ...now.translations, [tgt]: { lines: merged, done: m.done === m.total, updatedAt: Date.now() } }, updatedAt: Date.now() });
          setJob({ kind: "translate", phase: "working", lang: tgt, done: m.done, of: m.total });
        } else if (m.type === "error") setJob({ kind: "error", message: m.message });
        else if (m.type === "done") setJob({ kind: "idle" });
      });
    },
    [onChange, run],
  );

  const summarize = useCallback(
    async (lang: string) => {
      const cur = latest.current;
      if (!cur) return;
      const text = cur.segments.map((s) => s.text).join(" ");
      if (text.split(/\s+/).length < 40) return setJob({ kind: "error", message: "This transcript is too short to summarize." });
      setJob({ kind: "summary", phase: "working", lang, draft: "" });
      await run({ type: "summarize", text, title: cur.title, language: targetName(lang) }, (m) => {
        if (m.type === "download") setJob({ kind: "summary", phase: "download", lang, loaded: m.loaded, total: m.total });
        else if (m.type === "stage") setJob((j) => ({ kind: "summary", phase: "working", lang, stage: m.text, draft: j.kind === "summary" ? j.draft : "" }));
        else if (m.type === "token") setJob((j) => ({ kind: "summary", phase: "working", lang, stage: undefined, draft: (j.kind === "summary" ? (j.draft ?? "") : "") + m.text }));
        else if (m.type === "summary") {
          const now = latest.current!;
          onChange({ ...now, summary: { language: lang, text: m.text, createdAt: Date.now() }, updatedAt: Date.now() });
        } else if (m.type === "error") setJob({ kind: "error", message: m.message });
        else if (m.type === "done") setJob({ kind: "idle" });
      });
    },
    [onChange, run],
  );

  const cancel = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    setJob({ kind: "idle" });
  }, []);

  return { job, translate, summarize, cancel, device: device.current };
}
