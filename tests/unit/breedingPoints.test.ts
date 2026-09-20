import { beforeEach, describe, expect, it } from 'vitest';
import { magnitudesForBreed, rankBreedingPairs } from '$lib/services/breedingService.js';
import { closeDatabase, initDatabase } from '$lib/services/database.js';
import * as geneService from '$lib/services/geneService.js';
import { runMigrations } from '$lib/services/migrationService.js';
import * as petService from '$lib/services/petService.js';
import { Gender, type Pet } from '$lib/types/index.js';
import { type AttributeMagnitudes, buildAttributeMagnitudes, coverageOf } from '$lib/utils/attributePoints.js';
import type { AttributeStudy, Expression, StudyFinding } from '$lib/utils/attributeStudy.js';
import { expectedImprovement } from '$lib/utils/breedingGenetics.js';
import { attributeObjective } from '$lib/utils/breedingObjectives.js';

/** One chromosome, one locus per allele — the body the other breeding tests use. */
function genomeOf(species: string, name: string, alleles: string) {
  return `[Overview]
Format=1.0
Character=Tester
Entity=${name}
Genome=${species}

[Genes]
1=${alleles}
`;
}

async function uploadParent(species: string, name: string, gender: Gender, alleles: string): Promise<Pet> {
  const result = await petService.uploadPet(genomeOf(species, name, alleles), { name, gender });
  expect(result.status).toBe('success');
  const pet = await petService.getPet(result.pet_id!);
  return pet as Pet;
}

const uploadBeewasp = (name: string, gender: Gender, alleles: string) => uploadParent('BeeWasp', name, gender, alleles);
const uploadHorse = (name: string, gender: Gender, alleles: string) => uploadParent('Horse', name, gender, alleles);

async function reset() {
  await closeDatabase();
  await initDatabase();
  await runMigrations();
  geneService.clearGeneEffectsCache();
}

function finding(gene: string, expression: Expression, attribute: string, magnitude: number): StudyFinding {
  return { gene, expression, attribute, magnitude, tier: 'direct', depth: 0, support: 4, dissent: 0, witnesses: [] };
}

/** A study run with the given findings, each attribute's slot count stated. */
function magnitudesOf(
  entries: Array<{ attribute: string; slots: number; findings: StudyFinding[] }>,
): AttributeMagnitudes {
  return buildAttributeMagnitudes(
    entries.map(
      (entry): AttributeStudy => ({
        attribute: entry.attribute,
        slots: entry.slots,
        findings: entry.findings,
        contradictions: [],
        geneDoubts: [],
        validation: { tested: 0, exact: 0, stabledTested: 0, stabledExact: 0 },
        contributors: 2,
      }),
    ),
  );
}

