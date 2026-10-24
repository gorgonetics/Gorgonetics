<script lang="ts">
/**
 * Capture: capture or let go the wild animal just analysed (#367).
 *
 * A capture starts a cooldown, so the view answers one question for the
 * latest wild import only, with every reason behind the answer. With
 * auto-import on it follows the game: each new wild file replaces the animal
 * shown. The sex is read in the game; until it is set here, the advice is
 * shown for both, since a recessive allele is needed only by the sex that
 * lacks it.
 */
import EmptyState from '#lib/components/shared/EmptyState.svelte';
import PageHeader from '#lib/components/shared/PageHeader.svelte';
import PetActions from '#lib/components/shared/PetActions.svelte';
import { assessWildPet } from '#lib/services/captureService.js';
import { captureView } from '#lib/stores/capture.svelte.js';
import { myPetsView, requestOpenPet } from '#lib/stores/mypets.svelte.js';
import { appState, pets } from '#lib/stores/pets.js';
import { settings } from '#lib/stores/settings.js';
import { Gender, GeneType } from '#lib/types/index.js';
import { type CaptureAdvice, type CaptureReason, groupByAllele, type HuntAllele } from '#lib/utils/captureAdvice.js';
import { parseBreedLockWeight } from '#lib/utils/geneticQuality.js';
import { keyedResource } from '#lib/utils/keyedResource.svelte.js';
import { benefitText } from '#lib/utils/qualityLens.js';

const wildPets = $derived($pets.filter((p) => p.wild).sort((a, b) => b.created_at.localeCompare(a.created_at)));
const wild = $derived(wildPets[0] ?? null);
const sex = $derived(wild ? (captureView.sexOf[wild.id] ?? null) : null);

const focusBreed = $derived(String($settings['quality.focusBreed'] ?? ''));
const breedLockWeight = $derived(parseBreedLockWeight($settings['quality.breedLockWeight']));
const stableIds = $derived(
  $pets
    .filter((p) => p.stabled)
    .map((p) => p.id)
    .join(','),
);
const assessment = keyedResource(
  () => (wild ? `${wild.id}|${focusBreed}|${breedLockWeight ?? 'auto'}|${stableIds}` : null),
  () => assessWildPet({ wild: wild as NonNullable<typeof wild>, pets: $pets, focusBreed, breedLockWeight }),
);

/** Breed-generic alleles first: they serve every breed you might target. */
const genericFirst = (alleles: HuntAllele[]) => [
  ...alleles.filter((a) => a.generic),
  ...alleles.filter((a) => !a.generic),
];
const huntList = $derived(assessment.value ? genericFirst(groupByAllele(assessment.value.targets)) : []);
/** Chips shown before "show all", per verdict. */
const CHIP_LIMIT = 12;
let expanded = $state<Record<string, boolean>>({});

const shown = $derived.by((): { sex: Gender; advice: CaptureAdvice }[] => {
  const value = assessment.value;
  if (!value) return [];
  const sexes = sex ? [sex] : [Gender.MALE, Gender.FEMALE];
  return sexes.map((s) => ({ sex: s, advice: value.advice[s] }));
});

function setSex(next: Gender): void {
  if (!wild) return;
  captureView.sexOf = { ...captureView.sexOf, [wild.id]: next };
  if (wild.gender !== next) void appState.updatePet(wild.id, { gender: next });
}

function openGenome(): void {
  if (!wild) return;
  requestOpenPet(wild.id);
  appState.switchTab('mypets');
}

function showOlder(): void {
  myPetsView.wildOnly = true;
  appState.switchTab('mypets');
}

const alleleText = (allele: string) => (allele === GeneType.DOMINANT ? 'D' : 'R');
const targetText = (a: HuntAllele) => `${a.geneId} ${alleleText(a.allele)} · ${a.targets.map(benefitText).join(' · ')}`;
const sexWord = (s: Gender) => (s === Gender.MALE ? 'male' : 'female');
const sexesText = (a: HuntAllele) => (a.sexes.length === 2 ? 'either sex' : `a ${sexWord(a.sexes[0])}`);
const pct = (share: number) => `${share.toFixed(1)}%`;

