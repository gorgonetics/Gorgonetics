#!/usr/bin/env node
/**
 * Asserts that every Tauri crate is on the same major/minor release as its
 * npm counterpart, by parsing `pnpm tauri info`.
 *
 * `tauri build` refuses to run when a pair diverges:
 *
 *   Found version mismatched Tauri packages. Make sure the NPM package and
 *   Rust crate versions are on the same major/minor releases:
 *
 * Nothing in CI runs `tauri build` (only the release workflow does), so that
 * error can only surface at tag time. v0.9.1 failed to build on all three
 * platforms for exactly this reason: `src-tauri/Cargo.toml` pins the plugins
 * as "2", so dependabot bumping a crate moves only the Rust half of the pair
 * (there, tauri-plugin-updater 2.11.0 against @tauri-apps/plugin-updater
 * 2.10.1). This script is the cheap pre-flight version of that check.
 *
 * Only major/minor is compared, because that is all `tauri build` enforces —
 * patch drift between a crate and its npm package is normal and builds fine.
 *
 * Wired into the rust-check CI job and into scripts/release.sh. Run it by
 * hand with `pnpm check:tauri-versions`.
 */
import { execFileSync } from 'node:child_process';

/** Colour codes, in case the CLI decides it is talking to a terminal. */
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/** `tauri info` sections that list versioned packages, keyed by header text. */
const VERSIONED_SECTIONS = new Set(['Packages', 'Plugins']);

/** e.g. "[-] Plugins" or "[x] Environment" — the section headers. */
const SECTION_PATTERN = /^\[.\]\s+(\S+)/;

/**
 * One package line, e.g. "    - tauri-plugin-sql :crab:: 2.4.1" or
 * "    - @tauri-apps/plugin-log  js: not installed!". The marker between the
 * name and the colon is an emoji that differs per ecosystem; it is matched as
 * an opaque token rather than by its glyph, so a cosmetic change upstream
 * doesn't silently turn this check into a no-op. Which side of the pair a
 * line belongs to is decided by the package name instead.
 */
const ENTRY_PATTERN = /^\s*-\s+(@?[a-z][a-z0-9/-]*)\s+\S+:\s*(.+?)\s*$/;

const NPM_SCOPE = '@tauri-apps/';

/**
 * Splits `tauri info` output into { crates, npm }, each a name -> version map.
 * A package the CLI reports as absent maps to null, which is not a mismatch:
 * tauri-plugin-log, for one, is deliberately Rust-only here.
 */
export function parseTauriInfo(output) {
  const crates = new Map();
  const npm = new Map();
  let section = null;

  for (const rawLine of output.replace(ANSI_PATTERN, '').split('\n')) {
    const header = rawLine.match(SECTION_PATTERN);
    if (header) {
      section = header[1];
      continue;
    }
    if (!VERSIONED_SECTIONS.has(section)) continue;

    const entry = rawLine.match(ENTRY_PATTERN);
    if (!entry) continue;

    const [, name, rawVersion] = entry;
    // "not installed!" — the package isn't a dependency of this project.
    const version = /^not installed/.test(rawVersion)
      ? null
      : // Trailing "(outdated, latest: x.y.z)" is advisory, and the crate
        // lines put a comma before it while the npm lines don't.
        rawVersion.split(/\s+/)[0].replace(/,$/, '');

    (name.startsWith(NPM_SCOPE) ? npm : crates).set(name, version);
  }

  return { crates, npm };
}

/** "2.11.5" -> "2.11"; "2.0.0-rc.3" -> "2.0". */
function majorMinor(version) {
  const [major, minor] = version.split('.');
  return `${major}.${minor}`;
}

/**
 * The crate -> npm pairings `tauri build` enforces, for the packages this
 * project actually depends on. Derived from the info output rather than from
 * a hardcoded list, so a plugin added later is covered without touching this
 * file.
 *
 * Note: @tauri-apps/cli is deliberately not paired here. Its Rust counterpart
 * (the tauri-cli crate) isn't a dependency of this project, so `tauri info`
 * reports no crate version to compare it against.
 */
function* pairs(crates) {
  for (const crate of crates.keys()) {
    if (crate === 'tauri') {
      yield [crate, `${NPM_SCOPE}api`];
    } else if (crate.startsWith('tauri-plugin-')) {
      yield [crate, `${NPM_SCOPE}${crate.slice('tauri-'.length)}`];
    }
  }
}

/** The pairs with both halves installed — the ones actually comparable. */
function comparablePairs(crates, npm) {
  const comparable = [];

  for (const [crate, npmPackage] of pairs(crates)) {
    const crateVersion = crates.get(crate);
    const npmVersion = npm.get(npmPackage);
    // A pair only exists once both halves are installed.
    if (!crateVersion || !npmVersion) continue;

    comparable.push({ crate, crateVersion, npmPackage, npmVersion });
  }

  return comparable;
}

/**
 * Returns one entry per crate/npm pair that would stop `tauri build`.
 * An empty array means the tree is in lockstep.
 */
export function findMismatches(output) {
  const { crates, npm } = parseTauriInfo(output);

  return comparablePairs(crates, npm).filter(
    (pair) => majorMinor(pair.crateVersion) !== majorMinor(pair.npmVersion),
  );
}

function main() {
  let output;
  try {
    output = execFileSync('pnpm', ['tauri', 'info'], { encoding: 'utf-8' });
  } catch (error) {
    // `tauri info` reports environment gaps (a missing Xcode, say) through
    // its exit code. Those say nothing about version lockstep, so keep going
    // whenever it still produced output to read.
    output = error.stdout;
    if (!output) {
      console.error('Could not run `pnpm tauri info`:', error.message);
      process.exit(1);
    }
  }

  const { crates, npm } = parseTauriInfo(output);
  if (crates.size === 0 || npm.size === 0) {
    console.error(
      'Parsed no Tauri packages out of `pnpm tauri info` — its output format ' +
        'has probably changed, and this check is no longer checking anything.',
    );
    process.exit(1);
  }

  const mismatches = findMismatches(output);
  if (mismatches.length > 0) {
    console.error('Tauri crate/npm version mismatch — `tauri build` will refuse to run:\n');
    for (const m of mismatches) {
      console.error(`  ${m.crate} ${m.crateVersion}  vs  ${m.npmPackage} ${m.npmVersion}`);
    }
    console.error('\nBring the pair onto the same major/minor release. Usually the crate');
    console.error('moved and the npm package needs to catch up:');
    for (const m of mismatches) {
      console.error(`  pnpm add ${m.npmPackage}@^${m.crateVersion}`);
    }
    process.exit(1);
  }

  console.log(
    `Tauri versions in lockstep (${comparablePairs(crates, npm).length} crate/npm pairs checked).`,
  );
}

// Only run the CLI when executed directly, so the tests can import the parser.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
