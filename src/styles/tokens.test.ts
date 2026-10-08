// DESIGN.md 0.2 and 2: every color, font and font size lives in tokens.css,
// and the token pairs the app actually uses meet WCAG AA in both themes.
import { describe, expect, it } from 'vitest';
import TOKENS from './tokens.css?raw';

// every UI source file (screens, shared components, the app shell, styles), as text
const SOURCES = import.meta.glob<string>(
  ['../features/**/*.{ts,tsx}', '../ui/**/*.{ts,tsx}', '../app/**/*.{ts,tsx}', './*.css'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

describe('no raw styling outside tokens.css', () => {
  const RULES: [string, RegExp][] = [
    ['hex color', /(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/],
    ['rgb/hsl color', /\b(?:rgba?|hsla?)\(/],
    ['font name', /Lexend|Plex|Atkinson|Bricolage|system-ui|ui-monospace|sans-serif|\bmonospace\b/],
    ['pixel font size', /font-size:\s*\d|fontSize:\s*['"]?\d/],
  ];
  const files = Object.entries(SOURCES).filter(
    ([f]) => !f.endsWith('tokens.css') && !/\.test\.tsx?$/.test(f),
  );
  it('finds the UI files', () => expect(files.length).toBeGreaterThan(40));
  for (const [f, text] of files) {
    it(f, () => {
      const bad: string[] = [];
      text.split('\n').forEach((line, i) => {
        for (const [what, re] of RULES) if (re.test(line)) bad.push(`${i + 1}: ${what}: ${line.trim()}`);
      });
      expect(bad).toEqual([]);
    });
  }
});

// ---------- contrast ----------
function block(selector: string): Record<string, string> {
  const start = TOKENS.indexOf(selector);
  const body = TOKENS.slice(TOKENS.indexOf('{', start) + 1, TOKENS.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]),
  );
}
const light = block(':root {');
const dark = { ...light, ...block(":root[data-theme='dark'] {") };

function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// [text, background, minimum]: 4.5 for text, 3 for large text and UI boundaries
const PAIRS: [string, string, number][] = [
  ['--ink', '--bg', 4.5],
  ['--ink', '--surface', 4.5],
  ['--ink', '--surface-2', 4.5],
  ['--ink-muted', '--bg', 4.5],
  ['--ink-muted', '--surface', 4.5],
  ['--ink-muted', '--surface-2', 4.5],
  ['--on-primary', '--primary', 4.5],
  ['--on-highlight', '--highlight', 4.5],
  ['--on-danger', '--danger', 4.5],
  ['--danger-text', '--surface', 4.5],
  ['--danger-text', '--bg', 4.5],
  ['--danger-text', '--danger-soft', 4.5],
  ['--danger', '--surface', 3], // borders and fills
  ['--ink', '--danger-soft', 4.5],
  ['--tab-active-fg', '--tab-active-bg', 4.5],
  ['--tab-active-fg', '--nav-bg', 4.5],
  ['--ink-muted', '--nav-bg', 4.5],
  ['--surface', '--ink', 4.5], // toast text
  ['--toast-action', '--ink', 4.5],
  ['--fab-fg', '--fab-bg', 3],
  ['--focus', '--bg', 3],
  ['--primary', '--surface', 3], // stepper and button outlines
];

describe.each([
  ['light', light],
  ['dark', dark],
])('contrast, %s theme', (_name, t) => {
  it.each(PAIRS)('%s on %s ≥ %d', (fg, bg, min) => {
    expect(t[fg], fg).toBeDefined();
    expect(t[bg], bg).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
  });
});
