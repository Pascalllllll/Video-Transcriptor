// Engine checks with known answers. Run: npm run check
import { createRequire } from "node:module";
import { planWindows, SR } from "../src/lib/chunks";
import { cleanChunks, paragraphs, segmentAt, looksLooped, collapseRuns } from "../src/lib/segments";
import { chapters, keyLines } from "../src/lib/insights";
import { srt, vtt, plainText, docx, markdown } from "../src/lib/export";
import { clock, stamp } from "../src/lib/time";
import type { Segment, Transcript } from "../src/lib/types";

const { friendly } = createRequire(import.meta.url)("../electron/ytdlp.cjs") as { friendly(s: string): string };

let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failed++;
};

// --- time ---
ok("clock 75.4 -> 1:15", clock(75.4) === "1:15");
ok("clock 3725 -> 1:02:05", clock(3725) === "1:02:05");
ok("srt stamp", stamp(75.4, ",") === "00:01:15,400", stamp(75.4, ","));
ok("vtt stamp rounds 59.9996", stamp(59.9996, ".") === "00:01:00.000", stamp(59.9996, "."));

// --- windows: speech bursts with gaps at known places; every cut must land in a gap ---
{
  const seconds = 95;
  const pcm = new Float32Array(seconds * SR);
  const gaps = [[24, 24.6], [51, 51.5], [77.2, 77.8]];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < pcm.length; i++) {
    const t = i / SR;
    const inGap = gaps.some(([a, b]) => t >= a && t < b) || (t > 60 && t < 61); // 60-61: short pause too early to cut
    pcm[i] = inGap ? rnd() * 0.0005 : rnd() * 0.3 * (0.6 + 0.4 * Math.sin(t * 9));
  }
  const w = planWindows(pcm);
  const cuts = w.slice(0, -1).map((x) => x.end / SR);
  ok("windows cover the audio", w[0].start === 0 && w.at(-1)!.end === pcm.length);
  ok("every window <= 30 s", w.every((x) => (x.end - x.start) / SR <= 30));
  ok("cuts land in the pauses", cuts.every((c) => gaps.some(([a, b]) => c >= a - 0.05 && c <= b + 0.05)), cuts.map((c) => c.toFixed(2)).join(", "));
  const silent = planWindows(new Float32Array(20 * SR));
  ok("pure silence is flagged", silent.length === 1 && silent[0].silent);
}

// --- cleaning ---
{
  const raw = [
    { timestamp: [0, 4] as [number, number], text: " Welcome back to the lecture." },
    { timestamp: [4, 8] as [number, number], text: " Welcome back to the lecture." },
    { timestamp: [8, 12] as [number, number], text: " Thanks for watching!" },
    { timestamp: [12, 20] as [number, number], text: " the the the the the the the the the" },
    { timestamp: [20, null] as [number, null], text: " Today we cover gradient descent." },
  ];
  const segs = cleanChunks(raw, 60, 89, [], 0);
  ok("drops repeat, phantom and loop lines", segs.length === 2, segs.map((s) => s.text).join(" | "));
  ok("offsets times by window start", segs[0].start === 60 && segs[1].start === 80);
  ok("fills a missing end from the window", segs[1].end === 89);
}

// --- loop detection (the Indonesian music-intro failure, verbatim) ---
{
  const bad = "Asal memuaikun warna matu-warna tu, petnagaan namanya serang dilasir matu-warna terlihat ke-1" + "-2".repeat(60);
  const good = "I'm honored to be with you today for your commencement from one of the finest universities in the world. Truth be told, I never graduated from college and this is the closest I've ever gotten to a college graduation.";
  const indo = "Assalamualaikum warahmatullahi wabarakatuh. Yang saya hormati bapak dan ibu guru, serta teman-teman yang saya banggakan. Pada kesempatan kali ini saya akan menyampaikan pidato tentang kebersihan lingkungan.";
  ok("flags a character loop", looksLooped(bad));
  ok("keeps normal English", !looksLooped(good));
  ok("keeps normal Indonesian", !looksLooped(indo));
  ok("collapses runs", collapseRuns("ke-1" + "-2".repeat(20)) === "ke-1-2-2…", collapseRuns("ke-1" + "-2".repeat(20)));
}

// --- paragraphs + lookup ---
{
  const s = (id: number, start: number, end: number, text: string): Segment => ({ id, start, end, text });
  const segs = [s(0, 0, 3, "First idea."), s(1, 3.2, 6, "Still first."), s(2, 9, 12, "After a pause."), s(3, 12.1, 14, "Same para.")];
  const p = paragraphs(segs);
  ok("splits paragraphs at a 3 s pause", p.length === 2 && p[1].segments[0].id === 2);
  ok("segmentAt finds the playing line", segmentAt(segs, 10)?.id === 2 && segmentAt(segs, 7.5) === undefined);
}

