/**
 * Guards the `--space-*` scale (#407).
 *
 * The sweep that introduced the scale was lossless: every spacing value that
 * matched a step became a token, and the off-scale one-offs were left alone
 * rather than snapped (which would have moved pixels). This test keeps that
 * state from rotting — a new `padding: 8px` re-opens the drift the scale was
 * added to close.
 *
 * It deliberately does NOT ban the off-scale literals. Those are documented
 * in app.css as a known tail; forbidding them would push authors toward the
 * wrong fix (silently resizing something) instead of the right one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** px → token suffix. Mirrors the scale declared in `src/app.css`. */
const SCALE = new Map([
  [2, '3xs'],
  [4, '2xs'],
  [6, 'xs'],
  [8, 'sm'],
  [10, 'md'],
  [12, 'lg'],
  [16, 'xl'],
  [20, '2xl'],
  [24, '3xl'],
  [32, '4xl'],
]);

const SPACING_PROPS = [
  'padding-inline',
  'padding-block',
  'padding-bottom',
  'padding-right',
  'padding-left',
  'padding-top',
  'margin-inline',
  'margin-block',
  'margin-bottom',
  'margin-right',
  'margin-left',
  'margin-top',
  'column-gap',
  'padding',
  'margin',
  'row-gap',
  'gap',
];

// Not preceded by `-`/word char, so `--trio-gap:` and the `gap` inside
// `row-gap` don't match as the bare `gap` property.
const DECL = new RegExp(String.raw`(?<![-\w])(${SPACING_PROPS.join('|')})\s*:\s*([^;{}]*);`, 'g');
// A px literal that isn't negative and isn't the tail of a longer number.
const PX = /(?<![-\d.])(\d+)px/g;
const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((p) => /\.(svelte|css)$/.test(p) && !p.includes('generated'))
    .map((p) => join(dir, p));
}

/** CSS text of a file — the `<style>` blocks only, for components. */
function styleText(path: string): string {
  const src = readFileSync(path, 'utf-8');
  if (!path.endsWith('.svelte')) return src;
  return [...src.matchAll(STYLE_BLOCK)].map((m) => m[1]).join('\n');
}

/** Human-readable location + fix for every on-scale literal still present. */
function findOffences(): string[] {
  const offences: string[] = [];
  for (const file of sourceFiles('src')) {
    for (const [, prop, value] of styleText(file).matchAll(DECL)) {
      // calc() is exempt: the sweep skipped it, since substituting inside an
      // expression costs more readability than the token buys.
      if (value.includes('calc(')) continue;
      for (const [, raw] of value.matchAll(PX)) {
        const token = SCALE.get(Number(raw));
        if (token) {
          offences.push(`  ${file}\n    ${prop}: ${value.trim()}   → ${raw}px should be var(--space-${token})`);
        }
      }
    }
  }
  return offences;
}

describe('spacing scale', () => {
  it('declares every step the sweep maps to', () => {
    const appCss = readFileSync('src/app.css', 'utf-8');
    for (const [px, token] of SCALE) {
      expect(appCss).toContain(`--space-${token}: ${px}px;`);
    }
  });

  it('uses tokens for every on-scale spacing value', () => {
    const offences = findOffences();
    expect(offences.length, `on-scale px literals found:\n${offences.join('\n')}`).toBe(0);
  });

  it('still finds the declarations it is meant to police', () => {
    // Self-check: if the regex silently stopped matching, the test above would
    // pass vacuously. The floor only has to be well clear of zero — the real
    // count is ~390, so 100 proves broad matching without failing the day
    // someone deletes a few components.
    const total = sourceFiles('src').reduce((n, f) => n + [...styleText(f).matchAll(DECL)].length, 0);
    expect(total).toBeGreaterThan(100);
  });
});
