export type Segment = {
  id: number;
  start: number; // seconds
  end: number;
  text: string;
};

export type SourceKind = "file" | "link";

export type Transcript = {
  id: string;
  title: string;
  source: { kind: SourceKind; name: string; url?: string; mediaPath?: string; thumbnail?: string; isVideo: boolean };
  duration: number;
  language: string; // whisper code, e.g. "en", "id"
  task: "transcribe" | "translate";
  model: ModelKey;
  createdAt: number;
  updatedAt: number;
  segments: Segment[];
  done: boolean;
  /** Line-by-line translations, keyed by target language code, then by segment id. */
  translations?: Record<string, { lines: Record<number, string>; done: boolean; updatedAt: number }>;
  summary?: { language: string; text: string; createdAt: number };
};

export type ModelKey = "fast" | "balanced" | "accurate";
