/**
 * The mark: a chest drawn flat — a domed lid, a body, one gold band and the
 * lock plate. The same object as the hero, at icon size. Used in the
 * wordmark, the favicon, the chest cards and as the WebGL fallback. With
 * `open`, the lid tilts back and the seam glows violet.
 */
export function ChestMark({ className = "", open = false, tint = "#e3b95a" }: { className?: string; open?: boolean; tint?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" fill="none">
      <defs>
        <linearGradient id="lp-gold" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#f7d98a" />
          <stop offset="0.5" stopColor={tint} />
          <stop offset="1" stopColor="#9c7420" />
        </linearGradient>
        <linearGradient id="lp-body" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#2a1d4a" />
          <stop offset="1" stopColor="#140d26" />
        </linearGradient>
      </defs>
      {open ? <rect x="12" y="26" width="40" height="6" rx="3" fill="#9b6dff" opacity="0.9" /> : null}
      <rect x="9" y="30" width="46" height="25" rx="5" fill="url(#lp-body)" stroke="url(#lp-gold)" strokeWidth="2" />
      <g transform={open ? "rotate(-32 32 30)" : undefined} style={{ transformOrigin: "32px 30px" }}>
        <path d="M9 30v-5a23 11 0 0 1 46 0v5z" fill="url(#lp-body)" stroke="url(#lp-gold)" strokeWidth="2" strokeLinejoin="round" />
        <rect x="29" y="15" width="6" height="15" rx="1.5" fill="url(#lp-gold)" />
      </g>
      <rect x="29" y="30" width="6" height="25" rx="1.5" fill="url(#lp-gold)" />
      <rect x="25" y="34" width="14" height="11" rx="2.5" fill="url(#lp-gold)" />
      <circle cx="32" cy="38.5" r="1.9" fill="#140d26" />
      <rect x="31.1" y="39.5" width="1.8" height="3.4" rx="0.7" fill="#140d26" />
    </svg>
  );
}
