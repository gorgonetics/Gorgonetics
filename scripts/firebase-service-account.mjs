/**
 * Load a Firebase service-account key for the Admin SDK scripts
 * (monitor-spark-usage.mjs, sync-gene-reports.mjs). See docs/firebase-setup.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The key from `FIREBASE_SERVICE_ACCOUNT` (the key JSON itself, as a CI
 * secret) or else the file at `FIREBASE_SERVICE_ACCOUNT_PATH`. Throws an
 * Error with a readable message when neither is set or the JSON is bad.
 * @param {{ allowInline?: boolean }} [options]
 * @returns {Record<string, unknown>}
 */
export function loadServiceAccount({ allowInline = true } = {}) {
  const inline = allowInline ? process.env.FIREBASE_SERVICE_ACCOUNT : undefined;
  if (inline) return parseKey(inline, 'FIREBASE_SERVICE_ACCOUNT');

  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!path) {
    throw new Error(
      `${allowInline ? 'FIREBASE_SERVICE_ACCOUNT (key JSON) or ' : ''}FIREBASE_SERVICE_ACCOUNT_PATH is required. ` +
        'Generate a key via Firebase console → Project settings → Service accounts and save it OUTSIDE this repo. ' +
        'See docs/firebase-setup.md.',
    );
  }
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`service account key not found at ${abs}`);
  return parseKey(readFileSync(abs, 'utf-8'), `service account key at ${abs}`);
}

/** @param {string} text @param {string} source */
function parseKey(text, source) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${source} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}
