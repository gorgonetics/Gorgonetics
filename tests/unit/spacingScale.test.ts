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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Repo root by walking up for `package.json`, so the guard survives vitest
 * being rerooted or invoked from a subdirectory.
 *
 * Deliberately fs rather than `import.meta.glob('…', { query: '?raw' })`:
 * Vite's CSS plugin intercepts `.css` and hands back an empty string, which
 * would silently drop `app.css` and `geneCell.css` from the scan — the exact
 * false-green this file exists to prevent.
 */
function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'package.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('spacingScale.test: could not locate repo root');
    dir = up;
  }
  return dir;
}

const SRC = join(repoRoot(), 'src');

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

/** `[displayPath, css]` per stylesheet — `<style>` blocks only, for components. */
function stylesheets(): [string, string][] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf-8' })
    .filter((p) => /\.(svelte|css)$/.test(p) && !p.includes('generated'))
    .map((p) => {
      const full = join(SRC, p);
      const src = readFileSync(full, 'utf-8');
      const css = p.endsWith('.svelte') ? [...src.matchAll(STYLE_BLOCK)].map((m) => m[1]).join('\n') : src;
      // Forward slashes regardless of platform, so both the offence report and
      // the `src/app.css` lookup below read the same on Windows.
      return [relative(repoRoot(), full).split(sep).join('/'), css];
    });
}

/** Human-readable location + fix for every on-scale literal in one stylesheet. */
function scanCss(css: string, label: string): string[] {
  const offences: string[] = [];
  for (const [, prop, value] of css.matchAll(DECL)) {
    // calc() is exempt: the sweep skipped it, since substituting inside an
    // expression costs more readability than the token buys.
    if (value.includes('calc(')) continue;
    for (const [, raw] of value.matchAll(PX)) {
      const token = SCALE.get(Number(raw));
      if (token) {
        offences.push(`  ${label}\n    ${prop}: ${value.trim()}   → ${raw}px should be var(--space-${token})`);
      }
    }
  }
  return offences;
}

function findOffences(): string[] {
  return stylesheets().flatMap(([path, css]) => scanCss(css, path));
}

describe('spacing scale', () => {
  it('declares every step the sweep maps to', () => {
    // Found by scanning the same list the guard polices, rather than read
    // separately — so if the scan ever stops reaching app.css, this fails
    // loudly instead of every `toContain` below asserting against undefined.
    const appCss = stylesheets().find(([path]) => path === 'src/app.css')?.[1];
    expect(appCss, 'src/app.css missing from the scanned stylesheets').toBeTruthy();
    for (const [px, token] of SCALE) {
      expect(appCss).toContain(`--space-${token}: ${px}px;`);
    }
  });

  it('uses tokens for every on-scale spacing value', () => {
    const offences = findOffences();
    expect(offences.length, `on-scale px literals found:\n${offences.join('\n')}`).toBe(0);
  });

  // Positive control. Without it, rot in EITHER regex makes `findOffences()`
  // return [] and the assertion above pass vacuously forever — `DECL` matching
  // is not enough, since `PX` is the half that actually flags a value. These
  // cases also pin the exemptions the sweep relied on.
  it('flags an on-scale literal and spares the documented exemptions', () => {
    expect(scanCss('.x { padding: 8px; }', 'synthetic')).toHaveLength(1);
    expect(scanCss('.x { gap: 4px 12px; }', 'synthetic')).toHaveLength(2);

    expect(scanCss('.x { padding: 14px; }', 'synthetic'), 'off-scale tail').toEqual([]);
    expect(scanCss('.x { margin: -8px; }', 'synthetic'), 'negatives').toEqual([]);
    expect(scanCss('.x { padding: calc(8px + 1px); }', 'synthetic'), 'calc()').toEqual([]);
    expect(scanCss('.x { border-radius: 8px; }', 'synthetic'), 'non-spacing property').toEqual([]);
    expect(scanCss(':root { --trio-gap: 8px; }', 'synthetic'), 'custom property').toEqual([]);
  });

  it('still reaches the real stylesheets', () => {
    // Complements the positive control: that one proves the matcher works,
    // this proves it is being pointed at actual content. The floor only has to
    // be clear of zero — the real count is ~390.
    const total = stylesheets().reduce((n, [, css]) => n + [...css.matchAll(DECL)].length, 0);
    expect(total).toBeGreaterThan(100);
  });
});
