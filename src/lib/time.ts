const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");

/** 75.4 -> "1:15", 3725 -> "1:02:05" */
export function clock(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** SRT wants 00:01:15,400 and VTT wants 00:01:15.400 */
export function stamp(sec: number, sep: "," | "."): string {
  const s = Math.max(0, sec);
  const ms = Math.round((s % 1) * 1000);
  const whole = Math.floor(s) + (ms === 1000 ? 1 : 0);
  return `${pad(whole / 3600)}:${pad((whole % 3600) / 60)}:${pad(whole % 60)}${sep}${pad(ms === 1000 ? 0 : ms, 3)}`;
}

export function duration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function ago(ts: number, now = Date.now()): string {
  const d = (now - ts) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
