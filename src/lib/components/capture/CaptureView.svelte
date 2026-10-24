<script lang="ts">
/**
 * Capture: capture or let go the wild animal just analysed (#367).
 *
 * A capture starts a cooldown and stable space is small, so the view answers
 * one question for the latest wild import only. Only a pinned hunt allele
 * suggests a capture: the player picks the attributes they breed for, pins
 * the alleles they want from the hunt list, and everything else the animal
 * brings is shown as information. With auto-import on it follows the game:
 * each new wild file replaces the animal shown. The sex is read in the game;
 * until it is set here, the advice is shown for both, since a recessive
 * allele is needed only by the sex that lacks it.
 */
import EmptyState from '#lib/components/shared/EmptyState.svelte';
import PageHeader from '#lib/components/shared/PageHeader.svelte';
import PetActions from '#lib/components/shared/PetActions.svelte';
import { assessWildPet } from '#lib/services/captureService.js';
import { getAllAttributeNames, normalizeSpecies } from '#lib/services/configService.js';
import { captureView } from '#lib/stores/capture.svelte.js';
import { myPetsView, requestOpenPet } from '#lib/stores/mypets.svelte.js';
import { appState, pets } from '#lib/stores/pets.js';
import { settings, settingsActions } from '#lib/stores/settings.js';
import { Gender, GeneType } from '#lib/types/index.js';
import {
  type CaptureAdvice,
  type CaptureInfo,
  groupByAllele,
  type HuntAllele,
  pinKey,
} from '#lib/utils/captureAdvice.js';
import { parseBreedLockWeight } from '#lib/utils/geneticQuality.js';
import { keyedResource } from '#lib/utils/keyedResource.svelte.js';
import { benefitText } from '#lib/utils/qualityLens.js';

const PINS_KEY = 'capture.pins';
const ATTRIBUTES_KEY = 'capture.attributes';

const wildPets = $derived($pets.filter((p) => p.wild).sort((a, b) => b.created_at.localeCompare(a.created_at)));
const wild = $derived(wildPets[0] ?? null);
const species = $derived(wild ? normalizeSpecies(wild.species) : '');
const sex = $derived(wild ? (captureView.sexOf[wild.id] ?? null) : null);

/** Pinned alleles per species, as `pinKey`s. */
const allPins = $derived(($settings[PINS_KEY] ?? {}) as Record<string, string[]>);
const pinList = $derived(allPins[species] ?? []);
const pins = $derived(new Set(pinList));
const wantedList = $derived(($settings[ATTRIBUTES_KEY] ?? []) as string[]);
const wanted = $derived(new Set(wantedList));
const attributeNames = $derived(species ? getAllAttributeNames(species) : []);

const focusBreed = $derived(String($settings['quality.focusBreed'] ?? ''));
const breedLockWeight = $derived(parseBreedLockWeight($settings['quality.breedLockWeight']));
const stableIds = $derived(
  $pets
    .filter((p) => p.stabled)
    .map((p) => p.id)
    .join(','),
);
const assessment = keyedResource(
  () =>
    wild
      ? `${wild.id}|${focusBreed}|${breedLockWeight ?? 'auto'}|${stableIds}|${pinList.join(',')}|${wantedList.join(',')}`
      : null,
  () =>
    assessWildPet({
      wild: wild as NonNullable<typeof wild>,
      pets: $pets,
      focusBreed,
      breedLockWeight,
      pins,
      wanted,
    }),
);

/** Breed-generic alleles first: they serve every breed you might target. */
const genericFirst = (alleles: HuntAllele[]) => [
  ...alleles.filter((a) => a.generic),
  ...alleles.filter((a) => !a.generic),
];
const huntList = $derived(assessment.value ? genericFirst(groupByAllele(assessment.value.targets)) : []);
/** Each pin, and whether the stable still lacks it. A met pin cannot trigger a capture. */
const pinStatus = $derived.by(() => {
  const open = new Map(
    (assessment.value ? groupByAllele(assessment.value.allTargets) : []).map((a) => [pinKey(a.geneId, a.allele), a]),
  );
  return pinList.map((key) => ({ key, target: open.get(key) ?? null }));
});
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

function togglePin(key: string): void {
  const next = pins.has(key) ? pinList.filter((k) => k !== key) : [...pinList, key];
  void settingsActions.update(PINS_KEY, { ...allPins, [species]: next });
}

