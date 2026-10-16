import { SR } from "./chunks";

/** Decodes any audio or video the browser can play into 16 kHz mono, which is what Whisper reads. */
export async function decodeToPcm(data: ArrayBuffer): Promise<{ pcm: Float32Array; duration: number }> {
  const ctx = new AudioContext({ sampleRate: SR });
  try {
    const buf = await ctx.decodeAudioData(data);
    const n = buf.numberOfChannels;
    const pcm = new Float32Array(buf.length);
    for (let c = 0; c < n; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) pcm[i] += ch[i] / n;
    }
    return { pcm, duration: buf.duration };
  } catch {
    throw new Error("This file has no audio track Scribe can read. MP4, WebM, MOV, MP3, M4A, WAV, OGG and FLAC work; MKV and AVI may not.");
  } finally {
    void ctx.close();
  }
}

export const isVideoName = (name: string) => /\.(mp4|webm|mov|m4v|mkv|ogv|avi)$/i.test(name);
export const MEDIA_ACCEPT = "audio/*,video/*,.mkv,.m4a,.opus,.flac";
