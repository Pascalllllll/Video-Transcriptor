import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Transcript } from "../lib/types";
import { clock } from "../lib/time";
import { Forward, Pause, Play, Rewind } from "./icons";

export type PlayerHandle = { seek(t: number, play?: boolean): void; toggle(): void; nudge(d: number): void };

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export const Player = forwardRef<PlayerHandle, { t: Transcript; src?: string; onTime(t: number): void; onPlaying(p: boolean): void }>(
  function Player({ t, src, onTime, onPlaying }, ref) {
    const media = useRef<HTMLVideoElement>(null);
    const [time, setTime] = useState(0);
    const [dur, setDur] = useState(t.duration);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [broken, setBroken] = useState(false);

    useImperativeHandle(ref, () => ({
      seek(to, play = true) {
        const m = media.current;
        if (!m) return;
        m.currentTime = Math.max(0, to);
        if (play) void m.play().catch(() => undefined);
      },
      toggle() {
        const m = media.current;
        if (!m) return;
        if (m.paused) void m.play().catch(() => undefined);
        else m.pause();
      },
      nudge(d) {
        const m = media.current;
        if (m) m.currentTime = Math.max(0, m.currentTime + d);
      },
    }));

    // Time is read every frame while playing so the highlighter keeps pace with the voice.
    useEffect(() => {
      if (!playing) return;
      let raf = 0;
      const tick = () => {
        const m = media.current;
        if (m) {
          setTime(m.currentTime);
          onTime(m.currentTime);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [playing, onTime]);

    // A .webm or .mp4 can hold only sound; trust the decoder over the file name.
    const [picture, setPicture] = useState(t.source.isVideo);
    useEffect(() => {
      setBroken(false);
      setPicture(t.source.isVideo);
    }, [src, t.source.isVideo]);

    const video = picture;
    if (!src || broken) {
      return (
        <div className="player player-missing">
          {t.source.thumbnail && <img src={t.source.thumbnail} alt="" />}
          <p>
            {t.source.kind === "file"
              ? "Drop the original file on this window to play it alongside the text."
              : "The downloaded copy is gone, so playback is off. The transcript is all here."}
          </p>
        </div>
      );
    }

    return (
      <div className={`player ${video ? "is-video" : "is-audio"}`}>
        <div className="screen">
          <video
            ref={media}
            src={src}
            poster={!video ? t.source.thumbnail : undefined}
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const m = e.currentTarget;
              if (isFinite(m.duration)) setDur(m.duration);
              setPicture(m.videoWidth > 0);
            }}
            onPlay={() => {
              setPlaying(true);
              onPlaying(true);
            }}
            onPause={() => {
              setPlaying(false);
              onPlaying(false);
            }}
            onSeeked={(e) => {
              setTime(e.currentTarget.currentTime);
              onTime(e.currentTarget.currentTime);
            }}
            onError={() => setBroken(true)}
            onClick={() => (media.current?.paused ? void media.current.play() : media.current?.pause())}
          />
          {!video && !t.source.thumbnail && <div className="audio-face" aria-hidden="true">{t.title.slice(0, 1)}</div>}
        </div>
        <div className="controls">
          <button className="round" onClick={() => (media.current?.paused ? void media.current.play() : media.current?.pause())} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause /> : <Play />}
          </button>
          <button className="icon" onClick={() => media.current && (media.current.currentTime -= 5)} aria-label="Back 5 seconds">
            <Rewind />
          </button>
          <button className="icon" onClick={() => media.current && (media.current.currentTime += 5)} aria-label="Forward 5 seconds">
            <Forward />
          </button>
          <span className="clock" aria-live="off">
            {clock(time)} <span className="dim">/ {clock(dur)}</span>
          </span>
          <label className="speed">
            <span className="sr">Playback speed</span>
            <select value={speed} onChange={(e) => {
              const v = Number(e.target.value);
              setSpeed(v);
              if (media.current) media.current.playbackRate = v;
            }}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>
          </label>
        </div>
        <input
          className="scrub"
          type="range"
          min={0}
          max={dur || 1}
          step={0.1}
          value={Math.min(time, dur || 1)}
          aria-label="Position"
          aria-valuetext={`${clock(time)} of ${clock(dur)}`}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (media.current) media.current.currentTime = v;
            setTime(v);
          }}
          style={{ "--p": `${dur ? (time / dur) * 100 : 0}%` } as React.CSSProperties}
        />
      </div>
    );
  },
);
