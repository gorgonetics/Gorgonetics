#!/usr/bin/env node
/**
 * Spark-plan soft-cap monitor for the public pet sharing catalogue.
 *
 * Reads every doc in `/pets`, `/genomes` and `/geneReports`, sums their serialised
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
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServiceAccount } from './firebase-service-account.mjs';

// Spark plan limits (verified against
// https://firebase.google.com/pricing on 2026-05-09). These are the
// hard daily caps; the script warns at 75% and errors at 100%.
export const SPARK_STORAGE_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB Firestore storage

export const WARN_THRESHOLD = 0.75;
export const ERROR_THRESHOLD = 1.0;

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`monitor-spark-usage: ${message}`);
  process.exit(1);
}

/**
 * Sum the serialised JSON byte size of every doc in `collection`.
 * Approximates Firestore's on-disk storage cost — the actual
 * server-side overhead per doc is slightly higher (index entries,
 * metadata), but the approximation is within ~10% in practice and
 * good enough for a soft-cap warning.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} name
 */
async function summariseCollection(db, name) {
  const snap = await db.collection(name).get();
  let bytes = 0;
  for (const doc of snap.docs) {
    bytes += Buffer.byteLength(JSON.stringify(doc.data()), 'utf-8');
  }
  return { count: snap.size, bytes };
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

/**
 * @param {string} label
 * @param {string | number} value
 * @param {number} [width]
 */
export function formatRow(label, value, width = 24) {
  return `${label.padEnd(width)}${value}`;
}

/** @param {number} ratio */
export function statusFor(ratio) {
  if (ratio >= ERROR_THRESHOLD) return 'OVER';
  if (ratio >= WARN_THRESHOLD) return 'WARN';
  return 'OK';
}

async function main() {
  /** @type {Record<string, any>} */
  let serviceAccount;
  try {
    serviceAccount = loadServiceAccount({ allowInline: false });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  // Lazy-load the heavy Admin SDK so the module's pure helpers can be
  // unit-tested without pulling firebase-admin into the test process.
  // Modular API: firebase-admin v14 no longer has the namespaced
  // `admin.credential` / `admin.firestore` on its default export.
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const db = getFirestore(initializeApp({ credential: cert(serviceAccount) }));

  // The two halves of the split-collection catalogue (see
  // shareService.ts) — metadata is the small one, the genome blobs
  // dominate the total — plus the gene effect reports.
  const [pets, genomes, geneReports] = await Promise.all([
    summariseCollection(db, 'pets'),
    summariseCollection(db, 'genomes'),
    summariseCollection(db, 'geneReports'),
  ]);

  const totalBytes = pets.bytes + genomes.bytes + geneReports.bytes;
  const ratio = totalBytes / SPARK_STORAGE_BYTES;
  const pct = (ratio * 100).toFixed(1);
  const status = statusFor(ratio);

  console.log('Spark plan — Firestore storage snapshot');
  console.log('───────────────────────────────────────');
  console.log(formatRow('Project:', serviceAccount.project_id));
  console.log(formatRow('/pets docs:', `${pets.count.toLocaleString()}  (${formatBytes(pets.bytes)})`));
  console.log(formatRow('/genomes docs:', `${genomes.count.toLocaleString()}  (${formatBytes(genomes.bytes)})`));
  console.log(
    formatRow('/geneReports docs:', `${geneReports.count.toLocaleString()}  (${formatBytes(geneReports.bytes)})`),
  );
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
