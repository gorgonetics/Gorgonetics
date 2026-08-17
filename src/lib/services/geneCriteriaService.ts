/**
 * Attribute expansion for the gene value filter (#369).
 *
 * Resolves "I want tougher horses" into the loci carrying a clean
 * positive allele for that attribute, using the **parsed effect columns**
 * (`getParsedGenesCached`) — the same strict `Attr+`/`Attr-` parse behind
 * `getPetGeneStats` — never the grids' free-text display heuristics
 * (design §5a). Strings the strict parse rejects (malformed, "potential"
 * style) simply aren't in any expansion; the genome-map path covers those.
 *
 * See docs/design/gene-value-filter-v1.md §5a, §5d, §8.
 */

import { getAttributeConfig, normalizeSpecies } from '$lib/services/configService.js';
import { getParsedGenesCached, type ParsedGeneRecord } from '$lib/services/geneService.js';
import { GeneType } from '$lib/types/index.js';
import type { AllowedStates, AttributeCriterion, AttributeWant, KnownGeneType } from '$lib/utils/geneCriteria.js';

/** An attribute offered for expansion, with its scoring-locus count. */
export interface ExpandableAttribute {
  /** Capitalised key, e.g. `Toughness`. */
  attribute: string;
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
export function allowForWant(goodAllele: KnownGeneType, want: AttributeWant): AllowedStates {
  if (want === 'carries') return [goodAllele, GeneType.MIXED];
  if (want === 'expresses') {
    return goodAllele === GeneType.DOMINANT ? [GeneType.DOMINANT, GeneType.MIXED] : [GeneType.RECESSIVE];
  }
  return [goodAllele];
}

/**
 * The attributes worth offering for `species` — those with at least one
 * clean-positive locus. Ferocity reads 0 for horses (it's a beewasp
 * attribute) and is not offered rather than expanding to nothing (§8).
 * Ordered as `getAttributeConfig` lists them.
 */
export async function listExpandableAttributes(species: string): Promise<ExpandableAttribute[]> {
  const key = normalizeSpecies(species);
  const parsed = await getParsedGenesCached(key);
  const counts = new Map<string, number>();
  for (const record of Object.values(parsed)) {
    for (const [attr] of goodAlleles(record)) counts.set(attr, (counts.get(attr) ?? 0) + 1);
  }
  const out: ExpandableAttribute[] = [];
  for (const attr of getAttributeConfig(key).attributes) {
    const count = counts.get(attr.key.toLowerCase());
    if (count && count > 0) out.push({ attribute: attr.key, lociCount: count });
  }
  return out;
}

/**
 * Expand an attribute into a snapshotted criterion (§11: snapshot, not a
 * live query — a template edit in Reference must not mutate an active
 * filter; the chip's editor offers re-expand). Returns null when the
 * attribute has no scoring loci for the species. `min` starts at 1; the
 * caller sets the median default once it has the per-pet counts (§5a).
 */
export async function expandAttributeCriterion(
  species: string,
  attribute: string,
  want: AttributeWant,
): Promise<AttributeCriterion | null> {
  const key = normalizeSpecies(species);
  const parsed = await getParsedGenesCached(key);
  const attributeLower = attribute.toLowerCase();
  const loci: { geneId: string; allow: AllowedStates }[] = [];
  for (const [geneId, record] of Object.entries(parsed)) {
    for (const [attr, allele] of goodAlleles(record)) {
      if (attr === attributeLower) loci.push({ geneId, allow: allowForWant(allele, want) });
    }
  }
  if (loci.length === 0) return null;
  loci.sort((a, b) => a.geneId.localeCompare(b.geneId));
  return { kind: 'attribute', attribute, want, loci, min: 1 };
}
