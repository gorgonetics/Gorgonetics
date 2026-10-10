/**
 * Partners for one anchor animal, ranked by how likely a foal is to beat it
 * on chosen attributes while keeping the rest. The arithmetic is in
 * `utils/targetedBreeding`; this layer picks the partners and loads the
 * genomes, gene table and effect sizes it needs.
 */
import { Gender, type Pet } from '$lib/types/index.js';
import { type AttributeMagnitudes, EMPTY_MAGNITUDES } from '$lib/utils/attributePoints.js';
import { loadAllPetLoci, type PetLoci } from '$lib/utils/petLoci.js';
import { capitalize } from '$lib/utils/string.js';
import {
  bridgeOutlook,
  expectedFoals,
  idealMiddle,
  idealPartner,
  type KeepRule,
  keepRules,
  type PartnerNeed,
  type PartnerOutlook,
  partnerOutlook,
  type SlotAttributes,
  type Wanted,
  wantedFrom,
} from '$lib/utils/targetedBreeding.js';
import { magnitudesForBreed } from './breedingService.js';
import { getAllAttributeNames, normalizeSpecies } from './configService.js';
import { getParsedGenesCached, isHorseBreedFiltered } from './geneService.js';

export interface PartnerResult {
  partner: Pet;
  /**
   * The partner is another breed. The outlook assumes the foal is the
   * anchor's breed — its base and breed-locked loci — and which breed a
   * cross produces is not modelled.
   */
  crossBreed: boolean;
  outlook: PartnerOutlook;
}

export interface TargetedPlan {
  /** Best first. */
  partners: PartnerResult[];
  /** What a partner would need to carry, locus by locus. */
  needs: Array<PartnerNeed & { matching: number }>;
}

export interface RankPartnersOptions {
  anchor: Pet;
  /** Every pet; partners are chosen from it. */
  pets: readonly Pet[];
  /** Capitalised attribute names. */
  targets: readonly string[];
  tolerance: number;
  magnitudes?: AttributeMagnitudes;
}

/**
 * Animals the anchor can actually be bred to: stabled, the same species,
 * the opposite gender.
 */
export function eligiblePartners(anchor: Pet, pets: readonly Pet[]): Pet[] {
  const species = normalizeSpecies(anchor.species);
  return pets.filter(
    (p) => p.id !== anchor.id && p.stabled && p.gender !== anchor.gender && normalizeSpecies(p.species) === species,
  );
}

/** Best first: success, then the targets alone, then the expected target gain. */
function compare(a: { outlook: PartnerOutlook }, b: { outlook: PartnerOutlook }, targets: readonly string[]): number {
  const gain = (r: { outlook: PartnerOutlook }) => targets.reduce((sum, t) => sum + (r.outlook.expected[t] ?? 0), 0);
  return b.outlook.pSuccess - a.outlook.pSuccess || b.outlook.pTargets - a.outlook.pTargets || gain(b) - gain(a);
}

/** Everything a ranking needs about the anchor's species, loaded once. */
async function prepare(anchor: Pet, others: readonly Pet[], magnitudes: AttributeMagnitudes | undefined) {
  const species = normalizeSpecies(anchor.species);
  const [lociById, parsedGenes, scoped] = await Promise.all([
    loadAllPetLoci([anchor.id, ...others.map((p) => p.id)]),
    getParsedGenesCached(species),
    magnitudesForBreed(magnitudes ?? EMPTY_MAGNITUDES, species, anchor.breed),
  ]);
  // The foal is taken to be the anchor's breed, so loci locked to any other
  // breed say nothing about it.
  const genes: Record<string, SlotAttributes> = {};
  for (const [gene, gd] of Object.entries(parsedGenes)) {
    if (!isHorseBreedFiltered(species, anchor.breed, gd.breed)) genes[gene] = gd;
  }
  const empty: PetLoci = new Map();
  return {
    species,
    genes,
    magnitudes: scoped,
    attributes: getAllAttributeNames(species).map(capitalize),
    lociOf: (pet: Pet) => lociById.get(pet.id) ?? empty,
    /** Another breed than the anchor's: the foal may come out that breed instead. */
    otherBreed: (pet: Pet) => species === 'horse' && !!pet.breed && !!anchor.breed && pet.breed !== anchor.breed,
  };
}

export async function rankPartners(opts: RankPartnersOptions): Promise<TargetedPlan> {
  const { anchor, targets, tolerance } = opts;
  if (targets.length === 0) return { partners: [], needs: [] };
  const partners = eligiblePartners(anchor, opts.pets);
  const { genes, magnitudes, attributes, lociOf, otherBreed } = await prepare(anchor, partners, opts.magnitudes);
  const anchorLoci = lociOf(anchor);

  const ranked = partners
    .map((partner) => ({
      partner,
      crossBreed: otherBreed(partner),
      outlook: partnerOutlook(anchorLoci, lociOf(partner), genes, magnitudes, { attributes, targets, tolerance }),
    }))
    .sort((a, b) => compare(a, b, targets));
  // How many partners already carry the wanted genotype: a need nobody
  // meets is a need the stable cannot fill this round.
  const needs = idealPartner(anchorLoci, genes, magnitudes, { attributes, targets }).map((need) => ({
    ...need,
    matching: partners.filter((p) => lociOf(p).get(need.gene) === need.best).length,
  }));
  return { partners: ranked, needs };
}

