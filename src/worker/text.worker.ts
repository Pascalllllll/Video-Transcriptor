/// <reference lib="webworker" />
import { pipeline, env, TextStreamer, type TranslationPipeline, type TextGenerationPipeline } from "@huggingface/transformers";

// Two text models, each downloaded the first time it's used and cached after:
//  - NLLB-200 (Meta, 2022) translates between 200 languages, one transcript line at a time, so
//    every line keeps its timestamp.
//  - Qwen2.5-1.5B-Instruct writes the summary, in whichever language is asked for.

export type ToText =
  | { type: "translate"; lines: { id: number; text: string }[]; src: string; tgt: string; device: "webgpu" | "wasm" }
  | { type: "summarize"; text: string; title: string; language: string; device: "webgpu" | "wasm" };

export type FromText =
  | { type: "download"; what: "translate" | "summary"; loaded: number; total: number }
  | { type: "translated"; items: { id: number; text: string }[]; done: number; total: number }
  | { type: "token"; text: string }
  | { type: "stage"; text: string }
  | { type: "summary"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

env.allowLocalModels = false;
const post = (m: FromText) => (self as unknown as Worker).postMessage(m);

export const TRANSLATE_MODEL = "Xenova/nllb-200-distilled-600M";
export const SUMMARY_MODEL = "onnx-community/Qwen2.5-1.5B-Instruct";

let translator: TranslationPipeline | null = null;
let writer: TextGenerationPipeline | null = null;

function progress(what: "translate" | "summary") {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let l = 0;
    let t = 0;
    for (const f of files.values()) {
      l += f.loaded;
      t += f.total;
    }
    post({ type: "download", what, loaded: l, total: t });
  };
}

async function translate(m: Extract<ToText, { type: "translate" }>) {
  translator ??= (await pipeline("translation", TRANSLATE_MODEL, {
    device: m.device,
    dtype: m.device === "webgpu" ? "q4f16" : "q8",
    progress_callback: progress("translate"),
  } as never)) as TranslationPipeline;
  const BATCH = 8;
  let done = 0;
  for (let i = 0; i < m.lines.length; i += BATCH) {
    const batch = m.lines.slice(i, i + BATCH);
    const out = (await translator(
      batch.map((l) => l.text),
      { src_lang: m.src, tgt_lang: m.tgt, max_new_tokens: 256 } as never,
    )) as unknown as { translation_text: string }[];
    done += batch.length;
    post({ type: "translated", items: batch.map((l, k) => ({ id: l.id, text: out[k]?.translation_text?.trim() ?? "" })), done, total: m.lines.length });
  }
  post({ type: "done" });
}

const SYSTEM =
  "You summarize transcripts of talks, lectures, meetings and videos. Use only what the transcript says: never add facts, names, numbers or opinions that are not in it. If the transcript is unclear, say less rather than guess.";

async function write(prompt: string, maxTokens: number, stream: boolean): Promise<string> {
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: prompt },
  ];
  const streamer = stream
    ? new TextStreamer(writer!.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: (t: string) => post({ type: "token", text: t }) })
    : undefined;
  const out = (await writer!(messages as never, { max_new_tokens: maxTokens, do_sample: false, repetition_penalty: 1.08, streamer } as never)) as unknown as {
    generated_text: { role: string; content: string }[];
  }[];
  return out[0].generated_text.at(-1)?.content.trim() ?? "";
}

async function summarize(m: Extract<ToText, { type: "summarize" }>) {
  if (m.device !== "webgpu") throw new Error("Summaries need a graphics card with WebGPU. Translation still works without one.");
  writer ??= (await pipeline("text-generation", SUMMARY_MODEL, { device: "webgpu", dtype: "q4f16", progress_callback: progress("summary") } as never)) as TextGenerationPipeline;

  // About 2,500 words fit comfortably in one pass. Longer talks are summarized in parts first,
  // then the notes from the parts are summarized together.
  const words = m.text.split(/\s+/);
  let source = m.text;
  if (words.length > 3000) {
    const parts: string[] = [];
    for (let i = 0; i < words.length; i += 2500) parts.push(words.slice(i, i + 2500).join(" "));
    const notes: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      post({ type: "stage", text: `Reading part ${i + 1} of ${parts.length}` });
      notes.push(await write(`Part ${i + 1} of ${parts.length} of the transcript "${m.title}":\n\n${parts[i]}\n\nList the main points of this part as 4 to 8 short bullet points in English. Facts only, no introduction.`, 350, false));
    }
    source = notes.map((n, i) => `Part ${i + 1}:\n${n}`).join("\n\n");
    post({ type: "stage", text: "Writing the summary" });
  }
  const prompt = `${words.length > 3000 ? "Notes taken from each part of" : "Transcript of"} "${m.title}":\n\n${source}\n\nWrite in ${m.language}. Start with a summary of 3 to 5 sentences. Then a line with only the words "Key points" written in ${m.language}. Then 4 to 7 short points, each on its own line starting with "- ". No other headings, no introduction, no closing remarks.`;
  const text = await write(prompt, 700, true);
  post({ type: "summary", text });
  post({ type: "done" });
}

self.onmessage = async (e: MessageEvent<ToText>) => {
  try {
    if (e.data.type === "translate") await translate(e.data);
    else await summarize(e.data);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
