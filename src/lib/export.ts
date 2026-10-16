import type { Transcript } from "./types";
import { paragraphs } from "./segments";
import { clock, stamp } from "./time";

export type Format = "txt" | "docx" | "srt" | "vtt" | "md";

export const FORMATS: { key: Format; label: string; hint: string }[] = [
  { key: "docx", label: "Word document", hint: ".docx, with paragraphs and timestamps" },
  { key: "txt", label: "Plain text", hint: ".txt, paragraphs only" },
  { key: "md", label: "Markdown", hint: ".md, for Notion, Obsidian or GitHub" },
  { key: "srt", label: "Subtitles (SRT)", hint: ".srt, for Premiere, CapCut or YouTube" },
  { key: "vtt", label: "Subtitles (WebVTT)", hint: ".vtt, for web players" },
];

export function plainText(t: Transcript, withTimes: boolean): string {
  return paragraphs(t.segments)
    .map((p) => (withTimes ? `[${clock(p.start)}] ` : "") + p.segments.map((s) => s.text).join(" "))
    .join("\n\n");
}

/** Subtitle cues of at most ~84 characters, two lines of 42, so they fit on screen. */
function cues(t: Transcript) {
  const out: { start: number; end: number; text: string }[] = [];
  for (const s of t.segments) {
    const words = s.text.split(/\s+/);
    if (s.text.length <= 84) {
      out.push({ start: s.start, end: s.end, text: wrap(s.text) });
      continue;
    }
    const parts: string[][] = [[]];
    for (const w of words) {
      const last = parts[parts.length - 1];
      if ([...last, w].join(" ").length > 84) parts.push([w]);
      else last.push(w);
    }
    const span = (s.end - s.start) / s.text.length;
    let at = s.start;
    for (const p of parts) {
      const text = p.join(" ");
      const end = Math.min(s.end, at + span * (text.length + 1));
      out.push({ start: at, end, text: wrap(text) });
      at = end;
    }
  }
  return out;
}

function wrap(text: string): string {
  if (text.length <= 42) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

export function srt(t: Transcript): string {
  return cues(t)
    .map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`)
    .join("\n");
}

export function vtt(t: Transcript): string {
  return "WEBVTT\n\n" + cues(t).map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n`).join("\n");
}

export function markdown(t: Transcript): string {
  const head = `# ${t.title}\n\n${t.source.url ? `Source: ${t.source.url}\n\n` : ""}${t.summary ? `## Summary\n\n${t.summary.text}\n\n## Transcript\n\n` : ""}`;
  return head + paragraphs(t.segments).map((p) => `**${clock(p.start)}**  ${p.segments.map((s) => s.text).join(" ")}`).join("\n\n") + "\n";
}

export async function docx(t: Transcript): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const body = paragraphs(t.segments).map(
    (p) =>
      new Paragraph({
        spacing: { after: 200, line: 300 },
        children: [
          new TextRun({ text: `${clock(p.start)}   `, color: "6B6658", size: 18 }),
          new TextRun({ text: p.segments.map((s) => s.text).join(" "), size: 23 }),
        ],
      }),
  );
  const doc = new Document({
    creator: "Scribe",
    title: t.title,
    styles: { default: { document: { run: { font: "Georgia" } } } },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t.title })] }),
          ...(t.source.url ? [new Paragraph({ spacing: { after: 300 }, children: [new TextRun({ text: t.source.url, color: "6B6658", size: 18 })] })] : []),
          ...(t.summary
            ? [
                new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Summary" })] }),
                ...t.summary.text.split(/\n+/).filter((l) => l.trim()).map((l) =>
                  /^[-*•]\s+/.test(l.trim())
                    ? new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: l.trim().replace(/^[-*•]\s+/, "").replace(/\*\*/g, ""), size: 23 })] })
                    : new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: l.trim().replace(/\*\*/g, ""), size: 23 })] }),
                ),
                new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300 }, children: [new TextRun({ text: "Transcript" })] }),
              ]
            : []),
          ...body,
        ],
      },
    ],
  });
  return Packer.toBlob(doc);
}

export function fileName(t: Transcript, f: Format): string {
  const base = t.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "transcript";
  return `${base}.${f}`;
}

export async function render(t: Transcript, f: Format, withTimes = true): Promise<Blob> {
  if (f === "docx") return docx(t);
  const text = f === "txt" ? plainText(t, withTimes) : f === "srt" ? srt(t) : f === "vtt" ? vtt(t) : markdown(t);
  return new Blob([text], { type: f === "md" ? "text/markdown" : f === "txt" ? "text/plain" : "text/" + f });
}
