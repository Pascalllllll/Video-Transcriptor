/// <reference lib="webworker" />
import { pipeline, env, Tensor, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { planWindows, SR } from "../lib/chunks";
import { cleanChunks, looksLooped } from "../lib/segments";
import { LANGUAGES } from "../lib/languages";
import { modelSpec, type Backend } from "../lib/models";
import type { ModelKey, Segment } from "../lib/types";

export type ToWorker =
  | { type: "load"; model: ModelKey; backend: Backend }
  | { type: "run"; pcm: Float32Array; language: string | null; task: "transcribe" | "translate"; from: number; nextId: number; prev: Segment[] };

export type FromWorker =
  | { type: "download"; file: string; loaded: number; total: number }
  | { type: "ready"; backend: Backend; ms: number }
  | { type: "language"; code: string; confidence: number }
  | { type: "segments"; segments: Segment[]; upTo: number }
  | { type: "done" }
  | { type: "error"; message: string; stage: "load" | "run" };

env.allowLocalModels = false;
const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loaded = "";

async function load(model: ModelKey, backend: Backend) {
  const spec = modelSpec(model);
  const key = `${spec.repo}:${backend}`;
  if (asr && loaded === key) return post({ type: "ready", backend, ms: 0 });
  const variant = spec.variants[backend] ?? spec.variants.wasm!;
  const t0 = performance.now();
  await asr?.dispose();
  asr = null;
  const files = new Map<string, { loaded: number; total: number }>();
  asr = (await pipeline("automatic-speech-recognition", spec.repo, {
    device: backend === "wasm" ? "wasm" : "webgpu",
    dtype: { encoder_model: variant.encoder, decoder_model_merged: variant.decoder } as never,
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === "progress" && p.file) {
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        let l = 0;
        let t = 0;
        for (const f of files.values()) {
          l += f.loaded;
          t += f.total;
        }
        post({ type: "download", file: p.file, loaded: l, total: t });
      }
    },
  })) as AutomaticSpeechRecognitionPipeline;
  loaded = key;
  post({ type: "ready", backend, ms: performance.now() - t0 });
}

/**
 * transformers.js has no language detection yet and silently assumes English. Whisper itself
 * can do it: after <|startoftranscript|> the very next token it predicts is the language.
 * Run one decoder step on the loudest 30 s and read that token's probabilities.
 */
async function detectLanguage(pcm: Float32Array): Promise<{ code: string; confidence: number }> {
  const a = asr!;
  const sample = loudest30s(pcm);
  const { input_features } = await a.processor(sample);
  // The model's generation config holds the special token ids Whisper was trained with.
  const gen = (a.model as unknown as { generation_config: { lang_to_id: Record<string, number>; decoder_start_token_id: number } }).generation_config;
  const tok = a.tokenizer as unknown as { convert_tokens_to_ids(t: string): number | null };
  const ids = new Map<string, number>(Object.entries(gen.lang_to_id ?? {}));
  if (!ids.size) for (const [code] of LANGUAGES) {
    const id = tok.convert_tokens_to_ids(`<|${code}|>`);
    if (id != null) ids.set(`<|${code}|>`, id);
  }
  const sot = gen.decoder_start_token_id ?? tok.convert_tokens_to_ids("<|startoftranscript|>")!;
  const decoder_input_ids = new Tensor("int64", BigInt64Array.from([BigInt(sot)]), [1, 1]);
  const out = (await (a.model as unknown as (x: object) => Promise<{ logits: Tensor }>)({ input_features, decoder_input_ids })) as { logits: Tensor };
  const logits = out.logits.data as Float32Array;
  const vocab = out.logits.dims[2];
  const row = logits.subarray(logits.length - vocab);
  const langs = LANGUAGES.map(([code]) => [code, ids.get(`<|${code}|>`)] as const).filter((x): x is [string, number] => x[1] != null);
  const max = Math.max(...langs.map(([, id]) => row[id]));
  const exp = langs.map(([code, id]) => [code, Math.exp(row[id] - max)] as const);
  const sum = exp.reduce((s, [, e]) => s + e, 0);
  const [code, e] = exp.reduce((best, x) => (x[1] > best[1] ? x : best));
  return { code, confidence: e / sum };
}

function loudest30s(pcm: Float32Array): Float32Array {
  const win = 30 * SR;
  if (pcm.length <= win) return pcm;
  const step = 5 * SR;
  let best = 0;
  let bestE = -1;
  for (let s = 0; s + win <= pcm.length; s += step) {
    let e = 0;
    for (let i = s; i < s + win; i += 160) e += Math.abs(pcm[i]);
    if (e > bestE) {
      bestE = e;
      best = s;
    }
  }
  return pcm.subarray(best, best + win);
}

async function run(msg: Extract<ToWorker, { type: "run" }>) {
  const a = asr!;
  const { pcm, task } = msg;
  let language = msg.language;
  if (!language) {
    const d = await detectLanguage(pcm);
    language = d.code;
    post({ type: "language", ...d });
  }
  let nextId = msg.nextId;
  let prev = msg.prev;
  for (const w of planWindows(pcm)) {
    if (w.end / SR <= msg.from) continue;
    const offset = w.start / SR;
    if (w.silent) {
      post({ type: "segments", segments: [], upTo: w.end / SR });
      continue;
    }
    const slice = pcm.subarray(w.start, w.end);
    type Out = { chunks?: { timestamp: [number, number | null]; text: string }[]; text: string };
    let out = (await a(slice, { return_timestamps: true, language, task } as never)) as unknown as Out;
    // Like OpenAI's reference decoder: if greedy decoding fell into a loop, decode this window
    // once more with a little randomness and repeated phrases blocked.
    if (looksLooped(out.text)) {
      out = (await a(slice, { return_timestamps: true, language, task, do_sample: true, temperature: 0.4, no_repeat_ngram_size: 4 } as never)) as unknown as Out;
    }
    const raw = out.chunks?.length ? out.chunks : [{ timestamp: [0, null] as [number, null], text: out.text }];
    const segs = cleanChunks(raw, offset, w.end / SR, prev, nextId);
    nextId += segs.length;
    prev = [...prev.slice(-3), ...segs];
    post({ type: "segments", segments: segs, upTo: w.end / SR });
  }
  post({ type: "done" });
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    if (m.type === "load") await load(m.model, m.backend);
    else await run(m);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err), stage: m.type === "load" ? "load" : "run" });
  }
};
