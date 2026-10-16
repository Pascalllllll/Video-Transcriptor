import type { Segment } from "./types";

// Lines Whisper is known to produce on music, silence or outros when nobody says them.
const PHANTOMS = [
  /^(thank you|thanks) (so much )?for watching[.!]?$/i,
  /^please subscribe/i,
  /^subtitles? by/i,
  /^terima kasih telah menonton/i,
  /^\[?(music|musik|applause|silence)\]?$/i,
  /^♪+$/,
];

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();

type Raw = { timestamp: [number, number | null]; text: string };

/**
 * Turns one window's raw chunks into clean segments: offsets the times, drops empty or phantom
 * lines and Whisper's repetition loops, and fills a missing end time from the window end.
 */
export function cleanChunks(raw: Raw[], offset: number, windowEnd: number, prev: Segment[], firstId: number): Segment[] {
  const out: Segment[] = [];
  const last = () => out[out.length - 1] ?? prev[prev.length - 1];
  let id = firstId;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const rawText = r.text.replace(/\s+/g, " ").trim();
    if (!rawText || PHANTOMS.some((p) => p.test(rawText)) || looksLooped(rawText) || repeatsItself(rawText)) continue;
    const text = collapseRuns(rawText);
    const start = offset + (r.timestamp[0] ?? 0);
    let end = r.timestamp[1] == null ? windowEnd : offset + r.timestamp[1];
    if (end <= start) end = Math.min(windowEnd, start + 0.5);
    const before = last();
    // A loop repeats the previous line word for word; keep the first copy only.
    if (before && norm(before.text) === norm(text) && norm(text).split(" ").length > 1) continue;
    out.push({ id: id++, start: round(start), end: round(Math.min(end, windowEnd)), text });
  }
  return out;
}

/**
 * Whisper's own guard: text that compresses too well is a loop, not speech. OpenAI uses a zlib
 * ratio above 2.4; character-trigram variety is a close, synchronous stand-in for it.
 */
export function looksLooped(text: string): boolean {
  const s = text.toLowerCase().replace(/\s+/g, " ");
  if (s.length < 40) return false;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) grams.add(s.slice(i, i + 3));
  return grams.size / (s.length - 2) < 0.3 || /(.{1,12}?)\1{6,}/.test(s);
}

/** "2-2-2-2-2-2-2" or "hahahahahaha" becomes one copy plus an ellipsis. */
export function collapseRuns(text: string): string {
  return text.replace(/(.{1,12}?)\1{5,}/g, "$1$1…");
}

/** "the the the the the" or a 4-word phrase looped many times. */
function repeatsItself(text: string): boolean {
  const words = norm(text).split(" ").filter(Boolean);
  if (words.length < 8) return false;
  for (const n of [1, 2, 3, 4]) {
    const gram = new Map<string, number>();
    for (let i = 0; i + n <= words.length; i++) {
      const k = words.slice(i, i + n).join(" ");
      gram.set(k, (gram.get(k) ?? 0) + 1);
    }
    const top = Math.max(...gram.values());
    if (top * n > words.length * 0.6 && top >= 4) return true;
  }
  return false;
}

const round = (x: number) => Math.round(x * 100) / 100;

export type Paragraph = { start: number; end: number; segments: Segment[] };

/**
 * Groups segments into paragraphs the way a person would break a talk: at a pause of more
 * than 1.6 s, or after about 70 words once a sentence ends.
 */
export function paragraphs(segs: Segment[], pause = 1.6, softWords = 70): Paragraph[] {
  const out: Paragraph[] = [];
  let cur: Segment[] = [];
  let words = 0;
  const flush = () => {
    if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, segments: cur });
    cur = [];
    words = 0;
  };
  for (const s of segs) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const gap = s.start - prev.end;
      const sentenceDone = /[.!?…]["')\]]?$/.test(prev.text);
      if (gap > pause || (words > softWords && sentenceDone) || words > softWords * 2.2) flush();
    }
    cur.push(s);
    words += s.text.split(/\s+/).length;
  }
  flush();
  return out;
}

/** The segment playing at time t, by binary search. */
export function segmentAt(segs: Segment[], t: number): Segment | undefined {
  let lo = 0;
  let hi = segs.length - 1;
  let hit: Segment | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].start <= t) {
      hit = segs[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return hit && t <= hit.end + 0.6 ? hit : undefined;
}

export function wordCount(segs: Segment[]): number {
  return segs.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
}
