/**
 * Group expansion for the gene value filter (#369).
 *
 * Resolves a locus *group* — "I want tougher horses" (§5a) or "the whole
 * of chromosome 01" (§5e) — into the loci carrying a clean positive
 * allele, using the **parsed effect columns** (`getParsedGenesCached`):
 * the same strict `Attr+`/`Attr-` parse behind `getPetGeneStats`, never
 * the grids' free-text display heuristics. Strings the strict parse
 * rejects (malformed, "potential" style) simply aren't in any expansion;
 * the genome-map path covers those.
 *
 * See docs/design/gene-value-filter-v1.md §5a, §5d, §5e, §8.
 */

import { getAttributeConfig, normalizeSpecies } from '$lib/services/configService.js';
import { getParsedGenesCached, type ParsedGeneRecord } from '$lib/services/geneService.js';
import { GeneType } from '$lib/types/index.js';
import { fromGeneId } from '$lib/utils/geneAnalysis.js';
import type { AllowedStates, GroupCriterion, GroupSource, GroupWant, KnownGeneType } from '$lib/utils/geneCriteria.js';

/** A group offered for expansion, with its scoring-locus count. */
export interface ExpandableGroup {
  source: GroupSource;
  label: string;
  lociCount: number;
}

/**
 * The clean-positive alleles of one gene record, as `[attributeLower,
 * allele]` pairs. A locus positive on **both** alleles for the same
 * attribute is ambiguous — none exist in the shipped data (0 of 1576) —
 * and yields nothing for that attribute rather than being silently
 * included (§5a). The single source of that rule: both the offered
 * counts and the expansion derive from it, so they cannot disagree (§10).
 */
function goodAlleles(record: ParsedGeneRecord): [string, KnownGeneType][] {
  const dom = record.dominantSign === '+' ? record.dominantAttribute : null;
  const rec = record.recessiveSign === '+' ? record.recessiveAttribute : null;
  if (dom && dom === rec) return [];
  const out: [string, KnownGeneType][] = [];
  if (dom) out.push([dom, GeneType.DOMINANT]);
  if (rec) out.push([rec, GeneType.RECESSIVE]);
  return out;
}

/**
 * Translate a want into the allowed states for one locus (§5a). `x` is
 * one copy of each allele and expresses as dominant, so on the dominant
 * arm "carries" and "expresses" coincide, and on the recessive arm
 * "expresses" and "pure" do — the wants still differ per expansion,
 * because expansions mix arms (§11).
 */
export function allowForWant(goodAllele: KnownGeneType, want: GroupWant): AllowedStates {
  if (want === 'carries') return [goodAllele, GeneType.MIXED];
  if (want === 'expresses') {
    return goodAllele === GeneType.DOMINANT ? [GeneType.DOMINANT, GeneType.MIXED] : [GeneType.RECESSIVE];
  }
  return [goodAllele];
}

/** Whether a gene belongs to a group source. Attribute membership is per good allele, so it's checked separately. */
function inChromosome(geneId: string, chromosome: string): boolean {
  return fromGeneId(geneId)?.chromosome === chromosome;
}

export function groupLabel(source: GroupSource): string {
  return source.type === 'attribute' ? source.attribute : `Chr ${source.chromosome}`;
}

/**
 * The groups worth offering for `species` — attributes and chromosomes
 * with at least one clean-positive locus. Ferocity reads 0 for horses
 * (it's a beewasp attribute) and is not offered rather than expanding to
 * nothing (§8); chromosomes carrying only appearance genes drop the same
 * way. Attributes come first, in `getAttributeConfig` order; chromosomes
 * follow in genome order.
 */
export async function listExpandableGroups(species: string): Promise<ExpandableGroup[]> {
  const key = normalizeSpecies(species);
  const parsed = await getParsedGenesCached(key);
  const attrCounts = new Map<string, number>();
  const chromCounts = new Map<string, number>();
  for (const [geneId, record] of Object.entries(parsed)) {
    const good = goodAlleles(record);
    if (good.length === 0) continue;
    for (const [attr] of good) attrCounts.set(attr, (attrCounts.get(attr) ?? 0) + 1);
    // A gene counts once per chromosome even when both alleles score.
    const chromosome = fromGeneId(geneId)?.chromosome;
    if (chromosome) chromCounts.set(chromosome, (chromCounts.get(chromosome) ?? 0) + 1);
  }
  const out: ExpandableGroup[] = [];
  for (const attr of getAttributeConfig(key).attributes) {
    const count = attrCounts.get(attr.key.toLowerCase());
    if (count && count > 0) {
      out.push({ source: { type: 'attribute', attribute: attr.key }, label: attr.key, lociCount: count });
    }
  }
  for (const chromosome of [...chromCounts.keys()].sort()) {
    const source: GroupSource = { type: 'chromosome', chromosome };
    out.push({ source, label: groupLabel(source), lociCount: chromCounts.get(chromosome) ?? 0 });
  }
  return out;
}

/**
 * Expand a group source into a snapshotted criterion (§11: snapshot, not
 * a live query — a template edit in Reference must not mutate an active
 * filter; the chip's editor offers re-expand). Returns null when the
 * group has no scoring loci for the species. `min` starts at 1; the
 * caller sets the median default once it has the per-pet counts (§5a).
 *
 * A chromosome locus scoring for two attributes via different alleles
 * would be ambiguous as a *chromosome* member; the shipped data has none
 * (chromosome 01 genes are dominant-negative/recessive-positive, so each
 * contributes exactly one good allele), and a template edit creating one
 * resolves to its first good allele deterministically.
 */
export async function expandGroupCriterion(
  species: string,
  source: GroupSource,
  want: GroupWant,
): Promise<GroupCriterion | null> {
  const key = normalizeSpecies(species);
  const parsed = await getParsedGenesCached(key);
  const attributeLower = source.type === 'attribute' ? source.attribute.toLowerCase() : null;
  const loci: { geneId: string; allow: AllowedStates }[] = [];
  for (const [geneId, record] of Object.entries(parsed)) {
    const good = goodAlleles(record);
    if (attributeLower !== null) {
      for (const [attr, allele] of good) {
        if (attr === attributeLower) loci.push({ geneId, allow: allowForWant(allele, want) });
      }
    } else if (source.type === 'chromosome' && good.length > 0 && inChromosome(geneId, source.chromosome)) {
      loci.push({ geneId, allow: allowForWant(good[0][1], want) });
    }
  }
  if (loci.length === 0) return null;
  loci.sort((a, b) => a.geneId.localeCompare(b.geneId));
  return { kind: 'group', label: groupLabel(source), source, want, loci, min: 1 };
}
