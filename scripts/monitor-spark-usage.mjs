#!/usr/bin/env node
/**
 * Spark-plan soft-cap monitor for the public pet sharing catalogue.
 *
 * Reads every doc in `/pets` and `/genomes`, sums their serialised
 * sizes, and prints a usage report against Firebase Spark limits.
 * Run manually — there's no in-app surface for this. The Firebase
 * console dashboard is still the authoritative source for
 * reads/writes/egress quotas; this script's value-add is a quick
 * `STORAGE` snapshot you can pipe to a log without opening the web
 * console.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/key.json pnpm monitor:spark
 *
 * Auth: a Firebase Admin SDK service-account key (JSON) for the
 * production project. Generate via:
 *   Firebase console → Project settings → Service accounts →
 *   Generate new private key. Save OUTSIDE the repo (e.g.
 *   `~/.config/gorgonetics/firebase-admin-key.json`). Never commit.
 *   See docs/firebase-setup.md.
 *
 * Output is intentionally readable rather than machine-parseable —
 * this is a human-eyeballing tool. If a CI gate needs structured
 * usage telemetry later, the `--json` flag is a natural extension.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Spark plan limits (verified against
// https://firebase.google.com/pricing on 2026-05-09). These are the
// hard daily caps; the script warns at 75% and errors at 100%.
export const SPARK_STORAGE_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB Firestore storage

export const WARN_THRESHOLD = 0.75;
export const ERROR_THRESHOLD = 1.0;

function fail(message) {
  console.error(`monitor-spark-usage: ${message}`);
  process.exit(1);
}

function loadServiceAccount() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!path) {
    fail(
      'FIREBASE_SERVICE_ACCOUNT_PATH env var is required. Generate a key via Firebase console → Project settings → Service accounts and save it OUTSIDE this repo. See docs/firebase-setup.md.',
    );
  }
  const abs = resolve(path);
  if (!existsSync(abs)) fail(`service account key not found at ${abs}`);
  try {
    return JSON.parse(readFileSync(abs, 'utf-8'));
  } catch (err) {
    fail(`service account key at ${abs} is not valid JSON: ${err.message}`);
  }
  return null; // unreachable, makes the type-checker happy
}

/**
 * Sum the serialised JSON byte size of every doc in `collection`.
 * Approximates Firestore's on-disk storage cost — the actual
 * server-side overhead per doc is slightly higher (index entries,
 * metadata), but the approximation is within ~10% in practice and
 * good enough for a soft-cap warning.
 */
async function summariseCollection(db, name) {
  const snap = await db.collection(name).get();
  let bytes = 0;
  for (const doc of snap.docs) {
    bytes += Buffer.byteLength(JSON.stringify(doc.data()), 'utf-8');
  }
  return { count: snap.size, bytes };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

export function formatRow(label, value, width = 24) {
  return `${label.padEnd(width)}${value}`;
}

export function statusFor(ratio) {
  if (ratio >= ERROR_THRESHOLD) return 'OVER';
  if (ratio >= WARN_THRESHOLD) return 'WARN';
  return 'OK';
}

async function main() {
  const serviceAccount = loadServiceAccount();
  // Lazy-load the heavy Admin SDK so the module's pure helpers can be
  // unit-tested without pulling firebase-admin into the test process.
  const { default: admin } = await import('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  // The two halves of the split-collection catalogue (see
  // shareService.ts). Metadata is the small one; the genome blobs
  // dominate the total.
  const [pets, genomes] = await Promise.all([summariseCollection(db, 'pets'), summariseCollection(db, 'genomes')]);

  const totalBytes = pets.bytes + genomes.bytes;
  const ratio = totalBytes / SPARK_STORAGE_BYTES;
  const pct = (ratio * 100).toFixed(1);
  const status = statusFor(ratio);

  console.log('Spark plan — Firestore storage snapshot');
  console.log('───────────────────────────────────────');
  console.log(formatRow('Project:', serviceAccount.project_id));
  console.log(formatRow('/pets docs:', `${pets.count.toLocaleString()}  (${formatBytes(pets.bytes)})`));
  console.log(formatRow('/genomes docs:', `${genomes.count.toLocaleString()}  (${formatBytes(genomes.bytes)})`));
  console.log(formatRow('Total estimated:', `${formatBytes(totalBytes)} of ${formatBytes(SPARK_STORAGE_BYTES)} (${pct}%)  [${status}]`));
  console.log('');
  console.log('Reads/writes/egress quotas are tracked on the Firebase console');
  console.log('dashboard — this script only covers the storage cap.');

  // Exit non-zero on OVER so the script can wire into a cron/CI
  // alert later without parsing stdout.
  if (status === 'OVER') process.exit(2);
}

// Only run when executed directly (`pnpm monitor:spark`), not when the
// module is imported for its helpers (unit tests).
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    fail(err.stack ?? err.message ?? String(err));
  });
}
