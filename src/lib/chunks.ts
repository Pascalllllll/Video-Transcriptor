export const SR = 16000;

export type Window = { start: number; end: number; silent: boolean }; // sample offsets

const FRAME = SR / 20; // 50 ms

/** RMS loudness of every 50 ms frame. */
export function frameEnergy(pcm: Float32Array): Float32Array {
  const n = Math.ceil(pcm.length / FRAME);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    const a = f * FRAME;
    const b = Math.min(pcm.length, a + FRAME);
    for (let i = a; i < b; i++) sum += pcm[i] * pcm[i];
    out[f] = Math.sqrt(sum / Math.max(1, b - a));
  }
  return out;
}

/**
 * Whisper reads 30 s at a time. Cutting blindly at 30 s splits words in half and the model
 * mishears both halves, so each cut goes to the quietest 150 ms between 20 s and 29.5 s.
 * Windows that are close to silent are flagged: Whisper invents text ("Thank you.") on silence.
 */
export function planWindows(pcm: Float32Array, minSec = 20, maxSec = 29.5): Window[] {
  const energy = frameEnergy(pcm);
  const total = pcm.length;
  const sorted = Array.from(energy).sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const silenceLine = Math.max(0.004, loud * 0.06);

  const windows: Window[] = [];
  let start = 0;
  while (start < total) {
    let end: number;
    if (total - start <= maxSec * SR) {
      end = total;
    } else {
      const fa = Math.floor((start + minSec * SR) / FRAME);
      const fb = Math.floor((start + maxSec * SR) / FRAME);
      let best = fb;
      let bestE = Infinity;
      for (let f = fa; f <= fb - 2; f++) {
        const e = energy[f] + energy[f + 1] + energy[f + 2];
        if (e < bestE) {
          bestE = e;
          best = f + 1;
        }
      }
      end = Math.min(total, best * FRAME + FRAME / 2);
    }
    const fs = Math.floor(start / FRAME);
    const fe = Math.ceil(end / FRAME);
    let voiced = 0;
    for (let f = fs; f < fe; f++) if (energy[f] > silenceLine) voiced++;
    windows.push({ start, end, silent: voiced < 6 }); // under 0.3 s of anything audible
    start = end;
  }
  return windows;
}
