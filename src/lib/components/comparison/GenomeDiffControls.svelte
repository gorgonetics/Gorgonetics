<script lang="ts">
import BreedSelector from '$lib/components/shared/BreedSelector.svelte';
import GeneFilterPills, { type FilterPillItem } from '$lib/components/shared/GeneFilterPills.svelte';
import type { AppearanceInfo, AttributeInfo } from '$lib/types/index.js';
import { HORSE_BREEDS } from '$lib/types/index.js';

/**
 * The compare view's filter row: breed picker + attribute/appearance tri-state
 * pills. The summary stats and the view / diffs-only toggles now ride in the
 * DetailOverlay header (rendered by GenomeGridDiff), so the lens reads as two
 * rows of chrome — header + this row — matching the trio view.
 */
interface Props {
  isHorse: boolean;
  breedFilter: string;
  autoBreed?: boolean;
  petsHaveKnownBreed?: boolean;
  petsShareBreed?: boolean;
  selectedAttributes: string[];
  hiddenAttributes: string[];
  attributeDisplayInfo: AttributeInfo[];
  selectedAppearances?: string[];
  hiddenAppearances?: string[];
  appearanceDisplayInfo?: AppearanceInfo[];
  currentView?: 'attribute' | 'appearance';
  onBreedChange: (name: string) => void;
  onAutoBreedToggle: () => void;
  onAttributeToggle: (key: string, ctrlKey: boolean, altKey: boolean) => void;
  onAppearanceToggle: (key: string, ctrlKey: boolean, altKey: boolean) => void;
  onResetAttributes: () => void;
  onResetAppearances: () => void;
}

const {
  isHorse,
  breedFilter,
  autoBreed = false,
  petsHaveKnownBreed = false,
  petsShareBreed = false,
  selectedAttributes,
  hiddenAttributes,
  attributeDisplayInfo,
  selectedAppearances = [],
  hiddenAppearances = [],
  appearanceDisplayInfo = [],
  currentView = 'attribute',
  onBreedChange,
  onAutoBreedToggle,
  onAttributeToggle,
  onAppearanceToggle,
  onResetAttributes,
  onResetAppearances,
}: Props = $props();

const attributeItems = $derived<FilterPillItem[]>(
  attributeDisplayInfo.map((a) => ({ key: a.key, name: a.name, icon: a.icon })),
);
const appearanceItems = $derived<FilterPillItem[]>(
  appearanceDisplayInfo.map((a) => ({
    key: a.key,
    name: a.name,
    swatch: a.color_indicator,
    title: a.examples ? `${a.name} — ${a.examples}` : a.name,
  })),
);
</script>

<div class="diff-filters">
    {#if isHorse}
        <div class="breed-filter">
            {#if petsHaveKnownBreed}
                <button
                    type="button"
                    class="auto-btn"
                    class:active={autoBreed}
                    aria-pressed={autoBreed}
                    onclick={onAutoBreedToggle}
                    title={petsShareBreed ? "Auto-select pets' breed" : 'Pets have different breeds'}
                >Auto</button>
            {/if}
            <BreedSelector
                value={breedFilter}
                breeds={HORSE_BREEDS}
                disabled={autoBreed && petsHaveKnownBreed}
                onChange={onBreedChange}
            />
        </div>
    {/if}
    {#if currentView === 'attribute'}
        <GeneFilterPills
            label="Attribute"
            items={attributeItems}
            selected={selectedAttributes}
            hidden={hiddenAttributes}
            onToggle={onAttributeToggle}
            onReset={onResetAttributes}
        />
    {/if}
    {#if currentView === 'appearance' && appearanceItems.length > 0}
        <GeneFilterPills
            label="Appearance"
            items={appearanceItems}
            selected={selectedAppearances}
            hidden={hiddenAppearances}
            onToggle={onAppearanceToggle}
            onReset={onResetAppearances}
        />
    {/if}
</div>

<div class="grid-instructions">Click chromosome labels · Ctrl+click multi · Alt+click hide</div>

<style>
    /* Breed selector + attribute/appearance pills share one wrapping band. */
    .diff-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; }

    .breed-filter { display: flex; align-items: center; gap: 6px; padding: 0 4px; }
    /* Auto = Compare-only mode toggle that owns the breed; the breed picker
       itself is the shared BreedSelector popover. */
    .auto-btn { padding: 3px 8px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-primary); color: var(--text-tertiary); font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
    .auto-btn:hover { border-color: var(--border-secondary); color: var(--text-secondary); }
    .auto-btn.active { background: var(--auto-active); border-color: var(--auto-active); color: var(--bg-primary); }

    .grid-instructions { font-size: 10px; color: var(--text-muted); margin: 4px 0; font-style: italic; padding: 0 4px; }
</style>
