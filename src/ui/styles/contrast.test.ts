// @vitest-environment node
/**
 * Accessibility NFR (light and dark themes): WCAG 2.2 contrast of the theme tokens in
 * global.css and of the colours the areas' stylesheets set directly. Text needs 4.5:1
 * (1.4.3); icons, focus rings, control boundaries and the day lines need 3:1 (1.4.11).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type RGBA = [number, number, number, number];

const css = (f: string) => readFileSync(join(process.cwd(), 'src/ui', f), 'utf8');

/** Custom properties declared in the first block that starts with `selector {`. */
function tokens(source: string, selector: string): Record<string, string> {
  const start = source.indexOf(`${selector} {`);
  const body = source.slice(start, source.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function parse(c: string): RGBA {
  const h = /^#([0-9a-f]{6})$/i.exec(c);
  if (h) return [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const r = /^rgba?\(([^)]+)\)$/.exec(c);
  if (r) {
    const [a, b, d, e] = r[1].split(',').map((x) => Number(x.trim()));
    return [a, b, d, e ?? 1];
  }
  throw new Error(`unsupported colour ${c}`);
}

/** `top` composited over an opaque `under`. */
const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as RGBA;

function luminance([r, g, b]: RGBA): number {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(fg: string, bg: string): number {
  const b = parse(bg);
  const [x, y] = [luminance(over(parse(fg), b)), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const global = css('styles/global.css');
const light = tokens(global, ':root');
const themes = { light, dark: { ...light, ...tokens(global, ":root[data-theme='dark']") } };

const BACKGROUNDS = ['--bg', '--bg-elev', '--bg-sunk'];
/** Tokens used as text colours (labels, captions, links, status messages). */
const TEXT = ['--fg', '--fg-muted', '--fg-faint', '--accent', '--danger', '--warn', '--ok'];

describe('colour contrast of the themes (accessibility NFR)', () => {
  for (const [name, t] of Object.entries(themes)) {
    describe(`${name} theme`, () => {
      it('text tokens reach 4.5:1 on every background', () => {
        const fails: string[] = [];
        for (const fg of TEXT) for (const bg of BACKGROUNDS) if (contrast(t[fg], t[bg]) < 4.5) fails.push(`${fg} on ${bg}: ${contrast(t[fg], t[bg]).toFixed(2)}`);
        expect(fails).toEqual([]);
      });

      it('primary buttons, toasts and the reader view reach 4.5:1', () => {
        expect(contrast(t['--accent-fg'], t['--accent'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t['--bg'], t['--fg'])).toBeGreaterThanOrEqual(4.5);
        const lib = name === 'light' ? tokens(css('library/library.css'), ':root') : tokens(css('library/library.css'), ":root[data-theme='dark']");
        expect(contrast(lib['--lib-reader-fg'], lib['--lib-reader-bg'])).toBeGreaterThanOrEqual(7);
      });

      it('focus rings, pressed icons, control boundaries and day lines reach 3:1', () => {
        for (const bg of BACKGROUNDS) {
          expect(contrast(t['--accent'], t[bg]), `focus ring on ${bg}`).toBeGreaterThanOrEqual(3);
          expect(contrast(t['--control-border'], t[bg]), `input border on ${bg}`).toBeGreaterThanOrEqual(3);
        }
        const pressed = over(parse(t['--selection']), parse(t['--bg-elev']));
        expect(contrast(t['--accent'], `rgba(${pressed.slice(0, 3).join(', ')}, 1)`)).toBeGreaterThanOrEqual(3);
        expect(contrast(t['--dayline'], t['--bg'])).toBeGreaterThanOrEqual(3);
      });
    });
  }

  it('colours set directly in the areas’ stylesheets are readable where they are drawn', () => {
    // every literal text colour, and what it is drawn on
    const KNOWN: Record<string, { on: string; min: number }> = {
      '#c93a32': { on: light['--bg-sunk'], min: 3 }, // PDF cover icon
      '#2f8a4e': { on: light['--bg-sunk'], min: 3 }, // EPUB cover icon
      'rgba(0, 0, 0, 0.62)': { on: '#ffffff', min: 4.5 }, // page number on the white PDF page
      '#3a3000': { on: '#f5d742', min: 4.5 }, // margin note marker
      'rgba(0, 0, 0, 0.55)': { on: '#f5d742', min: 3 }, // icon on the yellow highlight swatch
    };
    const found: string[] = [];
    for (const f of ['canvas/canvas.css', 'library/library.css', 'gym/gym.css', 'sync/sync.css', 'styles/global.css']) {
      for (const m of css(f).matchAll(/(?:^|[;{\s])color:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\)|white|black)/gim)) found.push(m[1].toLowerCase());
    }
    expect(found.filter((c) => !(c in KNOWN))).toEqual([]);
    for (const [c, { on, min }] of Object.entries(KNOWN)) expect(contrast(c, on), c).toBeGreaterThanOrEqual(min);
  });
});