function reasonTitle(r: CaptureReason): string {
  switch (r.kind) {
    case 'needed': {
      const n = groupByAllele(r.targets).length;
      return `Brings ${n} benefit allele${n === 1 ? '' : 's'} your stable cannot breed`;
    }
    case 'never-seen':
      return `Carries ${r.alleles.length} allele${r.alleles.length === 1 ? '' : 's'} none of your stabled horses has`;
    case 'beats-weakest':
      return `Quality ${pct(r.share)} as stabled: above your weakest, ${r.weakest.name} (${pct(r.weakest.share)}), which it could replace`;
    case 'below-weakest':
      return `Quality ${pct(r.share)} as stabled: not above your weakest, ${r.weakest.name} (${pct(r.weakest.share)})`;
  }
}
</script>

<div class="capture-view" data-testid="capture-view">
  <h2 class="sr-only">Capture</h2>
  <PageHeader subtitle="Capture or let go the wild horse you just analysed. Each capture starts a cooldown, so only capture what your stable needs." />

  <div class="cv-body">
    {#if !wild}
      <EmptyState
        icon="🌿"
        title="No wild horse imported yet"
        body="Save a wild horse's genes in the game and import the file. With auto-import on, it appears here as soon as the game writes it."
      />
    {:else}
      <section class="cv-card" data-testid="capture-wild">
        <div class="cv-who">
          <div>
            <div class="cv-name">{wild.name}</div>
            <div class="cv-meta">{wild.breed || 'Breed unknown'} · {wild.species}</div>
          </div>
          <div class="seg" role="group" aria-label="Sex as seen in the game" data-testid="capture-sex">
            {#each [Gender.MALE, Gender.FEMALE] as s (s)}
              <button
                type="button"
                class="seg-btn"
                class:active={sex === s}
                aria-pressed={sex === s}
                onclick={() => setSex(s)}
              >{s}</button>
            {/each}
          </div>
        </div>

        {#if assessment.error}
          <p class="cv-error" role="alert">Could not assess this horse: {assessment.error}</p>
        {:else if !assessment.value}
          <p class="cv-muted">Reading the horse against your stable…</p>
        {:else}
          {#if !sex}
            <p class="cv-muted">Set its sex to see one answer. A recessive allele is needed only by the sex that lacks it.</p>
          {/if}
          <div class="cv-verdicts">
            {#each shown as { sex: s, advice } (s)}
              <div class="cv-verdict" class:capture={advice.capture} data-testid="capture-verdict" data-sex={s}>
                <div class="cv-answer">
                  {#if !sex}<span class="cv-as">As a {sexWord(s)}:</span>{/if}
                  <strong>{advice.capture ? 'Capture' : 'Let go'}</strong>
                </div>
                {#if advice.reasons.length === 0}
                  <p class="cv-reason">Nothing your stable lacks, and too few stabled horses to compare Quality.</p>
                {/if}
                <ul class="cv-reasons">
                  {#each advice.reasons as reason (reason.kind)}
                    <li data-testid="capture-reason" data-kind={reason.kind}>
                      <span class="cv-reason">{reasonTitle(reason)}</span>
                      {#if reason.kind === 'needed'}
                        {@const alleles = genericFirst(groupByAllele(reason.targets))}
                        {@const open = expanded[s] ?? false}
                        <span class="cv-chips">
                          {#each open ? alleles : alleles.slice(0, CHIP_LIMIT) as t (`${t.geneId}${t.allele}`)}
                            <span class="cv-chip" class:generic={t.generic}>{targetText(t)}</span>
                          {/each}
                          {#if alleles.length > CHIP_LIMIT}
                            <button type="button" class="cv-more" onclick={() => { expanded = { ...expanded, [s]: !open }; }}>
                              {open ? 'Show fewer' : `Show all ${alleles.length}`}
                            </button>
                          {/if}
                        </span>
                      {:else if reason.kind === 'never-seen'}
                        <span class="cv-chips">
                          {#each reason.alleles as a (`${a.geneId}${a.allele}`)}
                            <span class="cv-chip">{a.geneId} {alleleText(a.allele)}</span>
                          {/each}
                        </span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          </div>
          <p class="cv-muted">
            Highlighted alleles are breed-generic. Read against your {assessment.value.stableSize} stabled {wild.species.toLowerCase()}{assessment.value.stableSize === 1 ? '' : 's'}{focusBreed ? `, hunting for ${focusBreed}` : ''}.
            After a capture, import its gene file: this entry becomes the stabled horse.
          </p>
        {/if}

        <div class="cv-actions">
          <button type="button" class="btn btn-secondary" data-testid="capture-open" onclick={openGenome}>Open genome</button>
          <PetActions pet={wild} variant="button" />
          {#if wildPets.length > 1}
            <button type="button" class="btn btn-secondary" data-testid="capture-older" onclick={showOlder}>{wildPets.length - 1} earlier wild {wildPets.length === 2 ? 'entry' : 'entries'}</button>
          {/if}
        </div>
      </section>

      {#if assessment.value}
        <details class="cv-hunt" data-testid="capture-hunt">
          <summary>
            What to look for: {huntList.length} benefit allele{huntList.length === 1 ? '' : 's'} your stable cannot breed
          </summary>
          {#if huntList.length === 0}
            <p class="cv-muted">Your stable carries every benefit allele{focusBreed ? ` for ${focusBreed}` : ''}.</p>
          {:else}
            <ul class="cv-hunt-list">
              {#each huntList as t (`${t.geneId}${t.allele}`)}
                <li><span class="cv-chip" class:generic={t.generic}>{targetText(t)}</span> <span class="cv-muted">from {sexesText(t)}</span></li>
              {/each}
            </ul>
          {/if}
        </details>
      {/if}
    {/if}
  </div>
</div>

<style>
  .capture-view { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .cv-body { flex: 1; min-height: 0; overflow: auto; padding: var(--space-sm) var(--space-2xl) var(--space-xl); display: flex; flex-direction: column; gap: var(--space-md); }
  .cv-card { border: 1px solid var(--border-primary); border-radius: var(--radius-sm); padding: var(--space-md); display: flex; flex-direction: column; gap: var(--space-sm); background: var(--bg-primary); }
  .cv-who { display: flex; justify-content: space-between; align-items: center; gap: var(--space-md); }
  .cv-name { font-weight: 600; font-size: 15px; }
  .cv-meta, .cv-muted { font-size: 12px; color: var(--text-tertiary); margin: 0; }
  .cv-error { font-size: 12px; color: var(--error-text, var(--text-primary)); margin: 0; }
  .cv-verdicts { display: flex; gap: var(--space-md); flex-wrap: wrap; }
  .cv-verdict { flex: 1 1 280px; border: 1px solid var(--border-primary); border-left-width: 4px; border-radius: var(--radius-sm); padding: var(--space-sm) var(--space-md); }
  .cv-verdict.capture { border-left-color: var(--accent); }
  .cv-answer { font-size: 16px; margin-bottom: var(--space-xs); }
  .cv-as { font-size: 12px; color: var(--text-secondary); margin-right: var(--space-xs); }
  .cv-reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-xs); }
  .cv-reason { font-size: 13px; color: var(--text-secondary); }
  .cv-chips { display: flex; flex-wrap: wrap; gap: var(--space-2xs); margin-top: var(--space-2xs); }
  .cv-chip { font-size: 11px; font-variant-numeric: tabular-nums; border: 1px solid var(--border-primary); border-radius: var(--radius-sm); padding: 0 var(--space-xs); color: var(--text-primary); white-space: nowrap; }
  .cv-chip.generic { border-color: var(--accent); }
  .cv-more { background: none; border: none; padding: 0; font: inherit; font-size: 11px; color: var(--accent-text, var(--accent)); cursor: pointer; }
  .cv-actions { display: flex; gap: var(--space-sm); align-items: center; flex-wrap: wrap; }
  .cv-hunt summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text-secondary); }
  .cv-hunt-list { list-style: none; padding: 0; margin: var(--space-sm) 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-2xs) var(--space-md); font-size: 12px; }
</style>
