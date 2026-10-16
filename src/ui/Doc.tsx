import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Transcript } from "../lib/types";
import type { Job } from "../useTranscriber";
import { mediaSrc } from "../useTranscriber";
import { chapters, keyLines } from "../lib/insights";
import { segmentAt, wordCount } from "../lib/segments";
import { FORMATS, fileName, plainText, render } from "../lib/export";
import { clock, duration } from "../lib/time";
import { languageName } from "../lib/languages";
import { modelSpec } from "../lib/models";
import { Player, type PlayerHandle } from "./Player";
import { Sheet, escapeRe } from "./Sheet";
import { Menu } from "./Menu";
import { Back, Close, Copy, Find, Follow, Pen, Save, Clock } from "./icons";
import { useText, TRANSLATE_MB } from "../useText";
import { COMMON_TARGETS, TARGETS, targetName } from "../lib/targets";
import { SummaryPanel } from "./Summary";

type Props = {
  t: Transcript;
  job: Job;
  live: boolean; // this transcript is the one being written right now
  onBack(): void;
  onChange(t: Transcript): void;
  onCancel(): void;
  onResume(): void;
  say(msg: string): void;
};

export function Doc({ t, job, live, onBack, onChange, onCancel, onResume, say }: Props) {
  const player = useRef<PlayerHandle>(null);
  const findBox = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const [showTimes, setShowTimes] = useState(true);
  const [editing, setEditing] = useState(false);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [tab, setTab] = useState<"summary" | "chapters" | "lines">("chapters");
  const [view, setView] = useState<string | null>(null); // null = the original language
  const text = useText(t, onChange);
  const src = mediaSrc(t);
  const original = t.task === "translate" ? "en" : t.language;

  // What the page shows: the original, or a translation line by line (original where a line
  // isn't translated yet). Find, edit, copy and save all work on what's shown.
  const shown = useMemo<Transcript>(() => {
    if (!view) return t;
    const lines = t.translations?.[view]?.lines ?? {};
    return { ...t, title: `${t.title} (${targetName(view)})`, segments: t.segments.map((s) => (lines[s.id] != null ? { ...s, text: lines[s.id] } : s)) };
  }, [t, view]);

  const working = live && ["fetching", "reading", "model", "transcribing"].includes(job.phase);
  // Nothing is highlighted until playback has started, so an unplayed page reads clean.
  const active = playing || now > 0 ? segmentAt(t.segments, now) : undefined;

  // Chapters and key lines are recomputed only every ~20 new lines while writing.
  const bucket = t.done ? -1 : Math.floor(t.segments.length / 20);
  const insight = useMemo(
    () => ({ chapters: chapters(t.segments), lines: keyLines(t.segments, 6) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucket, t.id, t.done],
  );

  const hasChapters = insight.chapters.length > 1;
  useEffect(() => setTab((cur) => (cur === "summary" ? cur : hasChapters ? "chapters" : "lines")), [hasChapters]);

  const matches = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return 0;
    const re = new RegExp(escapeRe(q), "gi");
    return shown.segments.reduce((n, s) => n + (s.text.match(re)?.length ?? 0), 0);
  }, [query, shown.segments]);

  useEffect(() => setMatchIndex(0), [query]);

  // Follow along: keep the spoken line in view, unless the reader scrolled away in the last 4 s.
  const lastUserScroll = useRef(0);
  useEffect(() => {
    const mark = () => (lastUserScroll.current = Date.now());
    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("touchmove", mark, { passive: true });
    return () => {
      window.removeEventListener("wheel", mark);
      window.removeEventListener("touchmove", mark);
    };
  }, []);
  useEffect(() => {
    if (!follow || !playing || active == null || Date.now() - lastUserScroll.current < 4000) return;
    const el = document.querySelector(`[data-seg="${active.id}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 140 || r.bottom > window.innerHeight - 80) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active?.id, follow, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest("input, textarea, select, [contenteditable=true]");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        // Render the find bar now and focus it inside this keystroke, so the next keys land in it.
        flushSync(() => setFinding(true));
        findBox.current?.select();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " " && !target.closest("button")) {
        e.preventDefault();
        player.current?.toggle();
      } else if (e.key === "ArrowLeft") player.current?.nudge(-5);
      else if (e.key === "ArrowRight") player.current?.nudge(5);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const seek = useCallback((s: number) => player.current?.seek(s), []);
  const onTime = useCallback((s: number) => setNow(s), []);
  const edit = useCallback(
    (id: number, value: string) => {
      if (view) {
        const tr = t.translations?.[view] ?? { lines: {}, done: false, updatedAt: 0 };
        onChange({ ...t, translations: { ...t.translations, [view]: { ...tr, lines: { ...tr.lines, [id]: value }, updatedAt: Date.now() } }, updatedAt: Date.now() });
      } else onChange({ ...t, segments: t.segments.map((s) => (s.id === id ? { ...s, text: value } : s)).filter((s) => s.text), updatedAt: Date.now() });
    },
    [onChange, t, view],
  );

  const replaceAll = () => {
    const q = query.trim();
    if (q.length < 2 || !matches) return;
    const re = new RegExp(escapeRe(q), "gi");
    if (view) {
      const tr = t.translations?.[view] ?? { lines: {}, done: false, updatedAt: 0 };
      const lines = Object.fromEntries(shown.segments.map((s) => [s.id, s.text.replace(re, replace)]));
      onChange({ ...t, translations: { ...t.translations, [view]: { ...tr, lines, updatedAt: Date.now() } }, updatedAt: Date.now() });
    } else onChange({ ...t, segments: t.segments.map((s) => ({ ...s, text: s.text.replace(re, replace) })), updatedAt: Date.now() });
    say(`Replaced ${matches} ${matches === 1 ? "match" : "matches"} with "${replace}".`);
    setQuery(replace);
  };

  const download = async (f: (typeof FORMATS)[number]["key"]) => {
    const blob = await render(shown, f, showTimes);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName(shown, f);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say(`Saved ${a.download}`);
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(plainText(shown, showTimes));
      say(`Copied ${wordCount(shown.segments).toLocaleString()} words.`);
    } catch {
      say("The clipboard is blocked here. Use Save as plain text instead.");
    }
  };

  const words = wordCount(t.segments);
  const progress = t.duration ? Math.min(1, (job.upTo ?? 0) / t.duration) : 0;

  return (
    <div className="doc">
      <header className="doc-head">
        <button className="tool back" onClick={onBack}>
          <Back /> <span>All transcripts</span>
        </button>
        <div className="doc-title">
          <input
            className="title-input"
            value={t.title}
            aria-label="Transcript title"
            onChange={(e) => onChange({ ...t, title: e.target.value, updatedAt: Date.now() })}
          />
          <p className="meta">
            {t.duration > 0 && <span>{duration(t.duration)}</span>}
            {t.language && <span>{languageName(t.language)}{t.task === "translate" ? ", translated to English" : ""}</span>}
            <span>{modelSpec(t.model).label} model</span>
            {words > 0 && <span>{words.toLocaleString()} words</span>}
            {t.source.url && (
              <a href={t.source.url} target="_blank" rel="noreferrer">
                Open source
              </a>
            )}
          </p>
        </div>
      </header>

      {live && job.phase !== "idle" && job.phase !== "done" && (
        <Progress job={job} t={t} progress={progress} onCancel={onCancel} onResume={onResume} />
      )}
      {!live && !t.done && (
        <div className="status-line">
          <p>
            Stopped at {clock(t.segments.at(-1)?.end ?? 0)} of {clock(t.duration)}.
            {t.source.kind === "file" && !src ? " Drop the original file on this window to continue." : ""}
          </p>
          {(src || t.source.kind === "link") && (
            <button className="primary small" onClick={onResume}>Continue writing</button>
          )}
        </div>
      )}

      <div className="doc-body">
        <aside className="side">
          <Player ref={player} t={t} src={src} onTime={onTime} onPlaying={setPlaying} />
          {t.segments.length > 0 ? (
            <section className="insights" aria-label="Overview">
              <div className="tabs" role="tablist">
                <button role="tab" aria-selected={tab === "summary"} onClick={() => setTab("summary")}>Summary</button>
                <button role="tab" aria-selected={tab === "chapters"} onClick={() => setTab("chapters")}>Chapters</button>
                <button role="tab" aria-selected={tab === "lines"} onClick={() => setTab("lines")}>Key lines</button>
              </div>
              {tab === "summary" ? (
                <SummaryPanel t={t} job={text.job} ready={t.done} defaultLang={view ?? original} onWrite={(lang) => void text.summarize(lang)} onCancel={text.cancel} say={say} />
              ) : tab === "chapters" ? (
                insight.chapters.length > 1 ? (
                  <ol className="chapters">
                    {insight.chapters.map((c) => (
                      <li key={c.start} className={now >= c.start && now < c.end + 0.5 ? "is-here" : ""}>
                        <button onClick={() => seek(c.start)}>
                          <span className="ch-time">{clock(c.start)}</span>
                          <span className="ch-title">{c.title}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="quiet">Too short to split into chapters.</p>
                )
              ) : (
                <ul className="lines">
                  {insight.lines.map((l) => (
                    <li key={l.segment.id}>
                      <button onClick={() => seek(l.segment.start)}>
                        <q>{l.segment.text}</q>
                        <span className="ch-time">{clock(l.segment.start)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {tab !== "summary" && <p className="fine">
                {tab === "chapters"
                  ? "Split where the vocabulary changes, named by the words each part uses most."
                  : "Quoted word for word: the lines the rest of the talk echoes most."}
              </p>}
            </section>
          ) : null}
        </aside>

        <main className="page" id="main">
          <div className="toolbar" role="toolbar" aria-label="Transcript tools">
            <button className={`tool ${finding ? "is-on" : ""}`} onClick={() => {
              flushSync(() => setFinding((f) => !f));
              findBox.current?.focus();
            }} aria-pressed={finding}>
              <Find /> <span>Find</span>
            </button>
            <button className={`tool ${editing ? "is-on" : ""}`} onClick={() => setEditing((e) => !e)} aria-pressed={editing} disabled={working && !t.segments.length}>
              <Pen /> <span>{editing ? "Done editing" : "Edit"}</span>
            </button>
            <button className={`tool ${showTimes ? "is-on" : ""}`} onClick={() => setShowTimes((s) => !s)} aria-pressed={showTimes}>
              <Clock /> <span>Times</span>
            </button>
            {src && (
              <button className={`tool ${follow ? "is-on" : ""}`} onClick={() => setFollow((f) => !f)} aria-pressed={follow} title="Scroll with the audio">
                <Follow /> <span>Follow</span>
              </button>
            )}
            <label className="langpick">
              <span className="sr">Language shown</span>
              <select
                value={view ?? ""}
                disabled={!t.segments.length || working}
                onChange={(e) => {
                  const v = e.target.value || null;
                  setView(v);
                  if (v && !t.translations?.[v]?.done) void text.translate(v);
                }}
              >
                <option value="">{languageName(original) || "Original"} (original)</option>
                {Object.keys(t.translations ?? {}).length > 0 && (
                  <optgroup label="Translated">
                    {Object.keys(t.translations!).map((c) => (
                      <option key={c} value={c}>{targetName(c)}{t.translations![c].done ? "" : " (part)"}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Translate to">
                  {COMMON_TARGETS.filter((c) => c !== original && !t.translations?.[c]).map((c) => (
                    <option key={c} value={c}>{targetName(c)}</option>
                  ))}
                </optgroup>
                <optgroup label="All languages">
                  {TARGETS.filter((x) => !COMMON_TARGETS.includes(x.code) && x.code !== original && !t.translations?.[x.code]).map((x) => (
                    <option key={x.code} value={x.code}>{x.name}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <span className="spacer" />
            <button className="tool" onClick={copyAll} disabled={!t.segments.length}>
              <Copy /> <span>Copy text</span>
            </button>
            {t.segments.length ? (
              <Menu label="Save as" icon={<Save />} items={FORMATS.map((f) => ({ key: f.key, label: f.label, hint: f.hint, onSelect: () => void download(f.key) }))} />
            ) : (
              <button className="tool" disabled>
                <Save /> <span>Save as</span>
              </button>
            )}
          </div>

          <TextStatus job={text.job} view={view} onCancel={text.cancel} onDismiss={() => text.cancel()} />

          {finding && (
            <div className="findbar">
              <label className="field">
                <span className="sr">Find</span>
                <input
                  ref={findBox}
                  value={query}
                  placeholder="Find a word or name"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && matches) setMatchIndex((i) => (i + (e.shiftKey ? matches - 1 : 1)) % matches);
                    if (e.key === "Escape") {
                      setFinding(false);
                      setQuery("");
                    }
                  }}
                />
              </label>
              <span className="count" aria-live="polite">
                {query.trim().length > 1 ? (matches ? `${matchIndex + 1} of ${matches}` : "No matches") : ""}
              </span>
              <label className="field">
                <span className="sr">Replace with</span>
                <input value={replace} placeholder="Replace with" onChange={(e) => setReplace(e.target.value)} onKeyDown={(e) => e.key === "Enter" && replaceAll()} />
              </label>
              <button className="tool" onClick={replaceAll} disabled={!matches}>Replace all</button>
              <button className="icon" aria-label="Close find" onClick={() => {
                setFinding(false);
                setQuery("");
              }}>
                <Close />
              </button>
            </div>
          )}

          {t.segments.length ? (
            <Sheet
              segments={shown.segments}
              activeId={active?.id}
              query={finding ? query : ""}
              matchIndex={matchIndex}
              editing={editing}
              showTimes={showTimes}
              writing={working && job.phase === "transcribing"}
              onSeek={seek}
              onEdit={edit}
            />
          ) : (
            <EmptySheet job={job} live={live} />
          )}
        </main>
      </div>
    </div>
  );
}

/** One line under the toolbar while translating; also where translation errors land. */
function TextStatus({ job, view, onCancel, onDismiss }: { job: ReturnType<typeof useText>["job"]; view: string | null; onCancel(): void; onDismiss(): void }) {
  if (job.kind === "idle" || job.kind === "summary") return null;
  if (job.kind === "error")
    return (
      <div className="textstatus is-error" role="alert">
        <p>{job.message}</p>
        <button className="tool" onClick={onDismiss}>Dismiss</button>
      </div>
    );
  const mb = (n?: number) => `${Math.round((n ?? 0) / 1e6)} MB`;
  const label =
    job.phase === "download"
      ? `Downloading the translator, ${mb(job.loaded)} of ${mb(Math.max(job.total ?? 0, TRANSLATE_MB.wasm * 1e6))}. Only the first time.`
      : `Translating into ${targetName(job.lang)}, ${job.done ?? 0} of ${job.of ?? 0} lines${view !== job.lang ? " (in the background)" : ""}`;
  const pct = job.phase === "download" ? ((job.loaded ?? 0) / Math.max(1, job.total ?? 1)) * 100 : ((job.done ?? 0) / Math.max(1, job.of ?? 1)) * 100;
  return (
    <div className="textstatus" role="status">
      <div className="progress-row">
        <p>{label}</p>
        <button className="tool" onClick={onCancel}>Stop</button>
      </div>
      <div className="meter"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function EmptySheet({ job, live }: { job: Job; live: boolean }) {
  if (live && job.phase === "error") return null;
  const msg = !live
    ? "This transcript has no text yet."
    : job.phase === "fetching"
      ? "The text will start appearing here as soon as the video is downloaded."
      : job.phase === "transcribing"
        ? "Listening to the first half minute."
        : "The text will start appearing here in a moment.";
  return (
    <div className="sheet empty">
      <div className="rules" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
      <p>{msg}</p>
    </div>
  );
}

function Progress({ job, t, progress, onCancel, onResume }: { job: Job; t: Transcript; progress: number; onCancel(): void; onResume(): void }) {
  const mb = (n: number) => `${Math.round(n / 1e6)} MB`;
  let label = "";
  let pct: number | null = null;
  switch (job.phase) {
    case "fetching":
      if (job.link?.stage === "tool") {
        label = "Setting up the downloader. This happens once.";
        pct = job.link.percent;
      } else if (job.link?.stage === "download") {
        label = `Downloading the audio${job.link.eta && job.link.eta !== "Unknown" ? `, ${job.link.eta} left` : ""}`;
        pct = job.link.percent;
      } else label = "Opening the link";
      break;
    case "reading":
      label = "Reading the audio track";
      break;
    case "model":
      if (job.model?.total) {
        // Files start one by one, so the running total undercounts; the listed size is the honest denominator.
        const known = (modelSpec(t.model).variants[job.backend ?? "wasm"]?.mb ?? 0) * 1e6;
        const total = Math.max(job.model.total, known);
        label = `Downloading the ${modelSpec(t.model).label} model, ${mb(job.model.loaded)} of ${mb(total)}. Only the first time.`;
        pct = (job.model.loaded / total) * 100;
      } else label = "Loading the speech model";
      break;
    case "transcribing":
      label = `Writing, ${clock(job.upTo ?? 0)} of ${clock(t.duration)}${job.eta && job.eta > 2 ? `, about ${duration(job.eta)} left` : ""}`;
      pct = progress * 100;
      break;
    case "cancelled":
      label = `Stopped at ${clock(t.segments.at(-1)?.end ?? 0)}. Everything written so far is kept.`;
      break;
    case "error":
      label = job.error ?? "Something went wrong.";
      break;
  }
  const busy = ["fetching", "reading", "model", "transcribing"].includes(job.phase);
  return (
    <div className={`progress ${job.phase === "error" ? "is-error" : ""}`} role="status">
      <div className="progress-row">
        <p>
          {label}
          {job.language && job.phase === "transcribing" && (
            <span className="dim"> · heard {languageName(job.language.code)}</span>
          )}
        </p>
        {busy ? (
          <button className="tool" onClick={onCancel}>Stop</button>
        ) : job.phase === "cancelled" || job.phase === "error" ? (
          <button className="primary small" onClick={onResume}>{t.segments.length ? "Continue writing" : "Try again"}</button>
        ) : null}
      </div>
      {busy && (
        <div className={`meter ${pct == null ? "is-unknown" : ""}`} aria-hidden="true">
          <span style={{ width: `${pct ?? 100}%` }} />
        </div>
      )}
      {job.notice && <p className="notice">{job.notice}</p>}
    </div>
  );
}