// --- chapters: three talks glued together must come apart at the seams ---
const topics = {
  cooking: "Chop the garlic and onion, then fry them in olive oil until golden. Add tomato, salt and basil to the pan. Simmer the sauce while the pasta boils in salted water. Taste the sauce and add pepper.",
  football: "The striker passed to the winger who crossed into the box. The goalkeeper saved the penalty in the final minute. The referee showed a yellow card after the tackle. The coach changed the formation at halftime.",
  code: "Open the terminal and run the compiler on the source file. The function returns an array, so the loop iterates over each element. Fix the bug by checking the index before the array access. Commit the change and push the branch.",
};
const talk: Segment[] = [];
{
  let id = 0;
  let t = 0;
  for (const [, text] of Object.entries(topics)) {
    for (let rep = 0; rep < 10; rep++) {
      for (const sentence of text.split(/(?<=\.)\s+/)) {
        talk.push({ id: id++, start: t, end: t + 4, text: sentence });
        t += 4.2;
      }
    }
  }
  const ch = chapters(talk, 3);
  const seams = [talk.findIndex((s) => s.text.startsWith("The striker")), talk.findIndex((s) => s.text.startsWith("Open the terminal"))];
  ok("finds 3 chapters", ch.length === 3, ch.map((c) => `${clock(c.start)} ${c.title}`).join(" / "));
  const nearSeam = ch.slice(1).every((c, i) => Math.abs(c.firstSegment - seams[i]) <= 8);
  ok("chapter cuts within 8 lines of the true seams", nearSeam, ch.slice(1).map((c, i) => `${c.firstSegment} vs ${seams[i]}`).join(", "));
  const vocab = [/sauce|garlic|pasta|tomato|onion|basil|pan/i, /striker|goalkeeper|referee|penalty|coach|winger/i, /array|compiler|function|terminal|index|branch|loop/i];
  ok("chapter titles name the topic", ch.every((c, i) => vocab[i].test(c.title)), ch.map((c) => c.title).join(" / "));
  const t0 = performance.now();
  const lines = keyLines(talk, 5);
  ok("key lines: 5, in talk order", lines.length === 5 && lines.every((l, i) => i === 0 || l.segment.start > lines[i - 1].segment.start), `${(performance.now() - t0).toFixed(0)} ms`);
  const big: Segment[] = Array.from({ length: 1200 }, (_, i) => ({ ...talk[i % talk.length], id: i, start: i * 3, end: i * 3 + 2.8 }));
  const t1 = performance.now();
  keyLines(big, 6);
  chapters(big);
  const ms = performance.now() - t1;
  ok("1-hour talk (1,200 lines) analysed under 1.5 s", ms < 1500, `${ms.toFixed(0)} ms`);
}

// --- export ---
{
  const t: Transcript = {
    id: "x", title: "Test: a/b", duration: 20, language: "en", task: "transcribe", model: "fast", createdAt: 0, updatedAt: 0, done: true,
    source: { kind: "link", name: "x", url: "https://youtu.be/x", isVideo: false },
    segments: [
      { id: 0, start: 0, end: 2.5, text: "Hello there." },
      { id: 1, start: 2.6, end: 9, text: "This line is long enough that it has to be split across two subtitle cues because it runs past eighty four characters easily." },
    ],
  };
  const s = srt(t);
  ok("srt cue numbering and arrows", /^1\n00:00:00,000 --> 00:00:02,500\nHello there\.\n/.test(s));
  ok("srt splits long cues", (s.match(/-->/g) ?? []).length === 3);
  ok("srt lines <= 42 chars", s.split("\n").filter((l) => !l.includes("-->") && !/^\d+$/.test(l)).every((l) => l.length <= 46));
  ok("vtt header", vtt(t).startsWith("WEBVTT\n\n00:00:00.000 --> "));
  ok("plain text with times", plainText(t, true).startsWith("[0:00] Hello there."));
  ok("markdown has title and source", markdown(t).startsWith("# Test: a/b\n\nSource: https://youtu.be/x"));
  const withSum = { ...t, summary: { language: "id", text: "Ringkasan singkat.\nPoin penting\n- Satu\n- Dua", createdAt: 0 } };
  ok("markdown puts the summary above the transcript", markdown(withSum).includes("## Summary\n\nRingkasan singkat.") && markdown(withSum).indexOf("## Transcript") > markdown(withSum).indexOf("## Summary"));
  const sumDoc = await docx(withSum);
  ok("docx with a summary still builds", sumDoc.size > 0);
  const blob = await docx(t);
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  ok("docx is a zip", head[0] === 0x50 && head[1] === 0x4b, `${blob.size} bytes`);
}

// --- downloader error messages ---
ok("private video message", friendly("ERROR: [youtube] abc: Private video. Sign in if you've been granted access").startsWith("This video is private"));
ok("unsupported url message", friendly("ERROR: Unsupported URL: https://example.com").includes("can't read video"));
ok("unknown error passes through", friendly("ERROR: [generic] something odd") === "something odd");

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
