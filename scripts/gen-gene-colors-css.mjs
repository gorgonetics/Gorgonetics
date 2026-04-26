#!/usr/bin/env node
/**
 * Build-time generator that turns `src/lib/theme/gene-colors-data.json`
 * into `src/lib/theme/gene-colors.generated.css`. Wired as the first step
 * of `pnpm dev` and `pnpm build` (chained with `&&`) so the CSS file is
 * always in sync with the JSON. Also exposed as `pnpm gen:gene-colors-css`
 * for manual runs.
 *
 * The generated file is committed (so cold checkouts can build without
 * running this first) but is treated as derived — edit `gene-colors-data.json`
 * to change a colour, never the .generated.css.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const inputPath = resolve(repoRoot, 'src/lib/theme/gene-colors-data.json');
const outputPath = resolve(repoRoot, 'src/lib/theme/gene-colors.generated.css');

const data = JSON.parse(readFileSync(inputPath, 'utf-8'));

function emitSection(title, vars) {
  const lines = [`  /* ${title} */`];
  for (const [k, v] of Object.entries(vars)) {
    lines.push(`  --gene-${k}: ${v};`);
  }
  return lines.join('\n');
}

const css = `/*
 * AUTO-GENERATED — do not edit.
 * Source: src/lib/theme/gene-colors-data.json
 * Regenerate: pnpm gen:gene-colors-css (also runs from pnpm dev / pnpm build)
 */
:root {
${emitSection('Effect colors', data.effects)}

${emitSection('BeeWasp appearance colors', data.beewaspAppearance)}

${emitSection('Horse appearance colors', data.horseAppearance)}
}
`;

const previous = (() => {
  try {
    return readFileSync(outputPath, 'utf-8');
  } catch {
    return null;
  }
})();

if (previous !== css) {
  writeFileSync(outputPath, css);
  console.log(`gen-gene-colors-css: wrote ${outputPath}`);
} else {
  console.log('gen-gene-colors-css: up-to-date');
}
