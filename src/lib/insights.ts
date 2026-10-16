import type { Segment } from "./types";

// English and Indonesian function words; anything else is left in and down-weighted by IDF.
const STOP = new Set(
  (
    "a an the and or but if then so of to in on at by for with from as is are was were be been being am do does did " +
    "have has had i you he she it we they me him her us them my your his its our their this that these those there here " +
    "what which who whom whose when where why how not no yes just very really also too can could would should will shall " +
    "may might must about into over under again more most some any all each few other such only own same than up down out " +
    "off now well like know think going go get got gonna wanna yeah okay ok oh um uh right thing things lot kind sort mean " +
    "say said one two because actually something everything anything people way let make made see want need us let's i'm " +
    "it's that's don't you're we're they're i've there's can't didn't doesn't isn't won't " +
    "yang dan di ke dari ini itu dengan untuk pada adalah dalam tidak akan juga atau kita kami saya aku kamu anda dia mereka " +
    "sudah belum ada bisa jadi karena kalau jika seperti lebih sangat apa siapa bagaimana kenapa mengapa tapi tetapi namun " +
    "lagi saja sih dong kan ya nah gitu gini begitu begini banyak semua setiap oleh para pun tersebut harus masih hanya " +
    "nya kok deh lah mau sama udah aja nggak gak enggak"
  ).split(" "),
);

// Everyday verbs make poor chapter names ("Add, Changed, Push"); they still count for similarity.
const ACTION = new Set(
  (
    "add added adding change changed changes changing take took taken put use used using run running ran open opened " +
    "fix fixed check checked show showed shown tell told give gave start started stop stopped keep kept try tried call " +
    "called come came look looked find found work worked works working feel felt turn turned move moved pass passed push " +
    "pull set sets let's talk talked ask asked help helped play played left right next last first new good great big little " +
    "buat bikin kasih pakai lihat coba ambil taruh jalan mulai"
  ).split(" "),
);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

type Vec = Map<string, number>;

