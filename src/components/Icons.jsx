// Icon set — simple line icons. Inline SVG, 20×20 viewBox standard.
// Each icon is a named export accepting props spread for size/class overrides.

export const Forum = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="6" cy="7" r="2.2" />
    <circle cx="14" cy="7" r="2.2" />
    <circle cx="10" cy="13" r="2.2" />
    <path d="M6 9.5v.5a3 3 0 0 0 3 3" />
    <path d="M14 9.5v.5a3 3 0 0 1-3 3" />
  </svg>
);

export const Plug = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M7 3v3" /><path d="M13 3v3" />
    <rect x="5" y="6" width="10" height="5" rx="1.5" />
    <path d="M10 11v3a3 3 0 0 0 3 3" />
  </svg>
);

export const Stage = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="3" y="4" width="14" height="10" rx="1.5" />
    <path d="M3 14l3 3M17 14l-3 3" />
    <circle cx="7.5" cy="8" r="1" /><circle cx="12.5" cy="8" r="1" />
    <path d="M7 11h6" />
  </svg>
);

export const Actors = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="7" cy="7" r="2.5" />
    <circle cx="14" cy="6" r="2" />
    <path d="M2.5 16c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" />
    <path d="M12 13c.6-.6 1.5-1 2.5-1 1.7 0 3 1.3 3 3" />
  </svg>
);

export const Brain = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    {/* Left Hemisphere Outline */}
    <path d="M10 4a2.5 2.5 0 0 0-5 0.1 3.3 3.3 0 0 0-2.1 4.8 3.3 3.3 0 0 0 0.5 5.5A3.3 3.3 0 1 0 10 15" />
    {/* Right Hemisphere Outline */}
    <path d="M10 4a2.5 2.5 0 0 1 5 0.1 3.3 3.3 0 0 1 2.1 4.8 3.3 3.3 0 0 1-0.5 5.5A3.3 3.3 0 1 1 10 15" />
    {/* Central Fissure */}
    <path d="M10 4v11" />
    {/* Inner Folds */}
    <path d="M10 7h3a1.5 1.5 0 0 1 1.5 1.5v0.8" />
    <path d="M10 10H7a1.5 1.5 0 0 0-1.5 1.5v0.8" />
  </svg>
);

export const Gauge = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 14a7 7 0 1 1 14 0" />
    <path d="M10 14l3-5" />
    <circle cx="10" cy="14" r="1" fill="currentColor" />
  </svg>
);

export const Doc = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M5 3h7l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M12 3v4h4" />
    <path d="M7 11h6M7 14h6M7 8h2" />
  </svg>
);

export const Sessions = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="3" y="4" width="14" height="12" rx="1.5" />
    <path d="M3 8h14" />
    <path d="M7 12h6" />
  </svg>
);

export const Target = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="10" cy="10" r="7" />
    <circle cx="10" cy="10" r="3.5" />
    <circle cx="10" cy="10" r="1" fill="currentColor" />
  </svg>
);

export const Settings = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="10" cy="10" r="2.5" />
    <path d="M10 3v2M10 15v2M3 10h2M15 10h2M5 5l1.5 1.5M13.5 13.5L15 15M5 15l1.5-1.5M13.5 6.5L15 5" />
  </svg>
);

export const Search = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="9" cy="9" r="5" />
    <path d="M13 13l3 3" />
  </svg>
);

export const Play = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="currentColor" {...props}>
    <path d="M6 4l10 6-10 6V4z" />
  </svg>
);

export const Step = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M6 5l5 5-5 5" />
    <path d="M13 5v10" />
  </svg>
);

export const Round = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M16 6a7 7 0 1 0 0 8" />
    <path d="M16 3v3h-3" />
  </svg>
);

export const Stop = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="currentColor" {...props}>
    <rect x="5" y="5" width="10" height="10" rx="1.5" />
  </svg>
);

export const Pause = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="currentColor" {...props}>
    <rect x="5" y="4" width="3.5" height="12" rx="1" />
    <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
  </svg>
);

export const Send = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 10l14-7-5 17-3-7-6-3z" />
  </svg>
);

export const Plus = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" {...props}>
    <path d="M10 4v12M4 10h12" />
  </svg>
);

export const Chevron = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M7 6l4 4-4 4" />
  </svg>
);

export const Sun = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="10" cy="10" r="3.5" />
    <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.5 1.5M14 14l1.5 1.5M4.5 15.5L6 14M14 6l1.5-1.5" />
  </svg>
);

export const Moon = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M16 11a6 6 0 1 1-7-7 5 5 0 0 0 7 7z" />
  </svg>
);

export const Anchor = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="10" cy="5" r="1.5" />
    <path d="M10 6.5V16M5 13a5 5 0 0 0 10 0" />
    <path d="M7 9h6" />
  </svg>
);

export const Thumb = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 10h3v6H3zM6 10l3-6c1 0 2 .5 2 2v2h4a1.5 1.5 0 0 1 1.5 2L15 16a2 2 0 0 1-2 1H6" />
  </svg>
);

export const Globe = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="10" cy="10" r="7" />
    <path d="M3 10h14M10 3a10 10 0 0 1 0 14M10 3a10 10 0 0 0 0 14" />
  </svg>
);

export const Bolt = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="currentColor" {...props}>
    <path d="M11 2L4 11h4l-1 7 7-9h-4l1-7z" />
  </svg>
);

export const Eye = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" />
    <circle cx="10" cy="10" r="2" />
  </svg>
);

export const Info = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 9v4M10 7v.5" />
  </svg>
);

export const Sliders = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M5 4v3M5 9v7M10 4v9M10 15v1M15 4v6M15 12v4" />
    <circle cx="5" cy="8" r="1.4" /><circle cx="10" cy="14" r="1.4" /><circle cx="15" cy="11" r="1.4" />
  </svg>
);

export const Trash = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" />
  </svg>
);

export const Download = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M10 3v10M5 9l5 5 5-5M3 17h14" />
  </svg>
);

export const Upload = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M10 14V4M5 8l5-5 5 5M3 17h14" />
  </svg>
);

export const Cmd = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M13 7v9a3 3 0 1 0 3-3H4a3 3 0 1 0 3 3V4a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3z" />
  </svg>
);

export const Robot = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="4" y="6" width="12" height="9" rx="2" />
    <circle cx="8" cy="10.5" r="1" fill="currentColor" />
    <circle cx="12" cy="10.5" r="1" fill="currentColor" />
    <path d="M7 13h6" />
    <path d="M10 6V3" />
    <circle cx="10" cy="2.5" r="1" fill="currentColor" />
    <path d="M2 10.5h2M16 10.5h2" />
  </svg>
);

export const Wrench = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M14 3a3 3 0 0 0-3 4l-7 7 2 2 7-7a3 3 0 0 0 4-3l-2 2-2-2 1-3z" />
  </svg>
);

export const Expand = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 7V4a1 1 0 0 1 1-1h3M13 3h3a1 1 0 0 1 1 1v3M17 13v3a1 1 0 0 1-1 1h-3M7 17H4a1 1 0 0 1-1-1v-3" />
  </svg>
);

export const Close = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
);

export const Clock = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6v4l3 2" />
  </svg>
);

export const MessageSquare = (props) => (
  <svg viewBox="0 0 20 20" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 4h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-4l-3 3-3-3H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
  </svg>
);
