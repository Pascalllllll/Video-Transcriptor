// A handful of glyphs drawn for Scribe at 20px: square caps and a 1.6 stroke, to sit with the
// ruled-paper lines rather than a rounded icon-library look.
type P = { size?: number };
const svg = (d: React.ReactNode, size = 20) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden="true">
    {d}
  </svg>
);

export const Play = ({ size }: P) => svg(<path d="M6 4.5v11l9-5.5z" fill="currentColor" stroke="none" />, size);
export const Pause = ({ size }: P) => svg(<path d="M6.5 4.5v11M13.5 4.5v11" strokeWidth="2.4" />, size);
export const Back = ({ size }: P) => svg(<path d="M12 4.5 6.5 10l5.5 5.5" />, size);
export const Rewind = ({ size }: P) => svg(<><path d="M4 10a6 6 0 1 0 1.8-4.3" /><path d="M4 3.5v3h3" /></>, size);
export const Forward = ({ size }: P) => svg(<><path d="M16 10a6 6 0 1 1-1.8-4.3" /><path d="M16 3.5v3h-3" /></>, size);
export const Find = ({ size }: P) => svg(<><circle cx="8.5" cy="8.5" r="4.5" /><path d="m12 12 4.5 4.5" /></>, size);
export const Copy = ({ size }: P) => svg(<><path d="M7 7h9v9H7z" /><path d="M4 13V4h9" /></>, size);
export const Save = ({ size }: P) => svg(<><path d="M10 3.5v9M6 9l4 4 4-4" /><path d="M4 16.5h12" /></>, size);
export const Pen = ({ size }: P) => svg(<path d="m4 16 1-4 8-8 3 3-8 8zM11.5 5.5l3 3" />, size);
export const Close = ({ size }: P) => svg(<path d="m5 5 10 10M15 5 5 15" />, size);
export const Sun = ({ size }: P) => svg(<><circle cx="10" cy="10" r="3.2" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></>, size);
export const Moon = ({ size }: P) => svg(<path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z" />, size);
export const Trash = ({ size }: P) => svg(<><path d="M4.5 6h11M8 6V4h4v2M6 6l.8 10h6.4L14 6" /></>, size);
export const Follow = ({ size }: P) => svg(<><path d="M4 5h12M4 10h8M4 15h12" /><path d="m14 8 3 2-3 2z" fill="currentColor" stroke="none" /></>, size);
export const Clock = ({ size }: P) => svg(<><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.5" /></>, size);
