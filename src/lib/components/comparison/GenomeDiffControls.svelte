<script lang="ts">
import GeneFilterPills, { type FilterPillItem } from '$lib/components/shared/GeneFilterPills.svelte';
import type { AppearanceInfo, AttributeInfo, GenomeDiffSummary } from '$lib/types/index.js';
import { HORSE_BREEDS } from '$lib/types/index.js';

interface Props {
  summary: GenomeDiffSummary;
  isHorse: boolean;
  breedFilter: string;
  autoBreed?: boolean;
  petsHaveKnownBreed?: boolean;
  petsShareBreed?: boolean;
  showDiffsOnly: boolean;
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
  onDiffsOnlyChange: (val: boolean) => void;
  onResetAttributes: () => void;
  onResetAppearances: () => void;
  onViewChange: (view: 'attribute' | 'appearance') => void;
}

const {
  summary,
  isHorse,
  breedFilter,
  autoBreed = false,
  petsHaveKnownBreed = false,
  petsShareBreed = false,
  showDiffsOnly,
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
  onDiffsOnlyChange,
  onResetAttributes,
  onResetAppearances,
  onViewChange,
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

<div class="diff-controls">
    <div class="diff-summary">
        <span class="similarity-badge">{summary.similarityPercent}% identical</span>
        <span class="summary-detail">{summary.identicalGenes}/{summary.totalGenes} genes match · {summary.differentGenes} diff</span>
        <div class="view-toggle">
            <button class="view-btn" class:active={currentView === 'attribute'} onclick={() => onViewChange('attribute')}>Attributes</button>
            <button class="view-btn" class:active={currentView === 'appearance'} onclick={() => onViewChange('appearance')}>Appearance</button>
        </div>
        <label class="diff-toggle">
            <input type="checkbox" checked={showDiffsOnly} onchange={(e) => onDiffsOnlyChange((e.target as HTMLInputElement).checked)} />
            Differences only
        </label>
    </div>
    {#if isHorse}
        <div class="breed-filter">
            <span class="breed-label">Breed:</span>
            {#if petsHaveKnownBreed}
                <button class="breed-btn auto-btn" class:active={autoBreed} onclick={onAutoBreedToggle} title={petsShareBreed ? "Auto-select pets' breed" : "Pets have different breeds"}>Auto</button>
                <span class="breed-divider"></span>
            {/if}
            <button class="breed-btn" class:active={(!autoBreed || !petsHaveKnownBreed) && breedFilter === ''} disabled={autoBreed && petsHaveKnownBreed} onclick={() => onBreedChange('')}>All</button>
            {#each Object.entries(HORSE_BREEDS) as [name, abbrev]}
                <button class="breed-btn" class:active={(!autoBreed || !petsHaveKnownBreed) && breedFilter === name} disabled={autoBreed && petsHaveKnownBreed} onclick={() => onBreedChange(name)} title={name}>{abbrev}</button>
            {/each}
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

<div class="grid-instructions">Click chromosome labels to filter · Ctrl+click to multi-select · Alt+click to hide</div>

<style>
    .diff-controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
    .diff-summary { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--bg-secondary); border-radius: 8px; flex-wrap: wrap; }
    .similarity-badge { font-size: 14px; font-weight: 700; color: var(--text-primary); padding: 4px 10px; background: var(--bg-tertiary); border-radius: 10px; }
    .summary-detail { font-size: 12px; color: var(--text-secondary); }
    .diff-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
    .diff-toggle input { cursor: pointer; }

    .view-toggle { margin-left: auto; display: inline-flex; border: 1px solid var(--border-primary); border-radius: 4px; overflow: hidden; }
    .view-btn { padding: 3px 10px; border: none; background: var(--bg-primary); color: var(--text-tertiary); font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
    .view-btn + .view-btn { border-left: 1px solid var(--border-primary); }
    .view-btn:hover { color: var(--text-secondary); }
    .view-btn.active { background: var(--accent); color: white; }

    .breed-filter { display: flex; align-items: center; gap: 3px; padding: 0 4px; }
    .breed-label { font-size: 11px; font-weight: 600; color: var(--text-tertiary); margin-right: 4px; }
    .breed-btn { padding: 3px 8px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-primary); color: var(--text-tertiary); font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
    .breed-btn:hover { border-color: var(--border-secondary); color: var(--text-secondary); }
    .breed-btn.active { background: var(--accent); border-color: var(--accent); color: white; }
    .breed-btn:disabled { opacity: 0.4; cursor: default; pointer-events: none; }
    .auto-btn.active { background: #22c55e; border-color: #22c55e; color: var(--bg-primary); }
    .breed-divider { width: 1px; height: 16px; background: var(--border-primary); margin: 0 2px; }

    /* Attribute / appearance tri-state pills now live in GeneFilterPills. */

    .grid-instructions { font-size: 11px; color: var(--text-tertiary); margin-bottom: 6px; font-style: italic; padding: 0 4px; }
</style>