function cosine(a: Vec, b: Vec): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const w = b.get(k);
    if (w) dot += v * w;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function tf(words: string[]): Vec {
  const m: Vec = new Map();
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

export type Chapter = { start: number; end: number; title: string; terms: string[]; firstSegment: number };

/**
 * TextTiling (Hearst, 1997): slide a window over the talk, measure how much the vocabulary on
 * the left overlaps the vocabulary on the right, and cut where the overlap dips deepest.
 * Each chapter is named by the words it uses far more than the rest of the talk does.
 */
export function chapters(segs: Segment[], targetMinutes = 4): Chapter[] {
  if (!segs.length) return [];
  const total = segs[segs.length - 1].end - segs[0].start;
  const want = Math.max(1, Math.min(14, Math.round(total / 60 / targetMinutes)));
  const segTokens = segs.map((s) => tokens(s.text));

  // Blocks of roughly 40 words, so similarity is not just noise between single lines.
  const blocks: { from: number; to: number; words: string[] }[] = [];
  let cur: string[] = [];
  let from = 0;
  segTokens.forEach((t, i) => {
    cur.push(...t);
    if (cur.length >= 40 || i === segs.length - 1) {
      blocks.push({ from, to: i, words: cur });
      cur = [];
      from = i + 1;
    }
  });

  let cuts: number[] = [];
  if (want > 1 && blocks.length > 4) {
    const k = 3;
    const gaps: number[] = [];
    for (let g = 1; g < blocks.length; g++) {
      const left = blocks.slice(Math.max(0, g - k), g).flatMap((b) => b.words);
      const right = blocks.slice(g, g + k).flatMap((b) => b.words);
      gaps.push(cosine(tf(left), tf(right)));
    }
    // Depth score: how far a dip sits below the peaks on each side.
    const depth = gaps.map((v, i) => {
      let l = v;
      for (let j = i; j >= 0 && gaps[j] >= l; j--) l = gaps[j];
      let r = v;
      for (let j = i; j < gaps.length && gaps[j] >= r; j++) r = gaps[j];
      return l - v + (r - v);
    });
    const minBlocks = Math.max(2, Math.floor(blocks.length / (want * 2.5)));
    const order = depth.map((d, i) => [d, i] as const).sort((a, b) => b[0] - a[0]);
    for (const [d, i] of order) {
      if (cuts.length >= want - 1 || d <= 0.02) break;
      const gap = i + 1;
      if (cuts.every((c) => Math.abs(c - gap) >= minBlocks) && gap >= minBlocks && blocks.length - gap >= minBlocks) cuts.push(gap);
    }
    cuts = cuts.sort((a, b) => a - b);
  }

  const bounds = [0, ...cuts, blocks.length];
  const parts = bounds.slice(0, -1).map((b, i) => {
    const bl = blocks.slice(b, bounds[i + 1]);
    return { first: bl[0].from, last: bl[bl.length - 1].to, words: bl.flatMap((x) => x.words) };
  });

  const df = new Map<string, number>();
  for (const p of parts) for (const w of new Set(p.words)) df.set(w, (df.get(w) ?? 0) + 1);
  const docFreqAll = new Map<string, number>();
  for (const t of segTokens) for (const w of new Set(t)) docFreqAll.set(w, (docFreqAll.get(w) ?? 0) + 1);

  return parts.map((p) => {
    const counts = tf(p.words);
    const scored = [...counts.entries()]
      .filter(([w, c]) => (c >= 2 || p.words.length < 60) && !ACTION.has(w))
      // Longer words are more often the subject of a passage than its glue, so they win ties.
      .map(([w, c]) => [w, c * Math.log(1 + parts.length / (df.get(w) ?? 1)) * Math.log(1 + segs.length / (docFreqAll.get(w) ?? 1)) * Math.sqrt(w.length)] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([w]) => w);
    const title = scored.length ? scored.slice(0, 3).map(cap).join(", ") : "Opening";
    return { start: segs[p.first].start, end: segs[p.last].end, title, terms: scored, firstSegment: p.first };
  });
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export type KeyLine = { segment: Segment; score: number };

/**
 * TextRank (Mihalcea & Tarau, 2004): every sentence votes for the sentences it resembles.
 * The lines most of the talk agrees with come out on top. They are quoted, never rewritten.
 */
export function keyLines(segs: Segment[], count = 5): KeyLine[] {
  const cands = segs
    .map((s, i) => ({ s, i, t: tokens(s.text) }))
    .filter((c) => c.t.length >= 5 && c.s.text.split(/\s+/).length <= 45);
  if (cands.length < 3) return [];
  const df = new Map<string, number>();
  for (const c of cands) for (const w of new Set(c.t)) df.set(w, (df.get(w) ?? 0) + 1);
  const vecs = cands.map((c) => {
    const v = tf(c.t);
    for (const [k, n] of v) v.set(k, n * Math.log(cands.length / (df.get(k) ?? 1)));
    return v;
  });
  const n = cands.length;
  const W = vecs.map((a, i) => vecs.map((b, j) => (i === j ? 0 : cosine(a, b))));
  const out = W.map((row) => row.reduce((x, y) => x + y, 0) || 1);
  let score = new Array(n).fill(1 / n);
  for (let it = 0; it < 30; it++) {
    score = score.map((_, i) => 0.15 / n + 0.85 * W.reduce((acc, row, j) => acc + (row[i] / out[j]) * score[j], 0));
  }
  const ranked = cands.map((c, i) => ({ segment: c.s, score: score[i], idx: c.i })).sort((a, b) => b.score - a.score);

  // Skip near-duplicates of a line already picked, then return in talk order.
  const picked: typeof ranked = [];
  for (const r of ranked) {
    if (picked.length >= count) break;
    const v = vecs[cands.findIndex((c) => c.s === r.segment)];
    if (picked.every((p) => cosine(v, vecs[cands.findIndex((c) => c.s === p.segment)]) < 0.5)) picked.push(r);
  }
  return picked.sort((a, b) => a.idx - b.idx).map(({ segment, score }) => ({ segment, score }));
}
