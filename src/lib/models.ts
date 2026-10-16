import type { ModelKey } from "./types";

export type Backend = "webgpu-f16" | "webgpu" | "wasm";

type Variant = { encoder: string; decoder: string; mb: number };

export type ModelSpec = {
  key: ModelKey;
  label: string;
  repo: string;
  blurb: string;
  // Download size in MB for each backend, from the Hugging Face file listing.
  variants: Partial<Record<Backend, Variant>>;
};

export const MODELS: ModelSpec[] = [
  {
    key: "fast",
    label: "Fast",
    repo: "onnx-community/whisper-base",
    blurb: "Clear speech, one speaker. About 15× faster than real time on a laptop GPU.",
    variants: {
      "webgpu-f16": { encoder: "fp16", decoder: "fp16", mb: 146 },
      webgpu: { encoder: "fp32", decoder: "q4", mb: 206 },
      wasm: { encoder: "q8", decoder: "q8", mb: 77 },
    },
  },
  {
    key: "balanced",
    label: "Balanced",
    repo: "onnx-community/whisper-small",
    blurb: "Accents, background noise, Indonesian and other languages.",
    variants: {
      "webgpu-f16": { encoder: "fp16", decoder: "fp16", mb: 485 },
      webgpu: { encoder: "fp32", decoder: "q4", mb: 586 },
      wasm: { encoder: "q8", decoder: "q8", mb: 249 },
    },
  },
  {
    key: "accurate",
    label: "Accurate",
    repo: "onnx-community/whisper-large-v3-turbo",
    blurb: "Names, jargon, fast talkers. Needs a graphics card.",
    variants: {
      "webgpu-f16": { encoder: "q4f16", decoder: "q4f16", mb: 563 },
      webgpu: { encoder: "q4", decoder: "q4", mb: 759 },
    },
  },
];

export function modelSpec(key: ModelKey): ModelSpec {
  return MODELS.find((m) => m.key === key) ?? MODELS[0];
}

export async function detectBackend(): Promise<Backend> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    if (!gpu) return "wasm";
    const adapter = await gpu.requestAdapter();
    if (!adapter) return "wasm";
    return adapter.features.has("shader-f16") ? "webgpu-f16" : "webgpu";
  } catch {
    return "wasm";
  }
}
