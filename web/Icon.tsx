// Rumi's icons: simple 16px line drawings, so they look the same on every system (unlike symbol characters).
const PATHS = {
  link: 'M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 014.5 9l1-1',
  checklist: 'M2.5 3.5h3v3h-3zM2.5 9.5h3v3h-3zM8 5h5.5M8 11h5.5',
  quote: 'M3 7.5c0-2 1-3.5 3-4M3 7.5h2.5v3H3zM9 7.5c0-2 1-3.5 3-4M9 7.5h2.5v3H9z',
  code: 'M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5',
  table: 'M2.5 3h11v10h-11zM2.5 6.5h11M2.5 10h11M6.5 3v10',
  image: 'M2.5 3h11v10h-11zM5.5 7a1 1 0 100-2 1 1 0 000 2zM13.5 10.5l-3.5-3.5-6.5 6',
  bullets: 'M6 4h7.5M6 8h7.5M6 12h7.5M2.75 4h.5M2.75 8h.5M2.75 12h.5',
  numbers: 'M6.5 4h7M6.5 8h7M6.5 12h7M2.5 3l1-.5V6M2.3 9.5c.3-.6 1.7-.6 1.7.3 0 .7-1.7 1.2-1.7 2.2H4',
  outline: 'M2.5 4h11M4.5 8h9M6.5 12h7',
  focus: 'M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 2.5v11',
  more: 'M3.5 8h.5M7.75 8h.5M12 8h.5',
  plus: 'M8 3v10M3 8h10',
  import: 'M8 10.5V2.5M5 5.5l3-3 3 3M3 10.5v3h10v-3',
  collapse: 'M10 4L6 8l4 4',
  expand: 'M6 4l4 4-4 4',
  settings: 'M8 10a2 2 0 100-4 2 2 0 000 4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  search: 'M7 12a5 5 0 100-10 5 5 0 000 10zM10.5 10.5l3 3',
  doc: 'M4 2h5.5L12 4.5V14H4zM9.5 2v2.5H12',
  folder: 'M2 4.5h4l1.5 1.5H14v7H2z',
  globe: 'M8 2a6 6 0 100 12A6 6 0 008 2zM2 8h12M8 2c1.7 1.6 2.5 3.6 2.5 6S9.7 12.4 8 14C6.3 12.4 5.5 10.4 5.5 8S6.3 3.6 8 2z',
  close: 'M4 4l8 8M12 4l-8 8',
  history: 'M2.5 8a5.5 5.5 0 101.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({name, size = 16, label}: {name: IconName; size?: number; label?: string}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      className="icon"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
