// Font Awesome 6 Free (solid) glyphs, from the bundled font. The brand uses
// Font Awesome for icons and no emoji.
const GLYPHS = {
  "arrow-left": "",
  "arrow-right": "",
  "arrow-up": "",
  "arrow-down": "",
  "arrow-up-right": "",
  "book": "",
  "book-open": "",
  "circle-play": "",
  "circle-question": "",
  "headphones": "",
  "house": "",
  "lock": "",
  "music": "",
  "plus": "",
  "rotate-left": "",
  "volume-high": "",
  "xmark": "",
} as const;

export type IconName = keyof typeof GLYPHS;

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return <i className={`icon ${className}`} aria-hidden="true">{GLYPHS[name]}</i>;
}
