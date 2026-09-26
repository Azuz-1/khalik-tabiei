/**
 * خلك طبيعي mark: a pair of eyes peeking out of the dark — the whole game is
 * people watching each other. Decorative only.
 */
export function EyesMark({ size = 96, glance = true, className = "" }: { size?: number; glance?: boolean; className?: string }) {
  return (
    <svg
      className={`eyes-mark${glance ? " is-glancing" : ""}${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="eyes-hood" cx="50%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#9b6bff" />
          <stop offset="55%" stopColor="#5b21b6" />
          <stop offset="100%" stopColor="#1e0b44" />
        </radialGradient>
        <radialGradient id="eyes-face" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#130a26" />
          <stop offset="100%" stopColor="#05030b" />
        </radialGradient>
      </defs>
      <path d="M60 8c26 0 46 21 46 50v42c0 7-5 12-12 12H26c-7 0-12-5-12-12V58C14 29 34 8 60 8Z" fill="url(#eyes-hood)" />
      <ellipse cx="60" cy="66" rx="36" ry="32" fill="url(#eyes-face)" />
      <g className="eyes-mark-eyes">
        <ellipse cx="45" cy="64" rx="11" ry="13" fill="#f6f0ff" />
        <ellipse cx="75" cy="64" rx="11" ry="13" fill="#f6f0ff" />
        <g className="eyes-mark-pupils">
          <circle cx="41" cy="66" r="5.5" fill="#1a0b33" />
          <circle cx="71" cy="66" r="5.5" fill="#1a0b33" />
          <circle cx="39.4" cy="64" r="1.6" fill="#fff" />
          <circle cx="69.4" cy="64" r="1.6" fill="#fff" />
        </g>
      </g>
    </svg>
  );
}
