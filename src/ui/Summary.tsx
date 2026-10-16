import { useState } from "react";
import type { Transcript } from "../lib/types";
import type { TextJob } from "../useText";
import { SUMMARY_MB } from "../useText";
import { COMMON_TARGETS, TARGETS, target, targetName } from "../lib/targets";

/** Splits the model's plain text into a summary paragraph and bullet points for display. */
function Formatted({ text }: { text: string }) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={`u${out.length}`}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>);
    bullets = [];
  };
  for (const l of lines) {
    const b = l.match(/^[-*•]\s+(.*)$/) ?? l.match(/^\d+[.)]\s+(.*)$/);
    if (b) bullets.push(b[1].replace(/\*\*/g, ""));
    else {
      flush();
      const clean = l.replace(/\*\*/g, "").replace(/^#+\s*/, "");
      // A short line with no full stop is the "Key points" heading in whatever language.
      out.push(clean.length < 40 && !/[.!?。]$/.test(clean) ? <h3 key={`h${out.length}`}>{clean.replace(/:$/, "")}</h3> : <p key={`p${out.length}`}>{clean}</p>);
    }
  }
  flush();
  return <>{out}</>;
}

export function SummaryPanel({ t, job, ready, defaultLang, onWrite, onCancel, say }: {
  t: Transcript;
  job: TextJob;
  ready: boolean;
  defaultLang: string;
  onWrite(lang: string): void;
  onCancel(): void;
  say(m: string): void;
}) {
  const [lang, setLang] = useState(() => (target(defaultLang) ? defaultLang : "en"));
  const writing = job.kind === "summary";

  const picker = (
    <label className="sum-lang">
      <span>Write it in</span>
      <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={writing}>
        <optgroup label="Common">
          {COMMON_TARGETS.map((c) => <option key={c} value={c}>{targetName(c)}</option>)}
        </optgroup>
        <optgroup label="All languages">
          {TARGETS.filter((x) => !COMMON_TARGETS.includes(x.code)).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
        </optgroup>
      </select>
    </label>
  );

  if (writing) {
    const mb = (n?: number) => `${Math.round((n ?? 0) / 1e6)} MB`;
    return (
      <div className="summary" aria-live="polite">
        {job.phase === "download" ? (
          <>
            <p className="quiet">Downloading the summary model, {mb(job.loaded)} of {mb(Math.max(job.total ?? 0, SUMMARY_MB * 1e6))}. Only the first time.</p>
            <div className="meter"><span style={{ width: `${((job.loaded ?? 0) / Math.max(1, job.total ?? 1)) * 100}%` }} /></div>
          </>
        ) : job.draft ? (
          <div className="sum-text is-drafting"><Formatted text={job.draft} /></div>
        ) : (
          <p className="quiet">{job.stage ?? "Reading the transcript…"}</p>
        )}
        <button className="tool small" onClick={onCancel}>Stop</button>
      </div>
    );
  }

  if (t.summary) {
    return (
      <div className="summary">
        <p className="sum-meta">{targetName(t.summary.language)}</p>
        <div className="sum-text"><Formatted text={t.summary.text} /></div>
        <div className="sum-actions">
          <button className="tool small" onClick={async () => {
            try {
              await navigator.clipboard.writeText(t.summary!.text);
              say("Summary copied.");
            } catch {
              say("The clipboard is blocked here.");
            }
          }}>Copy</button>
          {picker}
          <button className="tool small" onClick={() => onWrite(lang)} disabled={!ready}>Write again</button>
        </div>
        <p className="fine">Written by Qwen2.5, a small AI model, from this transcript only. Check names and numbers before you share it.</p>
      </div>
    );
  }

  return (
    <div className="summary">
      <p className="quiet">A short summary and the key points, in any language.</p>
      {picker}
      <button className="primary small" onClick={() => onWrite(lang)} disabled={!ready}>Write a summary</button>
      <p className="fine">
        {ready
          ? `Runs on your graphics card. The model is a ${(SUMMARY_MB / 1000).toFixed(1)} GB download the first time.`
          : "Available once the transcript is finished."}
      </p>
    </div>
  );
}
