#!/usr/bin/env node
/**
 * Build-time sync that mirrors the canonical `assets/` and `data/` trees at
 * the repo root into the locations consumed by Tauri (`src-tauri/resources/`)
 * and the SvelteKit dev/test browser (`src/static/`).
 *
 * The mirror directories are gitignored — `assets/` and `data/` are the
 * single source of truth. Wired as a step of `pnpm dev` and `pnpm build`
 * (chained after `gen:gene-colors-css`) so the bundled copies are always in
 * sync. Also exposed as `pnpm sync:bundled-assets` for manual runs.
 *
 * Idempotent: only writes files whose content has changed and prunes files
 * that no longer exist in the source.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, rmdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const TARGETS = [
  { source: 'assets', extensions: ['.json'], mirrors: ['src-tauri/resources/assets', 'src/static/assets'] },
  { source: 'data', extensions: ['.txt'], mirrors: ['src-tauri/resources/data', 'src/static/data'] },
];

function listSourceFiles(dir, extensions) {
  const out = [];
  function walk(absDir) {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(relative(dir, abs));
      }
    }
  }
  walk(dir);
  return out.sort();
}

function listMirrorFiles(dir, extensions) {
  const out = [];
  function walk(absDir) {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(relative(dir, abs));
      }
    }
  }
  walk(dir);
  return out;
}

function syncDir(sourceAbs, mirrorAbs, extensions) {
  const sourceFiles = listSourceFiles(sourceAbs, extensions);
  const sourceSet = new Set(sourceFiles);
  let written = 0;
  let pruned = 0;

  for (const rel of sourceFiles) {
    const srcPath = join(sourceAbs, rel);
    const dstPath = join(mirrorAbs, rel);
    const srcBuf = readFileSync(srcPath);
    let same = false;
    try {
      const dstBuf = readFileSync(dstPath);
      same = dstBuf.equals(srcBuf);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (!same) {
      mkdirSync(dirname(dstPath), { recursive: true });
      writeFileSync(dstPath, srcBuf);
      written++;
    }
  }

  for (const rel of listMirrorFiles(mirrorAbs, extensions)) {
    if (!sourceSet.has(rel)) {
      unlinkSync(join(mirrorAbs, rel));
      pruned++;
    }
  }

  pruneEmptyDirs(mirrorAbs);

  return { written, pruned, total: sourceFiles.length };
}

function pruneEmptyDirs(rootAbs) {
  let entries;
  try {
    entries = readdirSync(rootAbs, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = join(rootAbs, entry.name);
    pruneEmptyDirs(abs);
    try {
      rmdirSync(abs);
    } catch (err) {
      if (err.code !== 'ENOTEMPTY' && err.code !== 'EEXIST') throw err;
    }
  }
}

let totalWritten = 0;
let totalPruned = 0;

for (const target of TARGETS) {
  const sourceAbs = resolve(repoRoot, target.source);
  if (!statSafe(sourceAbs)?.isDirectory()) {
    throw new Error(`sync-bundled-assets: source directory missing: ${target.source}`);
  }
  for (const mirror of target.mirrors) {
    const mirrorAbs = resolve(repoRoot, mirror);
    const { written, pruned, total } = syncDir(sourceAbs, mirrorAbs, target.extensions);
    totalWritten += written;
    totalPruned += pruned;
    if (written > 0 || pruned > 0) {
      console.log(`sync-bundled-assets: ${mirror} — ${written} written, ${pruned} pruned (${total} total)`);
    }
  }
}

if (totalWritten === 0 && totalPruned === 0) {
  console.log('sync-bundled-assets: up-to-date');
}

function statSafe(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}