describe('rankBreedingPairs — attribute points', () => {
  beforeEach(reset);

  it('leaves the result in counts when no magnitudes are supplied', async () => {
    await geneService.upsertGene('beewasp', '01', '01A1', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    geneService.clearGeneEffectsCache('beewasp');
    const male = await uploadBeewasp('M', Gender.MALE, 'DRR');
    const female = await uploadBeewasp('F', Gender.FEMALE, 'DRR');

    const [pair] = await rankBreedingPairs({ species: 'BeeWasp', pets: [male, female] });

    expect(pair.evPositiveByAttribute.Toughness).toBeCloseTo(1, 10);
    expect(pair.evPointsByAttribute).toBeUndefined();
    expect(pair.evAttributePointImprovement).toBeUndefined();
    expect(pair.maleProfile.pointsByAttribute).toBeUndefined();
  });

  it('scores each attribute in points, both signs, skipping unmeasured slots', async () => {
    //   01A1: dominant=Toughness+     measured at +4
    //   01A2: dominant=Intelligence-  measured at -3
    //   01A3: recessive=Friendliness+ never measured
    await geneService.upsertGene('beewasp', '01', '01A1', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    await geneService.upsertGene('beewasp', '01', '01A2', { effectDominant: 'Intelligence-', effectRecessive: 'None' });
    await geneService.upsertGene('beewasp', '01', '01A3', { effectDominant: 'None', effectRecessive: 'Friendliness+' });
    geneService.clearGeneEffectsCache('beewasp');

    const male = await uploadBeewasp('M', Gender.MALE, 'DxR');
    const female = await uploadBeewasp('F', Gender.FEMALE, 'xRx');

    const magnitudes = magnitudesOf([
      { attribute: 'toughness', slots: 2, findings: [finding('01A1', 'dominant', 'toughness', 4)] },
      { attribute: 'intelligence', slots: 2, findings: [finding('01A2', 'dominant', 'intelligence', -3)] },
      { attribute: 'friendliness', slots: 1, findings: [] },
    ]);
    const [pair] = await rankBreedingPairs({ species: 'BeeWasp', pets: [male, female], magnitudes });

    // 01A1: D × x → P(D∨x) = 1 → 4 points.
    expect(pair.evPointsByAttribute?.Toughness).toBeCloseTo(4, 10);
    // 01A2: x × R → P(D∨x) = 0.5, and the effect is negative: the count
    // column cannot express this at all, which is the reason points exist.
    expect(pair.evPositiveByAttribute.Intelligence).toBe(0);
    expect(pair.evPointsByAttribute?.Intelligence).toBeCloseTo(-1.5, 10);
    // 01A3 is a real positive the study has not measured. It keeps its count
    // and scores no points — not an imputed average.
    expect(pair.evPositiveByAttribute.Friendliness).toBeCloseTo(0.5, 10);
    expect(pair.evPointsByAttribute?.Friendliness).toBeUndefined();
    expect(pair.evAttributePointImprovement?.Friendliness).toBeUndefined();
  });

  it('measures improvement against the better parent in the same unit', async () => {
    await geneService.upsertGene('beewasp', '01', '01A1', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    geneService.clearGeneEffectsCache('beewasp');
    const male = await uploadBeewasp('M', Gender.MALE, 'DRR');
    const female = await uploadBeewasp('F', Gender.FEMALE, 'RRR');

    const magnitudes = magnitudesOf([
      { attribute: 'toughness', slots: 1, findings: [finding('01A1', 'dominant', 'toughness', 4)] },
    ]);
    const [pair] = await rankBreedingPairs({ species: 'BeeWasp', pets: [male, female], magnitudes });

    // The sire expresses the effect and the dam does not, so the baseline is
    // 4 points; every foal of the pair is `x` there and expresses the same 4.
    expect(pair.maleProfile.pointsByAttribute?.Toughness).toBeCloseTo(4, 10);
    expect(pair.femaleProfile.pointsByAttribute?.Toughness ?? 0).toBe(0);
    expect(pair.evPointsByAttribute?.Toughness).toBeCloseTo(4, 10);
    expect(pair.evAttributePointImprovement?.Toughness).toBeCloseTo(0, 10);
  });

  it('credits an unrevealed locus with nothing', async () => {
    await geneService.upsertGene('beewasp', '01', '01A1', { effectDominant: 'Toughness+', effectRecessive: 'None' });
    geneService.clearGeneEffectsCache('beewasp');
    const male = await uploadBeewasp('M', Gender.MALE, '?RR');
    const female = await uploadBeewasp('F', Gender.FEMALE, 'DRR');

    const magnitudes = magnitudesOf([
      { attribute: 'toughness', slots: 1, findings: [finding('01A1', 'dominant', 'toughness', 4)] },
    ]);
    const [pair] = await rankBreedingPairs({ species: 'BeeWasp', pets: [male, female], magnitudes });

    // `?` is "not revealed", not "recessive": the sire must not be credited
    // with the dominant slot's magnitude for a locus nobody has read.
    expect(pair.maleProfile.pointsByAttribute?.Toughness ?? 0).toBe(0);
    expect(pair.femaleProfile.pointsByAttribute?.Toughness).toBeCloseTo(4, 10);
  });

  it('ranks one large effect above several small ones — which counting cannot', async () => {
    // Recessive positives, so the foal can express what neither parent does:
    // a dominant-positive either parent carried would already be expressed by
    // that parent, and an improvement over it is unreachable by breeding.
    await geneService.upsertGene('beewasp', '01', '01A1', { effectDominant: 'None', effectRecessive: 'Toughness+' });
    await geneService.upsertGene('beewasp', '01', '01A2', { effectDominant: 'None', effectRecessive: 'Toughness+' });
    await geneService.upsertGene('beewasp', '01', '01A3', { effectDominant: 'None', effectRecessive: 'Toughness+' });
    geneService.clearGeneEffectsCache('beewasp');

    // One line carries the single +5 locus, the other the two +1 loci, both
    // as carriers. Counting says the second is the better pairing, two
    // expected positives to one.
    const bigSire = await uploadBeewasp('BigM', Gender.MALE, 'xDD');
    const bigDam = await uploadBeewasp('BigF', Gender.FEMALE, 'xDD');
    const smallSire = await uploadBeewasp('SmallM', Gender.MALE, 'Dxx');
    const smallDam = await uploadBeewasp('SmallF', Gender.FEMALE, 'Dxx');

    const magnitudes = magnitudesOf([
      {
        attribute: 'toughness',
        slots: 3,
        findings: [
          finding('01A1', 'recessive', 'toughness', 5),
          finding('01A2', 'recessive', 'toughness', 1),
          finding('01A3', 'recessive', 'toughness', 1),
        ],
      },
    ]);
    const pets = [bigSire, smallSire, bigDam, smallDam];
    const ranked = await rankBreedingPairs({ species: 'BeeWasp', pets, magnitudes });
    const big = ranked.find((p) => p.male.name === 'BigM' && p.female.name === 'BigF');
    const small = ranked.find((p) => p.male.name === 'SmallM' && p.female.name === 'SmallF');
    if (!big || !small) throw new Error('expected both same-line pairs in the ranking');

    // x × x → P(R) = 0.25 at each carried locus.
    expect(big.evPositiveByAttribute.Toughness).toBeCloseTo(0.25, 10);
    expect(small.evPositiveByAttribute.Toughness).toBeCloseTo(0.5, 10);
    expect(big.evPointsByAttribute?.Toughness).toBeCloseTo(1.25, 10);
    expect(small.evPointsByAttribute?.Toughness).toBeCloseTo(0.5, 10);

    // The objective follows the points, so the table and the planner agree.
    const objective = attributeObjective('Toughness');
    expect(objective.score(big)).toBeGreaterThan(objective.score(small));

    // Without a study behind it, the same objective ranks them the other way
    // round — the count is the best answer available, not a wrong one.
    const counted = await rankBreedingPairs({ species: 'BeeWasp', pets });
    const bigCounted = counted.find((p) => p.male.name === 'BigM' && p.female.name === 'BigF');
    const smallCounted = counted.find((p) => p.male.name === 'SmallM' && p.female.name === 'SmallF');
    if (!bigCounted || !smallCounted) throw new Error('expected both same-line pairs in the ranking');
    expect(objective.score(smallCounted)).toBeGreaterThan(objective.score(bigCounted));
  });

  it('treats one locus’s two slots as mutually exclusive, not independent', async () => {
    // Both slots on the same attribute, pointing opposite ways — the shape
    // the shipped horse table has on 01A4, 01C3 and 01E2. The foal takes one
    // slot or the other, never both, so the two Bernoullis are disjoint and
    // the variance carries a cross term.
    await geneService.upsertGene('beewasp', '01', '01A1', {
      effectDominant: 'Toughness-',
      effectRecessive: 'Toughness+',
    });
    geneService.clearGeneEffectsCache('beewasp');
    const male = await uploadBeewasp('M', Gender.MALE, 'xDD');
    const female = await uploadBeewasp('F', Gender.FEMALE, 'xDD');

    const magnitudes = magnitudesOf([
      {
        attribute: 'toughness',
        slots: 2,
        findings: [finding('01A1', 'dominant', 'toughness', -2), finding('01A1', 'recessive', 'toughness', 4)],
      },
    ]);
    const [pair] = await rankBreedingPairs({ species: 'BeeWasp', pets: [male, female], magnitudes });

    // x × x → P(D∨x) = 0.75, P(R) = 0.25. X is −2 or +4, so E[X] = −0.5 and
    // Var(X) = E[X²] − E[X]² = (4·0.75 + 16·0.25) − 0.25 = 6.75. Summing each
    // slot's own m²p(1−p) gives 3.75 and misses −2·m_d·m_r·p_d·p_r, which is
    // *positive* here because the two slots disagree in sign — so the naive
    // figure understates the spread rather than overstating it.
    expect(pair.evPointsByAttribute?.Toughness).toBeCloseTo(-0.5, 10);
    // Both parents are `x`, which expresses the dominant slot.
    expect(pair.maleProfile.pointsByAttribute?.Toughness).toBeCloseTo(-2, 10);

    const improvement = pair.evAttributePointImprovement?.Toughness;
    expect(improvement).toBeCloseTo(expectedImprovement(-0.5, Math.sqrt(6.75), -2), 10);
    // The mean is identical either way, which is exactly why this hides: only
    // the improvement integral, which reads the spread, can tell them apart.
    expect(improvement).not.toBeCloseTo(expectedImprovement(-0.5, Math.sqrt(3.75), -2), 6);
  });

  it('leaves slots on different attributes uncorrected, where the plain variance is exact', async () => {
    // Same locus, two slots, but on two attributes. Each attribute's variance
    // then sees a single indicator and needs no cross term — a correction
    // applied here would be as wrong as its absence is above.
    await geneService.upsertGene('beewasp', '01', '01A1', {
      effectDominant: 'Toughness-',
      effectRecessive: 'Intelligence+',
    });
    geneService.clearGeneEffectsCache('beewasp');
    const male = await uploadBeewasp('M', Gender.MALE, 'xDD');
    const female = await uploadBeewasp('F', Gender.FEMALE, 'xDD');

    const magnitudes = magnitudesOf([
      { attribute: 'toughness', slots: 1, findings: [finding('01A1', 'dominant', 'toughness', -2)] },
      { attribute: 'intelligence', slots: 1, findings: [finding('01A1', 'recessive', 'intelligence', 4)] },
    ]);
    const [pair] = await rankBreedingPairs({ species: 'BeeWasp', pets: [male, female], magnitudes });

    // Toughness: −2 with p = 0.75 → mean −1.5, var 4·0.75·0.25 = 0.75.
    expect(pair.evPointsByAttribute?.Toughness).toBeCloseTo(-1.5, 10);
    expect(pair.evAttributePointImprovement?.Toughness).toBeCloseTo(expectedImprovement(-1.5, Math.sqrt(0.75), -2), 10);
    // Intelligence: +4 with p = 0.25 → mean 1, var 16·0.25·0.75 = 3.
    expect(pair.evPointsByAttribute?.Intelligence).toBeCloseTo(1, 10);
    expect(pair.evAttributePointImprovement?.Intelligence).toBeCloseTo(expectedImprovement(1, Math.sqrt(3), 0), 10);
  });
});

describe('rankBreedingPairs — points coverage follows the committed breed', () => {
  beforeEach(reset);

  /** Four horse loci on chromosome 01; `01A4` is Kurbone-only. */
  async function seedHorseGenes() {
    await geneService.upsertGene('horse', '01', '01A1', { effectDominant: 'Temperament+', breed: '' });
    await geneService.upsertGene('horse', '01', '01A4', { effectDominant: 'Toughness+', breed: 'Kurbone' });
    geneService.clearGeneEffectsCache('horse');
  }

  it('drops a points column whose only measured slots belong to another breed', async () => {
    await seedHorseGenes();
    const male = await uploadHorse('M', Gender.MALE, 'DRRD');
    const female = await uploadHorse('F', Gender.FEMALE, 'DRRD');
    const pets = [male, female];
    // The study solves every breed at once, so Toughness is "measured" —
    // on a locus only a Kurbone foal can inherit.
    const magnitudes = magnitudesOf([
      { attribute: 'toughness', slots: 1, findings: [finding('01A4', 'dominant', 'toughness', 4)] },
    ]);

    const [kurbone] = await rankBreedingPairs({ species: 'Horse', pets, magnitudes, offspringBreed: 'Kurbone' });
    expect(kurbone.evPointsByAttribute?.Toughness).toBeCloseTo(4, 10);

    // Committing to Paint filters that locus out of scoring. A points column
    // would then read zero for every pair while its header claimed the study
    // had measured it — strictly worse than the count column it displaced.
    const [paint] = await rankBreedingPairs({ species: 'Horse', pets, magnitudes, offspringBreed: 'Paint' });
    expect(paint.evPointsByAttribute?.Toughness).toBeUndefined();
    expect(paint.evAttributePointImprovement?.Toughness).toBeUndefined();
    // The count column is still there, which is the point of dropping it.
    expect(paint.evPositiveByAttribute.Toughness).toBe(0);
  });

  it('reports the coverage the ranking actually scored over, so the header cannot lie', async () => {
    await seedHorseGenes();
    const magnitudes = magnitudesOf([
      { attribute: 'toughness', slots: 1, findings: [finding('01A4', 'dominant', 'toughness', 4)] },
    ]);

    expect(coverageOf(await magnitudesForBreed(magnitudes, 'Horse', 'Kurbone'), 'Toughness')).toMatchObject({
      known: 1,
      total: 1,
    });
    expect(coverageOf(await magnitudesForBreed(magnitudes, 'Horse', 'Paint'), 'Toughness')).toMatchObject({
      known: 0,
      total: 0,
    });
  });

  it('is idempotent, so the ranking can scope defensively over an already-scoped table', async () => {
    await seedHorseGenes();
    const magnitudes = magnitudesOf([
      { attribute: 'toughness', slots: 1, findings: [finding('01A4', 'dominant', 'toughness', 4)] },
      { attribute: 'temperament', slots: 1, findings: [finding('01A1', 'dominant', 'temperament', 2)] },
    ]);

    const once = await magnitudesForBreed(magnitudes, 'Horse', 'Kurbone');
    const twice = await magnitudesForBreed(once, 'Horse', 'Kurbone');
    expect([...twice.points]).toEqual([...once.points]);
    expect([...twice.coverage]).toEqual([...once.coverage]);
  });
});
