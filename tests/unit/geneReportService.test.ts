/**
 * Unit tests for geneReportService with the Firestore SDK, settings store,
 * bundled templates and gene DB mocked. The rules themselves are covered by
 * tests/integration/geneReports.emulator.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ col, id }),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  setDoc: (ref: unknown, data: unknown) => setDoc(ref, data),
}));
vi.mock('$lib/firebase.js', () => ({ firestore: {} }));

const settings = new Map<string, unknown>();
vi.mock('$lib/services/settingsService.js', () => ({
  getSetting: async (key: string) => settings.get(key),
  setSetting: async (key: string, value: unknown) => {
    settings.set(key, value);
  },
}));

vi.mock('$lib/services/demoService.js', () => ({ TEMPLATE_BUNDLE_HASH_KEY: 'genes.templateBundleHash' }));

const loadBundledResource = vi.fn();
vi.mock('$lib/services/fileService.js', () => ({
  loadBundledResource: (path: string) => loadBundledResource(path),
}));

const exportGenesToJson = vi.fn();
vi.mock('$lib/services/geneService.js', () => ({
  exportGenesToJson: (species: string, chromosome: string) => exportGenesToJson(species, chromosome),
}));

import {
  findReportableChanges,
  MAX_REPORTS_PER_SUBMISSION,
  type ReportableChange,
  reportDocId,
  submitGeneReports,
  validateGeneReport,
} from '$lib/services/geneReportService.js';
import type { GeneReport } from '$lib/types/index.js';

const HASH = 'c'.repeat(64);

const BUNDLED = [
  { gene: '26B1', effectDominant: 'Toughness+', effectRecessive: 'None' },
  { gene: '26B2', effectDominant: 'None', effectRecessive: 'Virility-' },
  { gene: '26B3', effectDominant: 'Toughness+', effectRecessive: 'None' },
];

function setDb(current: { gene: string; effectDominant: string; effectRecessive: string }[]) {
  exportGenesToJson.mockResolvedValue(current);
}

beforeEach(() => {
  settings.clear();
  settings.set('genes.templateBundleHash', HASH);
  loadBundledResource.mockResolvedValue(JSON.stringify(BUNDLED));
  setDb(BUNDLED);
});

afterEach(() => {
  setDoc.mockReset();
  loadBundledResource.mockReset();
  exportGenesToJson.mockReset();
});

function validReport(overrides: Partial<GeneReport> = {}): GeneReport {
  return {
    species: 'horse',
    gene: '26B3',
    bundledDominant: 'Toughness+',
    bundledRecessive: 'None',
    proposedDominant: 'Ruggedness+',
    proposedRecessive: 'None',
    note: '',
    templateBundleHash: HASH,
    appVersion: '0.10.3',
    schemaVersion: 1,
    ...overrides,
  };
}

describe('findReportableChanges', () => {
  it('returns only genes whose effects differ from the bundled template', async () => {
    setDb([BUNDLED[0], BUNDLED[1], { gene: '26B3', effectDominant: 'Ruggedness+', effectRecessive: 'None' }]);
    const changes = await findReportableChanges('horse', 'chr26');
    expect(loadBundledResource).toHaveBeenCalledWith('resources/assets/horse/horse_genes_chr26.json');
    expect(changes).toHaveLength(1);
    expect(changes[0].report).toMatchObject({
      species: 'horse',
      gene: '26B3',
      bundledDominant: 'Toughness+',
      bundledRecessive: 'None',
      proposedDominant: 'Ruggedness+',
      proposedRecessive: 'None',
      templateBundleHash: HASH,
      schemaVersion: 1,
    });
    expect(changes[0].docId).toMatch(/^[a-f0-9]{64}$/);
    expect(changes[0].alreadySent).toBe(false);
  });

  it("treats the editor's cleared effect '' as 'None'", async () => {
    // 26B2's dominant is 'None' in the bundle; the editor writes '' for it.
    setDb([BUNDLED[0], { gene: '26B2', effectDominant: '', effectRecessive: 'Virility-' }, BUNDLED[2]]);
    expect(await findReportableChanges('horse', 'chr26')).toEqual([]);
  });

  it('reports a cleared effect as None', async () => {
    setDb([BUNDLED[0], { gene: '26B2', effectDominant: 'None', effectRecessive: '' }, BUNDLED[2]]);
    const [change] = await findReportableChanges('horse', 'chr26');
    expect(change.report).toMatchObject({ bundledRecessive: 'Virility-', proposedRecessive: 'None' });
  });

  it('returns nothing for a species without templates', async () => {
    expect(await findReportableChanges('dragon', 'chr01')).toEqual([]);
    expect(loadBundledResource).not.toHaveBeenCalled();
  });

  it('returns nothing until the template bundle hash is recorded', async () => {
    settings.delete('genes.templateBundleHash');
    setDb([{ ...BUNDLED[0], effectDominant: 'Ruggedness+' }]);
    expect(await findReportableChanges('horse', 'chr26')).toEqual([]);
  });

  it('marks a change this install already sent', async () => {
    setDb([{ ...BUNDLED[0], effectDominant: 'Ruggedness+' }]);
    const [first] = await findReportableChanges('horse', 'chr26');
    settings.set('geneReports.sent', [first.docId]);
    const [again] = await findReportableChanges('horse', 'chr26');
    expect(again.alreadySent).toBe(true);
  });

  it('creates the install ID once and reuses it', async () => {
    setDb([{ ...BUNDLED[0], effectDominant: 'Ruggedness+' }]);
    const [a] = await findReportableChanges('horse', 'chr26');
    const installId = settings.get('geneReports.installId');
    expect(installId).toEqual(expect.any(String));
    const [b] = await findReportableChanges('horse', 'chr26');
    expect(settings.get('geneReports.installId')).toBe(installId);
    expect(b.docId).toBe(a.docId);
  });
});

describe('reportDocId', () => {
  const r: Pick<GeneReport, 'species' | 'gene' | 'proposedDominant' | 'proposedRecessive'> = {
    species: 'horse',
    gene: '26B3',
    proposedDominant: 'Ruggedness+',
    proposedRecessive: 'None',
  };

  it('is stable for the same install and proposal', async () => {
    expect(await reportDocId('install-a', r)).toBe(await reportDocId('install-a', r));
  });

  it('differs between installs and between proposals', async () => {
    const base = await reportDocId('install-a', r);
    expect(await reportDocId('install-b', r)).not.toBe(base);
    expect(await reportDocId('install-a', { ...r, proposedDominant: 'Toughness-' })).not.toBe(base);
  });
});

describe('validateGeneReport', () => {
  it('accepts a valid report', () => {
    expect(validateGeneReport(validReport())).toEqual([]);
  });

  it.each<[string, Partial<GeneReport>]>([
    ['unknown species', { species: 'dragon' as GeneReport['species'] }],
    ['malformed gene ID', { gene: '26B31' }],
    ['effect of the other species', { proposedDominant: 'Ferocity+' }],
    ['proposal equal to bundled', { proposedDominant: 'Toughness+' }],
    ['note over the limit', { note: 'x'.repeat(1001) }],
    ['malformed template hash', { templateBundleHash: 'abc' }],
    ['empty app version', { appVersion: '' }],
    ['long app version', { appVersion: 'v'.repeat(33) }],
  ])('rejects %s', (_label, override) => {
    expect(validateGeneReport(validReport(override))).not.toEqual([]);
  });
});

function change(gene: string, overrides: Partial<ReportableChange> = {}): ReportableChange {
  const { note: _note, ...report } = validReport({ gene });
  return { report, docId: gene.toLowerCase().padEnd(64, 'f'), alreadySent: false, ...overrides };
}

describe('submitGeneReports', () => {
  it('writes each pending report with the note and a server timestamp', async () => {
    setDoc.mockResolvedValue(undefined);
    const result = await submitGeneReports([change('26B3'), change('26B4')], 'checked in game');
    expect(result).toEqual({ sent: 2, duplicates: 0, failed: 0, error: undefined });
    expect(setDoc).toHaveBeenCalledTimes(2);
    const [ref, data] = setDoc.mock.calls[0];
    expect(ref).toEqual({ col: 'geneReports', id: change('26B3').docId });
    expect(data).toEqual({ ...validReport(), note: 'checked in game', submittedAt: 'SERVER_TIMESTAMP' });
    expect(settings.get('geneReports.sent')).toEqual([change('26B3').docId, change('26B4').docId]);
  });

  it('skips changes already sent', async () => {
    setDoc.mockResolvedValue(undefined);
    const result = await submitGeneReports([change('26B3', { alreadySent: true })], '');
    expect(result.sent).toBe(0);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('refuses an oversized submission before any write', async () => {
    const many = Array.from({ length: MAX_REPORTS_PER_SUBMISSION + 1 }, (_, i) =>
      change(`${String(i % 48).padStart(2, '0')}A1`, { docId: String(i).padStart(64, '0') }),
    );
    await expect(submitGeneReports(many, '')).rejects.toThrow(/at most/i);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('refuses an over-long note before any write', async () => {
    await expect(submitGeneReports([change('26B3')], 'x'.repeat(1001))).rejects.toThrow(/note/);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('counts a rules denial as a duplicate and records it as sent', async () => {
    setDoc.mockResolvedValueOnce(undefined).mockRejectedValueOnce({ code: 'permission-denied' });
    const result = await submitGeneReports([change('26B3'), change('26B4')], '');
    expect(result).toMatchObject({ sent: 1, duplicates: 1, failed: 0 });
    expect(settings.get('geneReports.sent')).toEqual([change('26B3').docId, change('26B4').docId]);
  });

  it('reports other failures and keeps those changes unsent', async () => {
    setDoc.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('unavailable'));
    const result = await submitGeneReports([change('26B3'), change('26B4')], '');
    expect(result).toMatchObject({ sent: 1, duplicates: 0, failed: 1, error: 'unavailable' });
    expect(settings.get('geneReports.sent')).toEqual([change('26B3').docId]);
  });
});
