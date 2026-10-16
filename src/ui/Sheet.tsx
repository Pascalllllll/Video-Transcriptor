import { memo, useEffect, useMemo, useRef } from "react";
import type { Segment } from "../lib/types";
import { paragraphs, type Paragraph } from "../lib/segments";
import { clock } from "../lib/time";

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Props = {
  segments: Segment[];
  activeId?: number;
  query: string;
  matchIndex: number;
  editing: boolean;
  showTimes: boolean;
  writing: boolean;
  onSeek(t: number): void;
  onEdit(id: number, text: string): void;
};

export function Sheet({ segments, activeId, query, matchIndex, editing, showTimes, writing, onSeek, onEdit }: Props) {
  const paras = useMemo(() => paragraphs(segments), [segments]);
  const re = useMemo(() => (query.trim().length > 1 ? new RegExp(escapeRe(query.trim()), "gi") : null), [query]);

  // Number the matches in reading order so "3 of 12" can point at one of them.
  const firstMatchOf = useMemo(() => {
    const m = new Map<number, number>();
    if (!re) return m;
    let n = 0;
    for (const s of segments) {
      const c = s.text.match(re)?.length ?? 0;
      if (c) {
        m.set(s.id, n);
        n += c;
      }
    }
    return m;
  }, [segments, re]);

  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!re) return;
    root.current?.querySelector(`[data-match="${matchIndex}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [matchIndex, re]);

  return (
    <div className={`sheet ${showTimes ? "" : "no-times"} ${editing ? "is-editing" : ""}`} ref={root}>
      {paras.map((p) => (
        <Para
          key={p.segments[0].id}
          p={p}
          activeId={p.segments.some((s) => s.id === activeId) ? activeId : undefined}
          re={re}
          firstMatchOf={firstMatchOf}
          matchIndex={matchIndex}
          editing={editing}
          onSeek={onSeek}
          onEdit={onEdit}
        />
      ))}
      {writing && (
        <p className="para writing" aria-live="polite">
          <span className="stamp" />
          <span className="text"><span className="caret" aria-hidden="true" />Listening</span>
        </p>
      )}
    </div>
  );
}

const Para = memo(function Para({ p, activeId, re, firstMatchOf, matchIndex, editing, onSeek, onEdit }: {
  p: Paragraph;
  activeId?: number;
  re: RegExp | null;
  firstMatchOf: Map<number, number>;
  matchIndex: number;
  editing: boolean;
  onSeek(t: number): void;
  onEdit(id: number, text: string): void;
}) {
  return (
    <p className="para">
      <button className="stamp" onClick={() => onSeek(p.start)} aria-label={`Play from ${clock(p.start)}`}>
        {clock(p.start)}
      </button>
      <span className="text">
        {p.segments.map((s, i) => (
          <span key={s.id}>
            {editing ? (
              <span
                className="seg"
                contentEditable
                suppressContentEditableWarning
                spellCheck
                role="textbox"
                aria-label={`Line at ${clock(s.start)}`}
                onBlur={(e) => {
                  const v = e.currentTarget.textContent?.replace(/\s+/g, " ").trim() ?? "";
                  if (v !== s.text) onEdit(s.id, v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                  if (e.key === "Escape") {
                    e.currentTarget.textContent = s.text;
                    e.currentTarget.blur();
                  }
                }}
              >
                {s.text}
              </span>
            ) : (
              <span className={`seg ${s.id === activeId ? "is-active" : ""}`} data-seg={s.id} onClick={() => onSeek(s.start)}>
                {re ? highlight(s.text, re, firstMatchOf.get(s.id) ?? 0, matchIndex) : s.text}
              </span>
            )}
            {i < p.segments.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    </p>
  );
});

function highlight(text: string, re: RegExp, first: number, current: number) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = first;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <mark key={i} data-match={n} className={n === current ? "is-current" : ""}>
        {m[0]}
      </mark>,
    );
    n++;
    last = i + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}
