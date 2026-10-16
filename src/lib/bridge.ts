// What the desktop app's preload script exposes. On the web this is undefined and links are off.
export type LinkProgress =
  | { stage: "tool"; percent: number } // first run: fetching yt-dlp itself
  | { stage: "info" }
  | { stage: "download"; percent: number; speed?: string; eta?: string };

export type LinkResult = {
  path: string;
  title: string;
  url: string;
  thumbnail?: string;
  duration?: number;
  isVideo: boolean;
};

export type ScribeBridge = {
  platform: string;
  fetchLink(url: string, onProgress: (p: LinkProgress) => void): Promise<LinkResult>;
  cancelLink(): void;
  pathForFile(file: File): string;
  mediaUrl(path: string): string;
  readMedia(path: string): Promise<ArrayBuffer>;
  mediaExists(path: string): Promise<boolean>;
  openExternal(url: string): void;
};

declare global {
  interface Window {
    scribe?: ScribeBridge;
  }
}

export const bridge = (): ScribeBridge | undefined => window.scribe;

const LINK = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i;

export function looksLikeLink(s: string): boolean {
  return LINK.test(s.trim());
}

export function linkKind(s: string): "youtube" | "drive" | "other" {
  if (/(youtube\.com|youtu\.be)\//i.test(s)) return "youtube";
  if (/drive\.google\.com|docs\.google\.com/i.test(s)) return "drive";
  return "other";
}
