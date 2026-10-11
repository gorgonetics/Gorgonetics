#!/usr/bin/env node
/**
 * Write src/lib/data/gene-template-history.json: for every template gene,
 * each dominant and recessive effect value shipped in a release up to and
 * including `--upto` (default v0.10.3).
 *
 * Every gene-data tree in a tag is read, not only `assets/`: up to v0.6.3
 * the desktop app bundled a separately committed `src-tauri/resources/assets`
 * that differs from `assets/` at those tags. Values from any tree count as
 * shipped.
 *
 * Releases before schema v21 did not record which template value a gene row
 * came from. On the first template refresh after the upgrade, a row whose
 * effect equals any value a release shipped is treated as untouched and gets
 * the new template value; any other value is the user's edit and is kept
 * (see refreshGeneTemplatesIfChanged in demoService.ts). From v21 on each
 * row stores its template value, so this file is frozen: regenerate it only
 * if `--upto` was wrong.
 *
 * Usage: node scripts/gen-gene-template-history.mjs [--upto v0.10.3]
 * Needs the release tags locally (`git fetch --tags`).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const git = (/** @type {string[]} */ ...args) => execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 1e9 });
// Mirrors normaliseEffect in src/lib/utils/geneAnalysis.ts.
const norm = (/** @type {string | null | undefined} */ v) => (v == null || v === '' ? 'None' : v);
const TREES = ['assets', 'src-tauri/resources/assets', 'src/static/assets', 'static/assets'];

const uptoIndex = process.argv.indexOf('--upto');
const upto = uptoIndex >= 0 ? process.argv[uptoIndex + 1] : 'v0.10.3';

const tags = git('tag', '--sort=creatordate').trim().split('\n');
const last = tags.indexOf(upto);
if (last < 0) throw new Error(`tag ${upto} not found; run git fetch --tags`);

/** @type {Record<string, [string[], string[]]>} */
const history = {};
for (const tag of tags.slice(0, last + 1)) {
  const paths = git('ls-tree', '-r', '--name-only', tag, '--', ...TREES)
    .trim()
    .split('\n')
    .filter((p) => /(^|\/)assets\/(horse|beewasp)\/[^/]+\.json$/.test(p));
  for (const path of paths) {
    const species = /** @type {string} */ (path.match(/assets\/([a-z]+)\//)?.[1]);
    for (const g of JSON.parse(git('show', `${tag}:${path}`))) {
      const entry = (history[`${species}/${g.gene}`] ??= [[], []]);
      const dom = norm(g.effectDominant);
      const rec = norm(g.effectRecessive);
      if (!entry[0].includes(dom)) entry[0].push(dom);
      if (!entry[1].includes(rec)) entry[1].push(rec);
    }
  }
}

const sorted = Object.fromEntries(Object.entries(history).sort(([a], [b]) => a.localeCompare(b)));
const out = resolve(fileURLToPath(new URL('../src/lib/data/gene-template-history.json', import.meta.url)));
writeFileSync(out, `${JSON.stringify(sorted)}\n`);
console.log(`Wrote ${Object.keys(sorted).length} genes from ${last + 1} releases (up to ${upto}) to ${out}`);