function toggleAttribute(name: string): void {
  const next = wanted.has(name) ? wantedList.filter((a) => a !== name) : [...wantedList, name];
  void settingsActions.update(ATTRIBUTES_KEY, next);
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

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const alleleText = (allele: string) => (allele === GeneType.DOMINANT ? 'D' : 'R');
const keyText = (key: string) => key.replace(':', ' ');
const targetText = (a: HuntAllele) => `${a.geneId} ${alleleText(a.allele)} · ${a.targets.map(benefitText).join(' · ')}`;
const sexWord = (s: Gender) => (s === Gender.MALE ? 'male' : 'female');
const sexesText = (a: HuntAllele) => (a.sexes.length === 2 ? 'either sex' : `a ${sexWord(a.sexes[0])}`);
const pct = (share: number) => `${share.toFixed(1)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function infoTitle(r: CaptureInfo): string {
  switch (r.kind) {
    case 'needed':
      return `Also brings ${plural(groupByAllele(r.targets).length, 'unpinned allele')} your stable cannot breed${wanted.size > 0 ? ', on your attributes' : ''}`;
    case 'never-seen':
      return `Carries ${plural(r.alleles.length, 'allele')} none of your stabled horses has`;
    case 'quality':
      return `Quality ${pct(r.share)} as stabled; your weakest, ${r.weakest.name}, has ${pct(r.weakest.share)}`;
  }
}

function verdictWhy(advice: CaptureAdvice): string {
  if (advice.capture)
    return `Carries ${plural(groupByAllele(advice.pinned).length, 'pinned allele')} your stable lacks`;
  if (pinList.length === 0) return 'No alleles pinned. Pin the ones you hunt for in the list below.';
  return `Carries none of your ${plural(pinStatus.filter((p) => p.target).length, 'open pin')}`;
}
</script>

<div class="capture-view" data-testid="capture-view">
  <h2 class="sr-only">Capture</h2>
  <PageHeader subtitle="Capture or let go the wild horse you just analysed. Only an allele you pinned suggests a capture: a capture starts a cooldown, and stable space is small." />

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
                <p class="cv-why" data-testid="capture-why">{verdictWhy(advice)}</p>
                {#if advice.pinned.length > 0}
                  <span class="cv-chips">
                    {#each groupByAllele(advice.pinned) as t (`${t.geneId}${t.allele}`)}
                      <span class="cv-chip pinned" class:generic={t.generic}>📌 {targetText(t)}</span>
                    {/each}
                  </span>
                {/if}
                <ul class="cv-info">
                  {#each advice.info as info (info.kind)}
                    <li data-testid="capture-info" data-kind={info.kind}>
                      <span class="cv-reason">{infoTitle(info)}</span>
                      {#if info.kind === 'needed'}
                        {@const alleles = genericFirst(groupByAllele(info.targets))}
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
                      {/if}
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          </div>
          <p class="cv-muted">
            Read against your {plural(assessment.value.stableSize, `stabled ${wild.species.toLowerCase()}`)}{focusBreed ? `, breeding toward ${focusBreed}` : ''}.
            Highlighted alleles are breed-generic. After a capture, import its gene file: this entry becomes the stabled horse.
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

      <section class="cv-card" data-testid="capture-hunt">
        <h3 class="cv-heading">Hunting for</h3>
        {#if pinStatus.length === 0}
          <p class="cv-muted">Nothing pinned yet. Pin alleles from the list below; a wild horse that carries one is worth a capture.</p>
        {:else}
          <span class="cv-chips" data-testid="capture-pins">
            {#each pinStatus as { key, target } (key)}
              <span class="cv-chip pinned" class:met={!target}>
                📌 {target ? `${targetText(target)} · from ${sexesText(target)}` : `${keyText(key)} · your stable has it now`}
                <button type="button" class="cv-unpin" aria-label="Unpin {keyText(key)}" onclick={() => togglePin(key)}>✕</button>
              </span>
            {/each}
          </span>
        {/if}

        <div class="cv-attrs" role="group" aria-label="Attributes you breed for" data-testid="capture-attributes">
          <span class="cv-label">Breeding for</span>
          {#each attributeNames as name (name)}
            <button
              type="button"
              class="cv-attr"
              class:active={wanted.has(name)}
              aria-pressed={wanted.has(name)}
              onclick={() => toggleAttribute(name)}
            >{capitalize(name)}</button>
          {/each}
          {#if wanted.size === 0}<span class="cv-muted">all attributes</span>{/if}
        </div>

        {#if assessment.value}
          <details class="cv-hunt">
            <summary>
              {plural(huntList.length, 'benefit allele')} your stable cannot breed{wanted.size > 0 ? ' on these attributes' : ''}
            </summary>
            {#if huntList.length === 0}
              <p class="cv-muted">Your stable carries every one{focusBreed ? ` for ${focusBreed}` : ''}.</p>
            {:else}
              <ul class="cv-hunt-list" data-testid="capture-hunt-list">
                {#each huntList as t (`${t.geneId}${t.allele}`)}
                  {@const key = pinKey(t.geneId, t.allele)}
                  <li>
                    <button
                      type="button"
                      class="cv-pin"
                      class:active={pins.has(key)}
                      aria-pressed={pins.has(key)}
                      title={pins.has(key) ? 'Unpin' : 'Pin: a wild horse carrying this is worth a capture'}
                      onclick={() => togglePin(key)}
                    >📌</button>
                    <span class="cv-chip" class:generic={t.generic}>{targetText(t)}</span>
                    <span class="cv-muted">from {sexesText(t)}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </details>
        {/if}
      </section>
    {/if}
  </div>
</div>

<style>
  .capture-view { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .cv-body { flex: 1; min-height: 0; overflow: auto; padding: var(--space-sm) var(--space-2xl) var(--space-xl); display: flex; flex-direction: column; gap: var(--space-md); }
  .cv-card { border: 1px solid var(--border-primary); border-radius: var(--radius-sm); padding: var(--space-md); display: flex; flex-direction: column; gap: var(--space-sm); background: var(--bg-primary); }
  .cv-who { display: flex; justify-content: space-between; align-items: center; gap: var(--space-md); }
  .cv-name { font-weight: 600; font-size: 15px; }
  .cv-heading { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-secondary); }
  .cv-meta, .cv-muted { font-size: 12px; color: var(--text-tertiary); margin: 0; }
  .cv-error { font-size: 12px; color: var(--error-text, var(--text-primary)); margin: 0; }
  .cv-verdicts { display: flex; gap: var(--space-md); flex-wrap: wrap; }
  .cv-verdict { flex: 1 1 280px; border: 1px solid var(--border-primary); border-left-width: 4px; border-radius: var(--radius-sm); padding: var(--space-sm) var(--space-md); display: flex; flex-direction: column; gap: var(--space-xs); }
  .cv-verdict.capture { border-left-color: var(--accent); }
  .cv-answer { font-size: 16px; }
  .cv-as { font-size: 12px; color: var(--text-secondary); margin-right: var(--space-xs); }
  .cv-why { margin: 0; font-size: 13px; color: var(--text-primary); }
  .cv-info { list-style: none; margin: var(--space-xs) 0 0; padding: var(--space-xs) 0 0; border-top: 1px solid var(--border-primary); display: flex; flex-direction: column; gap: var(--space-xs); }
  .cv-reason { font-size: 12px; color: var(--text-tertiary); }
  .cv-chips { display: flex; flex-wrap: wrap; gap: var(--space-2xs); margin-top: var(--space-2xs); align-items: center; }
  .cv-chip { font-size: 11px; font-variant-numeric: tabular-nums; border: 1px solid var(--border-primary); border-radius: var(--radius-sm); padding: 0 var(--space-xs); color: var(--text-primary); white-space: nowrap; }
  .cv-chip.generic { border-color: var(--accent); }
  .cv-chip.pinned { font-weight: 600; }
  .cv-chip.met { color: var(--text-tertiary); font-weight: normal; }
  .cv-more, .cv-unpin { background: none; border: none; padding: 0; font: inherit; font-size: 11px; color: var(--accent-text, var(--accent)); cursor: pointer; }
  .cv-unpin { margin-left: var(--space-2xs); color: var(--text-tertiary); }
  .cv-actions { display: flex; gap: var(--space-sm); align-items: center; flex-wrap: wrap; }
  .cv-attrs { display: flex; flex-wrap: wrap; gap: var(--space-2xs); align-items: center; }
  .cv-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-right: var(--space-xs); }
  .cv-attr { font: inherit; font-size: 11px; padding: 0 var(--space-xs); border: 1px solid var(--border-primary); border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-secondary); cursor: pointer; }
  .cv-attr.active { background: var(--bg-selected); color: var(--text-primary); border-color: var(--accent); }
  .cv-hunt summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
  .cv-hunt-list { list-style: none; padding: 0; margin: var(--space-sm) 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--space-2xs) var(--space-md); font-size: 12px; }
  .cv-hunt-list li { display: flex; align-items: center; gap: var(--space-xs); }
  .cv-pin { background: none; border: none; padding: 0; cursor: pointer; filter: grayscale(1); opacity: 0.35; }
  .cv-pin.active { filter: none; opacity: 1; }
</style>
