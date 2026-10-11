/**
 * Gene effect reports: send a user's gene-effect corrections to the
 * `/geneReports` Firestore collection, where a scheduled GitHub Action
 * turns them into one issue per gene. See
 * docs/design/gene-effect-reports-v1.md.
 *
 * The baseline of a report is the bundled template, not the DB state when
 * the editor loaded: after one save, the DB holds the user's own edit, and
 * an earlier session's edits must still be reportable.
 */

import { doc, type Firestore, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { firestore as defaultFirestore } from '$lib/firebase.js';
import { type GeneEffect, type GeneReport, type GeneReportSpecies, TEMPLATE_SPECIES } from '$lib/types/index.js';
import { errorMessage, isPermissionDenied } from '$lib/utils/error.js';
import { normaliseEffect } from '$lib/utils/geneAnalysis.js';
import { sha256Hex } from '$lib/utils/hash.js';
import { getEffectOptionsForSpecies } from './configService.js';
import { loadBundledResource } from './fileService.js';
import { exportGenesToJson } from './geneService.js';
import { getSetting, setSetting, TEMPLATE_BUNDLE_HASH_KEY } from './settingsService.js';

export const GENE_REPORTS_COLLECTION = 'geneReports';

// Limits mirrored from `isValidGeneReport` in firestore.rules. The rules are
// the enforcement; these give honest users an error before any network call.
export const MAX_NOTE_LENGTH = 1000;
export const MAX_REPORTS_PER_SUBMISSION = 50;
const MAX_APP_VERSION_LENGTH = 32;
const GENE_ID = /^[0-9]{2}[A-Z][0-9]$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * How long one report may wait for the server. Offline, Firestore queues a
 * write and resolves only when the server confirms it, so without a limit
 * the dialog would wait forever. A timed-out write may still go out later;
 * the next send of it is then a duplicate, which `submitGeneReports` detects.
 */
export const SEND_TIMEOUT_MS = 20_000;

const INSTALL_ID_KEY = 'geneReports.installId';
const SENT_KEY = 'geneReports.sent';

declare const __APP_VERSION__: string;
const APP_VERSION = __APP_VERSION__;

/** A gene whose effects differ from the bundled template, ready to report. */
export interface ReportableChange {
  /** The report minus the note, which is per submission. */
  report: Omit<GeneReport, 'note'>;
  /** Firestore doc ID; see `reportDocId`. */
  docId: string;
  /** True when this install has already sent this exact correction. */
  alreadySent: boolean;
}

/** Effect columns of a gene row, from the DB or the editor. */
export interface GeneEffectRow {
  gene: string;
  effectDominant: string | null;
  effectRecessive: string | null;
}

export interface SubmitResult {
  /** Reports the server accepted. */
  sent: number;
  /** Reports the server already held: this install sent them before but lost its local record. */
  duplicates: number;
  /** Reports refused, timed out or failed otherwise; they stay reportable. */
  failed: number;
  /** Message of the first failure, when `failed > 0`. */
  error?: string;
  /** Doc IDs now on the server (sent or duplicate), recorded as sent. */
  recorded: string[];
}

function bundledChromosomePath(species: GeneReportSpecies, chromosome: string): string {
  return `resources/assets/${species}/${species}_genes_${chromosome}.json`;
}

// The bundled templates cannot change while the app runs, so each
// chromosome file is read and parsed once.
const bundleCache = new Map<string, Promise<Map<string, GeneEffectRow>>>();

function loadBundledChromosome(species: GeneReportSpecies, chromosome: string): Promise<Map<string, GeneEffectRow>> {
  const path = bundledChromosomePath(species, chromosome);
  let cached = bundleCache.get(path);
  if (!cached) {
    const pending = loadBundledResource(path).then(
      (text) => new Map((JSON.parse(text) as GeneEffectRow[]).map((g) => [g.gene, g])),
    );
    // A failed read must not stick: drop it so the next call retries.
    pending.catch(() => {
      if (bundleCache.get(path) === pending) bundleCache.delete(path);
    });
    bundleCache.set(path, pending);
    cached = pending;
  }
  return cached;
}

let installIdPromise: Promise<string> | null = null;

/**
 * The install ID, created on first use. Memoised so that concurrent first
 * calls share one ID instead of each creating and saving their own.
 */
function getInstallId(): Promise<string> {
  if (!installIdPromise) {
    const pending = (async () => {
      const existing = await getSetting<string>(INSTALL_ID_KEY);
      if (existing) return existing;
      const id = crypto.randomUUID();
      await setSetting(INSTALL_ID_KEY, id);
      return id;
    })();
    // A failed settings read or write must not stick: the next call retries.
    pending.catch(() => {
      if (installIdPromise === pending) installIdPromise = null;
    });
    installIdPromise = pending;
  }
  return installIdPromise;
}

/** Drop the module caches (bundled files, install ID). For tests. */
export function clearGeneReportCaches(): void {
  bundleCache.clear();
  installIdPromise = null;
}

/**
 * Doc ID = SHA-256 hex of `installId|species|gene|proposedDominant|proposedRecessive`.
 * Create-only rules make a second send of the same correction from one
 * install fail, so it counts once. The install ID never leaves the machine
 * as a field, and a hash per proposal does not link one install's reports.
 * Only the reporting install can derive an ID, which is why the rules can
 * allow a get by ID (see `submitGeneReports`) without exposing reports.
 */
export function reportDocId(
  installId: string,
  report: Pick<GeneReport, 'species' | 'gene' | 'proposedDominant' | 'proposedRecessive'>,
): Promise<string> {
  return sha256Hex(
    [installId, report.species, report.gene, report.proposedDominant, report.proposedRecessive].join('|'),
  );
}

async function getSentIds(): Promise<Set<string>> {
  const sent = await getSetting<unknown>(SENT_KEY);
  return new Set(Array.isArray(sent) ? sent.filter((s): s is string => typeof s === 'string') : []);
}

export function isTemplateSpecies(species: string): species is GeneReportSpecies {
  return (TEMPLATE_SPECIES as readonly string[]).includes(species);
}

/**
 * Genes on one chromosome whose dominant or recessive effect differs from
 * the bundled template. Pass `current` when the caller already holds the
 * saved rows; otherwise they are read from the DB. Empty when the species
 * has no templates or the template bundle hash is not recorded yet (first
 * launch still seeding).
 */
export async function findReportableChanges(
  species: string,
  chromosome: string,
  current?: readonly GeneEffectRow[],
): Promise<ReportableChange[]> {
  if (!isTemplateSpecies(species)) return [];
  const templateBundleHash = await getSetting<string | undefined>(TEMPLATE_BUNDLE_HASH_KEY);
  if (typeof templateBundleHash !== 'string' || !SHA256_HEX.test(templateBundleHash)) return [];

  const [bundled, rows] = await Promise.all([
    loadBundledChromosome(species, chromosome),
    current ?? exportGenesToJson(species, chromosome),
  ]);

  const reports: Omit<GeneReport, 'note'>[] = [];
  for (const g of rows) {
    const b = bundled.get(g.gene);
    if (!b) continue;
    const report = {
      species,
      gene: g.gene,
      bundledDominant: normaliseEffect(b.effectDominant) as GeneEffect,
      bundledRecessive: normaliseEffect(b.effectRecessive) as GeneEffect,
      proposedDominant: normaliseEffect(g.effectDominant) as GeneEffect,
      proposedRecessive: normaliseEffect(g.effectRecessive) as GeneEffect,
      templateBundleHash,
      appVersion: APP_VERSION,
      schemaVersion: 1 as const,
    };
    if (report.proposedDominant !== report.bundledDominant || report.proposedRecessive !== report.bundledRecessive) {
      reports.push(report);
    }
  }
  // Only touch the install ID (and create it) when there is something to report.
  if (reports.length === 0) return [];

  const [installId, sentIds] = await Promise.all([getInstallId(), getSentIds()]);
  return Promise.all(
    reports.map(async (report) => {
      const docId = await reportDocId(installId, report);
      return { report, docId, alreadySent: sentIds.has(docId) };
    }),
  );
}

/**
 * Problems that would make the rules deny this report, or `[]`. Mirrors
 * `isValidGeneReport` in firestore.rules field by field.
 */
export function validateGeneReport(report: GeneReport): string[] {
  const errors: string[] = [];
  if (!isTemplateSpecies(report.species)) {
    errors.push(`unknown species '${report.species}'`);
    return errors;
  }
  if (!GENE_ID.test(report.gene)) errors.push(`gene ID '${report.gene}' is not in the template format`);
  const allowed = new Set(getEffectOptionsForSpecies(report.species));
  for (const field of ['bundledDominant', 'bundledRecessive', 'proposedDominant', 'proposedRecessive'] as const) {
    if (!allowed.has(report[field])) errors.push(`${field} '${report[field]}' is not a ${report.species} effect`);
  }
  if (report.proposedDominant === report.bundledDominant && report.proposedRecessive === report.bundledRecessive) {
    errors.push('proposed effects equal the bundled effects');
  }
  if (report.note.length > MAX_NOTE_LENGTH) errors.push(`note is longer than ${MAX_NOTE_LENGTH} characters`);
  if (!SHA256_HEX.test(report.templateBundleHash)) errors.push('template bundle hash is missing or malformed');
  if (report.appVersion.length < 1 || report.appVersion.length > MAX_APP_VERSION_LENGTH) {
    errors.push(`app version must be 1–${MAX_APP_VERSION_LENGTH} characters`);
  }
  if (report.schemaVersion !== 1) errors.push(`unsupported schema version ${report.schemaVersion}`);
  return errors;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('The server did not answer in time. The report may still be sent when you are online.')),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

type Outcome = 'sent' | 'duplicate' | { error: string };

/**
 * A create denied by the rules is either a duplicate (this install sent it
 * before) or a real refusal (rules not deployed, or rules and client
 * validation out of step). The rules allow a get by ID, so check: only a
 * report that is really on the server counts as sent.
 */
async function sendOne(db: Firestore, docId: string, report: GeneReport): Promise<Outcome> {
  const ref = doc(db, GENE_REPORTS_COLLECTION, docId);
  try {
    await withTimeout(setDoc(ref, { ...report, submittedAt: serverTimestamp() }), SEND_TIMEOUT_MS);
    return 'sent';
  } catch (err) {
    if (!isPermissionDenied(err)) return { error: errorMessage(err) };
    try {
      const snap = await withTimeout(getDoc(ref), SEND_TIMEOUT_MS);
      if (snap.exists()) return 'duplicate';
    } catch (checkErr) {
      return { error: `The server refused the report, and checking for a duplicate failed: ${errorMessage(checkErr)}` };
    }
    return { error: 'The server refused the report.' };
  }
}

/**
 * Send the given changes with one shared note. Changes this install already
 * sent are skipped. Every report is validated before the first write; one
 * invalid report stops the whole submission.
 *
 * Writes are independent creates, not one batch: a batch would fail as a
 * whole if any one report were a duplicate, blocking the new ones with it.
 */
export async function submitGeneReports(
  changes: ReportableChange[],
  note: string,
  db: Firestore = defaultFirestore,
): Promise<SubmitResult> {
  const pending = changes.filter((c) => !c.alreadySent);
  if (pending.length === 0) return { sent: 0, duplicates: 0, failed: 0, recorded: [] };
  if (pending.length > MAX_REPORTS_PER_SUBMISSION) {
    throw new Error(`At most ${MAX_REPORTS_PER_SUBMISSION} genes can be reported at once (got ${pending.length}).`);
  }

  const reports = pending.map((c) => ({ docId: c.docId, report: { ...c.report, note } as GeneReport }));
  for (const { report } of reports) {
    const errors = validateGeneReport(report);
    if (errors.length > 0) throw new Error(`Report for ${report.gene} is not valid: ${errors.join('; ')}.`);
  }

  const outcomes = await Promise.all(reports.map(({ docId, report }) => sendOne(db, docId, report)));

  const result: SubmitResult = { sent: 0, duplicates: 0, failed: 0, recorded: [] };
  outcomes.forEach((outcome, i) => {
    if (outcome === 'sent') result.sent++;
    else if (outcome === 'duplicate') result.duplicates++;
    else {
      result.failed++;
      result.error ??= outcome.error;
      return;
    }
    result.recorded.push(reports[i].docId);
  });

  if (result.recorded.length > 0) {
    const sentIds = await getSentIds();
    for (const id of result.recorded) sentIds.add(id);
    await setSetting(SENT_KEY, [...sentIds]);
  }
  return result;
}
