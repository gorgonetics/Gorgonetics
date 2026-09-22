import { describe, expect, it } from 'vitest';
import { findMismatches, parseTauriInfo } from '../../scripts/check-tauri-lockstep.mjs';

/**
 * Captured from a real `pnpm tauri info` run. Worth keeping verbatim — the
 * awkward cases are all real ones:
 *   - the crate lines put a comma before "(outdated, ...)", npm lines don't
 *   - @tauri-apps/plugin-log is "not installed!" (tauri-plugin-log is
 *     deliberately Rust-only here)
 *   - dialog and fs sit on legitimate patch drift (2.7.3/2.7.2, 2.5.2/2.5.1)
 *   - the App section contains "devUrl: http://localhost:5174/", which looks
 *     enough like a package line to fool a section-blind parser
 */
const REAL_OUTPUT = `
[-] Environment
    - OS: Mac OS 26.6.2 arm64 (X64)
    - node: 26.8.2
    - pnpm: 11.0.9

[-] Packages
    - tauri 🦀: 2.11.5, (outdated, latest: 2.11.6)
    - tauri-build 🦀: 2.6.3
    - wry 🦀: 0.55.0, (outdated, latest: 0.57.0)
    - tao 🦀: 0.35.0, (outdated, latest: 0.37.0)
    - @tauri-apps/api  ⱼₛ: 2.11.1
    - @tauri-apps/cli  ⱼₛ: 2.11.4 (outdated, latest: 2.11.5)

[-] Plugins
    - tauri-plugin-sql 🦀: 2.4.1
    - @tauri-apps/plugin-sql  ⱼₛ: 2.4.1
    - tauri-plugin-process 🦀: 2.3.1
    - @tauri-apps/plugin-process  ⱼₛ: 2.3.1
    - tauri-plugin-log 🦀: 2.9.1, (outdated, latest: 2.9.2)
    - @tauri-apps/plugin-log  ⱼₛ: not installed!
    - tauri-plugin-dialog 🦀: 2.7.3
    - @tauri-apps/plugin-dialog  ⱼₛ: 2.7.2 (outdated, latest: 2.7.3)
    - tauri-plugin-updater 🦀: 2.11.0, (outdated, latest: 2.12.0)
    - @tauri-apps/plugin-updater  ⱼₛ: 2.11.0 (outdated, latest: 2.12.0)
    - tauri-plugin-fs 🦀: 2.5.2
    - @tauri-apps/plugin-fs  ⱼₛ: 2.5.1 (outdated, latest: 2.5.2)

[-] App
    - build-type: bundle
    - frontendDist: ../build
    - devUrl: http://localhost:5174/
    - framework: Svelte
`;

/** The v0.9.1 break: the updater crate moved to 2.11, npm stayed on 2.10. */
const V091_OUTPUT = REAL_OUTPUT.replace(
  '- @tauri-apps/plugin-updater  ⱼₛ: 2.11.0 (outdated, latest: 2.12.0)',
  '- @tauri-apps/plugin-updater  ⱼₛ: 2.10.1',
);

describe('parseTauriInfo', () => {
  it('reads crate and npm versions, dropping the outdated annotation', () => {
    const { crates, npm } = parseTauriInfo(REAL_OUTPUT);

    expect(crates.get('tauri')).toBe('2.11.5');
    expect(crates.get('tauri-plugin-sql')).toBe('2.4.1');
    expect(npm.get('@tauri-apps/api')).toBe('2.11.1');
    expect(npm.get('@tauri-apps/plugin-dialog')).toBe('2.7.2');
  });

  it('records an uninstalled npm package as absent rather than as a version', () => {
    const { crates, npm } = parseTauriInfo(REAL_OUTPUT);

    expect(crates.get('tauri-plugin-log')).toBe('2.9.1');
    expect(npm.get('@tauri-apps/plugin-log')).toBeNull();
  });

  it('ignores sections that do not list packages', () => {
    const { crates } = parseTauriInfo(REAL_OUTPUT);

    // "devUrl: http://localhost:5174/" parses as a package line if the
    // parser isn't section-aware, because of the port's colon.
    expect([...crates.keys()]).not.toContain('devUrl');
    expect([...crates.keys()]).not.toContain('node');
  });

  it('strips ANSI colour codes', () => {
    const coloured = '[-] Plugins\n    - tauri-plugin-sql \u001b[32m🦀\u001b[0m: 2.4.1\n';

    expect(parseTauriInfo(coloured).crates.get('tauri-plugin-sql')).toBe('2.4.1');
  });
});

describe('findMismatches', () => {
  it('passes a tree that is in lockstep', () => {
    expect(findMismatches(REAL_OUTPUT)).toEqual([]);
  });

  it('accepts patch drift, which tauri build also accepts', () => {
    // dialog 2.7.3 vs 2.7.2 and fs 2.5.2 vs 2.5.1 are both in REAL_OUTPUT.
    expect(findMismatches(REAL_OUTPUT)).toEqual([]);
  });

  it('catches the v0.9.1 minor mismatch that broke the release build', () => {
    expect(findMismatches(V091_OUTPUT)).toEqual([
      {
        crate: 'tauri-plugin-updater',
        crateVersion: '2.11.0',
        npmPackage: '@tauri-apps/plugin-updater',
        npmVersion: '2.10.1',
      },
    ]);
  });

  it('catches a major mismatch on the core api package', () => {
    const output = REAL_OUTPUT.replace('- @tauri-apps/api  ⱼₛ: 2.11.1', '- @tauri-apps/api  ⱼₛ: 3.0.0');

    expect(findMismatches(output)).toEqual([
      {
        crate: 'tauri',
        crateVersion: '2.11.5',
        npmPackage: '@tauri-apps/api',
        npmVersion: '3.0.0',
      },
    ]);
  });

  it('does not fault a plugin whose npm package is not installed', () => {
    const output = REAL_OUTPUT.replace(
      '- tauri-plugin-log 🦀: 2.9.1, (outdated, latest: 2.9.2)',
      '- tauri-plugin-log 🦀: 9.9.9',
    );

    expect(findMismatches(output)).toEqual([]);
  });

  it('reports every mismatched pair, not just the first', () => {
    const output = V091_OUTPUT.replace('- @tauri-apps/plugin-sql  ⱼₛ: 2.4.1', '- @tauri-apps/plugin-sql  ⱼₛ: 2.3.0');

    expect(findMismatches(output).map((m) => m.crate)).toEqual(['tauri-plugin-sql', 'tauri-plugin-updater']);
  });
});
