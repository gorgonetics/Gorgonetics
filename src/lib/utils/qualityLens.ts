/**
 * The Quality lens: the roster's Quality score drawn on the genome grid.
 *
 * Each cell takes the standing `scorePet` gives the benefit allele the pet
 * carries there — only carrier, only true breeder, or backed up by another
 * stabled animal (of the same sex, for a recessive) — and the drawer lists the genes behind the number. Both
 * come from one `explainQuality` call, so the lens cannot disagree with the
 * column.
 *
 * Pure: no DB, no Svelte.
 */

import { type Gender, GeneType } from '$lib/types/index.js';
import type { ParsedChromosome } from '$lib/utils/geneAnalysis.js';
import type { QualityContribution, QualityStanding } from '$lib/utils/geneticQuality.js';
import type { PetLoci } from '$lib/utils/petLoci.js';
import { escapeHtml } from '$lib/utils/string.js';

/** The pet's genotypes from a rendered grid, so a preview pet needs no DB read. */
export function gridToLoci(grid: Readonly<Record<string, ParsedChromosome>>): PetLoci {
  const loci: PetLoci = new Map();
  for (const chromosome of Object.values(grid)) {
    for (const gene of chromosome.allGenes) loci.set(gene.id, gene.type as GeneType);
  }
  return loci;
}

export const STANDING_LABEL: Readonly<Record<QualityStanding, string>> = {
  sole: 'Only carrier',
  lock: 'Only true breeder',
  backed: 'Backed up',
};

export const STANDING_HINT: Readonly<Record<QualityStanding, string>> = {
  sole: 'No other stabled pet carries this allele (of the same sex, for a recessive)',
  lock: 'Other stabled pets carry it, but none breeds it true (of the same sex, for a recessive)',
  backed: 'Another stabled pet supplies it — nothing is lost without this one',
};

/** `Only carrier`, or `Only male carrier` for a recessive judged by sex. */
export function standingLabel(standing: QualityStanding, sex?: Gender): string {
  if (!sex || standing === 'backed') return STANDING_LABEL[standing];
  return STANDING_LABEL[standing].replace(/^Only /, `Only ${sex.toLowerCase()} `);
}

/** The hint for one allele, naming the sex when the standing was read per sex. */
export function standingHint(standing: QualityStanding, sex?: Gender): string {
  if (!sex || standing === 'backed') return STANDING_HINT[standing];
  const others = `other stabled ${sex.toLowerCase()}s`;
  const why = 'a recessive needs the allele from both parents';
  return standing === 'sole'
    ? `No ${others} carry this allele — ${why}`
    : `${others.charAt(0).toUpperCase()}${others.slice(1)} carry it, but none breeds it true — ${why}`;
}

const allele = (a: QualityContribution['allele']) => (a === GeneType.DOMINANT ? 'D' : 'R');

/** What one slot does, as the player reads it: `Temperament +` or `no Temperament −`. */
export function benefitText(c: Pick<QualityContribution, 'kind' | 'attribute'>): string {
  const attribute = c.attribute ? c.attribute.charAt(0).toUpperCase() + c.attribute.slice(1) : 'effect';
  return c.kind === 'add' ? `${attribute} +` : `no ${attribute} −`;
}

/** One gene in the drawer list: an allele and every benefit it carries. */
export interface QualityRow {
  gene: string;
  allele: 'D' | 'R';
  benefits: string[];
  standing: Exclude<QualityStanding, 'backed'>;
  /** Set when the standing was read against this sex only. */
  sex?: Gender;
  generic: boolean;
  value: number;
}

/**
 * The contributions grouped per gene and allele, most valuable first. A
 * chromosome-1 recessive can add one attribute and clear another; it is one
 * allele to keep, so one row.
 */
export function qualityRows(contributions: readonly QualityContribution[]): QualityRow[] {
  const rows = new Map<string, QualityRow>();
  for (const c of contributions) {
    const key = `${c.gene}:${c.allele}`;
    const row = rows.get(key);
    if (row) {
      row.benefits.push(benefitText(c));
      row.value += c.value;
    } else {
      rows.set(key, {
        gene: c.gene,
        allele: allele(c.allele),
        benefits: [benefitText(c)],
        standing: c.standing,
        ...(c.sex ? { sex: c.sex } : {}),
        generic: c.generic,
        value: c.value,
      });
    }
  }
  return [...rows.values()].sort((a, b) => b.value - a.value || a.gene.localeCompare(b.gene));
}

/** Short form for a roster tooltip: `01A2 R (Temperament +, only male carrier)`. */
export function rowText(row: QualityRow): string {
  return `${row.gene} ${row.allele} (${row.benefits.join(', ')}, ${standingLabel(row.standing, row.sex).toLowerCase()})`;
}

const SAFE_GENE_ID = /^[A-Za-z0-9_-]+$/;

export interface QualityCSSInput {
  scope: string;
  standing: ReadonlyMap<string, QualityStanding>;
  /** A gene picked in the drawer, outlined so it can be found. */
  highlight?: string | null;
}

/** Custom properties only, like the other lens sheets; `geneCell.css` paints them. */
export function buildQualityCSS({ scope, standing, highlight }: QualityCSSInput): string {
  const groups: Record<QualityStanding, string[]> = { sole: [], lock: [], backed: [] };
  for (const [gene, s] of standing) if (SAFE_GENE_ID.test(gene)) groups[s].push(gene);
  const out: string[] = [];
  for (const s of ['backed', 'lock', 'sole'] as const) {
    if (groups[s].length === 0) continue;
    const selectors = groups[s].map((id) => `${scope} .gene-cell[data-gene-id="${id}"]`).join(',\n');
    out.push(`${selectors} { --quality-fill: var(--quality-${s}); }`);
  }
  if (highlight && SAFE_GENE_ID.test(highlight)) {
    out.push(`${scope} .gene-cell[data-gene-id="${highlight}"] { --quality-ring: var(--quality-highlight); }`);
  }
  return out.join('\n');
}

/**
 * Tooltip card for one cell. Lines are HTML (GeneTooltip renders them with
 * `{@html}`), and the attribute name comes from the gene table, so it is escaped.
 */
export function qualityTooltip(
  gene: string,
  standing: QualityStanding | undefined,
  contributions: readonly QualityContribution[],
): { subtitle: string; lines: string[] } {
  if (!standing) return { subtitle: 'No benefit allele here', lines: [] };
  const mine = contributions.filter((c) => c.gene === gene);
  const lines = mine.map(
    (c) =>
      `${allele(c.allele)}: ${escapeHtml(benefitText(c))} · ${c.generic ? 'any breed' : 'breed-locked'} · ${c.value.toFixed(c.value < 0.1 ? 2 : 1)}`,
  );
  const sex = mine.find((c) => c.standing === standing)?.sex;
  return { subtitle: `${standingLabel(standing, sex)} — ${standingHint(standing, sex).toLowerCase()}`, lines };
}
