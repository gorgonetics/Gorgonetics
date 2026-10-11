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

import { doc, type Firestore, serverTimestamp, setDoc } from 'firebase/firestore';
import { firestore as defaultFirestore } from '$lib/firebase.js';
import { type GeneEffect, type GeneReport, type GeneReportSpecies, TEMPLATE_SPECIES } from '$lib/types/index.js';
import { errorMessage } from '$lib/utils/error.js';
import { sha256Hex } from '$lib/utils/hash.js';
import { getEffectOptionsForSpecies } from './configService.js';
import { TEMPLATE_BUNDLE_HASH_KEY } from './demoService.js';
import { loadBundledResource } from './fileService.js';
import { exportGenesToJson } from './geneService.js';
import { getSetting, setSetting } from './settingsService.js';

export const GENE_REPORTS_COLLECTION = 'geneReports';

// Limits mirrored from `isValidGeneReport` in firestore.rules. The rules are
// the enforcement; these give honest users an error before any network call.
export const MAX_NOTE_LENGTH = 1000;
export const MAX_REPORTS_PER_SUBMISSION = 50;
const MAX_APP_VERSION_LENGTH = 32;
const GENE_ID = /^[0-9]{2}[A-Z][0-9]$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

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

export interface SubmitResult {
  /** Reports the server accepted. */
  sent: number;
  /**
   * Reports the rules denied. After `validateGeneReport` passes, a denial is
   * almost always a duplicate create — this install sent the same
   * correction before but lost its local record (a DB reset or restore).
   */
  duplicates: number;
  /** Reports that failed for another reason (network, server); they stay reportable. */
  failed: number;
  /** Message of the first such failure, when `failed > 0`. */
  error?: string;
}

/** Template and DB both write a cleared effect as `''` in places; reports use `'None'`. */
function normaliseEffect(value: string | null | undefined): string {
  return value == null || value === '' ? 'None' : value;
}

function bundledChromosomePath(species: GeneReportSpecies, chromosome: string): string {
  return `resources/assets/${species}/${species}_genes_${chromosome}.json`;
}

/**
 * Doc ID = SHA-256 hex of `installId|species|gene|proposedDominant|proposedRecessive`.
 * Create-only rules make a second send of the same correction from one
 * install fail, so it counts once. The install ID never leaves the machine
 * as a field, and a hash per proposal does not link one install's reports.
 */
export function reportDocId(
  installId: string,
  report: Pick<GeneReport, 'species' | 'gene' | 'proposedDominant' | 'proposedRecessive'>,
): Promise<string> {
  return sha256Hex(
    [installId, report.species, report.gene, report.proposedDominant, report.proposedRecessive].join('|'),
  );
}

async function getInstallId(): Promise<string> {
  const existing = await getSetting<string>(INSTALL_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setSetting(INSTALL_ID_KEY, id);
  return id;
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
 * the bundled template. Empty when the species has no templates or the
 * template bundle hash is not recorded yet (first launch still seeding).
 */
export async function findReportableChanges(species: string, chromosome: string): Promise<ReportableChange[]> {
  if (!isTemplateSpecies(species)) return [];
  const templateBundleHash = await getSetting<string | undefined>(TEMPLATE_BUNDLE_HASH_KEY);
  if (typeof templateBundleHash !== 'string' || !SHA256_HEX.test(templateBundleHash)) return [];

  const bundled = JSON.parse(await loadBundledResource(bundledChromosomePath(species, chromosome))) as {
    gene: string;
    effectDominant: string;
    effectRecessive: string;
  }[];
  const bundledByGene = new Map(bundled.map((g) => [g.gene, g]));
  const current = await exportGenesToJson(species, chromosome);

  const [installId, sentIds] = await Promise.all([getInstallId(), getSentIds()]);
  const changes: ReportableChange[] = [];
  for (const g of current) {
    const b = bundledByGene.get(g.gene);
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
    if (report.proposedDominant === report.bundledDominant && report.proposedRecessive === report.bundledRecessive) {
      continue;
    }
    const docId = await reportDocId(installId, report);
    changes.push({ report, docId, alreadySent: sentIds.has(docId) });
  }
  return changes;
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
  if (pending.length === 0) return { sent: 0, duplicates: 0, failed: 0 };
  if (pending.length > MAX_REPORTS_PER_SUBMISSION) {
    throw new Error(`At most ${MAX_REPORTS_PER_SUBMISSION} genes can be reported at once (got ${pending.length}).`);
  }

  const reports = pending.map((c) => ({ docId: c.docId, report: { ...c.report, note } as GeneReport }));
  for (const { report } of reports) {
    const errors = validateGeneReport(report);
    if (errors.length > 0) throw new Error(`Report for ${report.gene} is not valid: ${errors.join('; ')}.`);
  }

  const results = await Promise.allSettled(
    reports.map(({ docId, report }) =>
      setDoc(doc(db, GENE_REPORTS_COLLECTION, docId), { ...report, submittedAt: serverTimestamp() }),
    ),
  );

  const recorded: string[] = [];
  let sent = 0;
  let duplicates = 0;
  let failed = 0;
  let error: string | undefined;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      sent++;
      recorded.push(reports[i].docId);
    } else if (isPermissionDenied(r.reason)) {
      duplicates++;
      recorded.push(reports[i].docId);
    } else {
      failed++;
      error ??= errorMessage(r.reason);
    }
  });

  if (recorded.length > 0) {
    const sentIds = await getSentIds();
    for (const id of recorded) sentIds.add(id);
    await setSetting(SENT_KEY, [...sentIds]);
  }
  return { sent, duplicates, failed, error };
}

function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'permission-denied';
}
