<script>
import { HORSE_BREEDS } from '$lib/types/index.js';

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
} = $props();
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
            <input type="checkbox" checked={showDiffsOnly} onchange={(e) => onDiffsOnlyChange(e.target.checked)} />
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
        <div class="attribute-filter">
            <span class="attr-filter-label">Attribute:</span>
            <button class="attr-filter-btn" class:active={selectedAttributes.length === 0 && hiddenAttributes.length === 0} onclick={onResetAttributes}>All</button>
            {#each attributeDisplayInfo as attr (attr.key)}
                <button
                    class="attr-filter-btn"
                    class:active={selectedAttributes.includes(attr.key)}
                    class:hidden-attr={hiddenAttributes.includes(attr.key)}
                    onclick={(e) => onAttributeToggle(attr.key, e.ctrlKey || e.metaKey, e.altKey)}
                    title="{attr.name}"
                >{attr.icon} {attr.name}</button>
            {/each}
        </div>
    {/if}
    {#if currentView === 'appearance' && appearanceDisplayInfo.length > 0}
        <div class="attribute-filter appearance-filter">
            <span class="attr-filter-label">Appearance:</span>
            <button class="attr-filter-btn" class:active={selectedAppearances.length === 0 && hiddenAppearances.length === 0} onclick={onResetAppearances}>All</button>
            {#each appearanceDisplayInfo as ap (ap.key)}
                <button
                    class="attr-filter-btn appearance-btn"
                    class:active={selectedAppearances.includes(ap.key)}
                    class:hidden-attr={hiddenAppearances.includes(ap.key)}
                    style:--ap-color={ap.color_indicator}
                    onclick={(e) => onAppearanceToggle(ap.key, e.ctrlKey || e.metaKey, e.altKey)}
                    title="{ap.name}{ap.examples ? ' — ' + ap.examples : ''}"
                ><span class="ap-swatch"></span>{ap.name}</button>
            {/each}
        </div>
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

    .attribute-filter { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; padding: 0 4px; }
    .attr-filter-label { font-size: 11px; font-weight: 600; color: var(--text-tertiary); margin-right: 4px; }
    .attr-filter-btn { padding: 3px 8px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-primary); color: var(--text-tertiary); font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
    .attr-filter-btn:hover { border-color: var(--border-secondary); color: var(--text-secondary); }
    .attr-filter-btn.active { background: var(--accent); border-color: var(--accent); color: white; }
    .attr-filter-btn.hidden-attr { background: var(--error-bg); border-color: var(--error-border); color: var(--error-text); text-decoration: line-through; }

    .appearance-filter { margin-top: 2px; }
    .appearance-btn { display: inline-flex; align-items: center; gap: 5px; }
    .ap-swatch { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--ap-color, #6b7280); border: 1px solid rgba(0, 0, 0, 0.2); }

    .grid-instructions { font-size: 11px; color: var(--text-tertiary); margin-bottom: 6px; font-style: italic; padding: 0 4px; }
</style>