export interface BridgeResult {
  sire: Pet;
  dam: Pet;
  /** Either grandparent is another breed than the anchor's. */
  crossBreed: boolean;
  /** The anchor's foal by a kept middle foal of the gender the anchor needs. */
  outlook: PartnerOutlook;
  /** What to keep the middle foal for; empty when any foal will do. */
  keep: KeepRule[];
  /** Share of the pair's foals meeting `keep`, gender aside. */
  pQualify: number;
  /** Foals bred, on average, until one beats the anchor: see `expectedFoals`. */
  foals: number;
}

/**
 * Two-step routes: breed a stabled pair, then breed their foal to the anchor.
 *
 * This is how an allele that only animals of the anchor's own gender carry
 * reaches it: through a foal of the other gender. Every stabled male ×
 * female pair of the species is a route, the anchor included — breeding the
 * anchor to a mare and its daughter back to it is one.
 */
export async function rankBridges(
  opts: RankPartnersOptions & {
    limit?: number;
    /**
     * Only routes that bring in this gene: pairs that can give a middle foal
     * the genotype the targets want there, with that foal always kept for it.
     */
    focus?: string;
  },
): Promise<BridgeResult[]> {
  const { anchor, targets, tolerance } = opts;
  if (targets.length === 0) return [];
  const species = normalizeSpecies(anchor.species);
  const stable = opts.pets.filter((p) => p.stabled && normalizeSpecies(p.species) === species);
  const sires = stable.filter((p) => p.gender === Gender.MALE);
  const dams = stable.filter((p) => p.gender === Gender.FEMALE);
  if (sires.length === 0 || dams.length === 0) return [];
  const { genes, magnitudes, attributes, lociOf, otherBreed } = await prepare(anchor, stable, opts.magnitudes);
  const anchorLoci = lociOf(anchor);
  const needs = idealPartner(anchorLoci, genes, magnitudes, { attributes, targets });
  const gains = wantedFrom(needs);
  const focus = opts.focus === undefined ? undefined : gains.get(opts.focus);
  if (opts.focus !== undefined && !focus) return [];

  const started = performance.now();
  const limit = opts.limit ?? 10;
  const options = { attributes, targets, tolerance };

  // Every pair, three ways to pick the middle foal: any foal, one carrying
  // the gains, or the best the pair can give at every locus that matters.
  // Stricter means fewer foals qualify but more of the anchor's foals by it
  // succeed. Each is screened on a cheap bound first.
  interface Candidate {
    sire: Pet;
    dam: Pet;
    wanted: Wanted;
    /** Fewest foals this candidate could need: success at its bound. */
    floor: number;
    pTargets: number;
  }
  const candidates: Candidate[] = [];
  for (const sire of sires) {
    for (const dam of dams) {
      const seen = new Set<string>();
      for (const policy of [new Map(), gains, idealMiddle(lociOf(sire), lociOf(dam), needs)] as Wanted[]) {
        // A focused route always keeps the middle foal for the focus gene.
        const wanted = focus ? new Map([...policy, [opts.focus as string, focus]]) : policy;
        const rules = keepRules(lociOf(sire), lociOf(dam), wanted);
        // A pair that cannot give the focus gene is no route for it.
        if (focus && !rules.some((k) => k.gene === opts.focus)) break;
        // Two policies setting the same rules for this pair are one route.
        const key = rules.map((k) => `${k.gene}:${k.allowed.join('')}`).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const screen = bridgeOutlook(
          anchorLoci,
          lociOf(sire),
          lociOf(dam),
          genes,
          magnitudes,
          { ...options, joint: false },
          wanted,
        );
        candidates.push({
          sire,
          dam,
          wanted,
          floor: expectedFoals(screen.outlook.pSuccessBound, screen.pQualify),
          pTargets: screen.outlook.pTargets,
        });
      }
    }
  }

  // Exact scoring, most promising first, until no candidate left could beat
  // the routes already found. The answer is the same as scoring them all.
  candidates.sort((a, b) => a.floor - b.floor || b.pTargets - a.pTargets);
  const bestByPair = new Map<string, BridgeResult>();
  const cutoff = () => {
    const foals = [...bestByPair.values()].map((r) => r.foals).sort((a, b) => a - b);
    return foals.length >= limit ? foals[limit - 1] : Number.POSITIVE_INFINITY;
  };
  let scored = 0;
  for (const c of candidates) {
    const bar = cutoff();
    if (c.floor > bar || (c.floor === bar && !Number.isFinite(bar))) break;
    scored++;
    const route = bridgeOutlook(anchorLoci, lociOf(c.sire), lociOf(c.dam), genes, magnitudes, options, c.wanted);
    const foals = expectedFoals(route.outlook.pSuccess, route.pQualify);
    const pair = `${c.sire.id}:${c.dam.id}`;
    const held = bestByPair.get(pair);
    if (!held || foals < held.foals || (foals === held.foals && route.outlook.pSuccess > held.outlook.pSuccess)) {
      bestByPair.set(pair, {
        sire: c.sire,
        dam: c.dam,
        crossBreed: otherBreed(c.sire) || otherBreed(c.dam),
        ...route,
        foals,
      });
    }
  }
  // Logged on every run, as the study does: only a measurement in the
  // packaged app says whether this is fast enough there.
  console.info(
    `routes ${anchor.name}${opts.focus ? ` via ${opts.focus}` : ''}: ${candidates.length} screened, ${scored} scored, ${Math.round(performance.now() - started)} ms`,
  );
  return [...bestByPair.values()].sort((a, b) => a.foals - b.foals || compare(a, b, targets)).slice(0, limit);
}
