import type { SVGProps } from "react";

/** Small stroke icon set. Icons are decorative unless the caller labels the control. */
export type IconName =
  | "mask"
  | "eye"
  | "eye-off"
  | "check"
  | "close"
  | "more"
  | "users"
  | "tv"
  | "copy"
  | "share"
  | "back"
  | "crown"
  | "lock"
  | "unlock"
  | "timer"
  | "door"
  | "sound"
  | "mute"
  | "wifi-off"
  | "sparkle";

const PATHS: Record<IconName, JSX.Element> = {
  mask: (
    <>
      <path d="M3 8.5c0-1.1.9-2 2-2 2.3 0 4.4.8 7 .8s4.7-.8 7-.8c1.1 0 2 .9 2 2 0 5.3-3.2 9-6.2 9-1.7 0-2.1-1.8-2.8-1.8s-1.1 1.8-2.8 1.8C6.2 17.5 3 13.8 3 8.5Z" />
      <path d="M7.2 11.2c.8-.9 2.2-.9 3 0M13.8 11.2c.8-.9 2.2-.9 3 0" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5 10-11" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 19.5c.6-3.3 3.2-5.5 6.5-5.5s5.9 2.2 6.5 5.5" />
      <path d="M15.5 5.3a3.4 3.4 0 0 1 0 6.4M18 14.4c1.8.8 3 2.6 3.5 5.1" />
    </>
  ),
  tv: (
    <>
      <rect x="2.5" y="5" width="19" height="12.5" rx="2.5" />
      <path d="M8 21h8M12 17.5V21" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  share: (
    <>
      <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" />
      <path d="M5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6" />
    </>
  ),
  // In RTL "back" points to the right.
  back: <path d="M9 5l7 7-7 7" />,
  crown: <path d="M4 17.5 3 7.5l5 4 4-6 4 6 5-4-1 10H4Z" />,
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 7.7-1.5" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9v4l2.5 1.8M9.5 2.5h5" />
    </>
  ),
  door: (
    <>
      <path d="M14 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5H14" />
      <path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  "wifi-off": (
    <>
      <path d="M3 3l18 18" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.2-2.4M19 13a10 10 0 0 0-2.3-1.7M2 9.5a15 15 0 0 1 4-2.6M22 9.5a15 15 0 0 0-10-4c-.8 0-1.6.1-2.4.2" />
      <circle cx="12" cy="19.5" r="0.6" fill="currentColor" />
    </>
  ),
  sparkle: <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />,
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}
