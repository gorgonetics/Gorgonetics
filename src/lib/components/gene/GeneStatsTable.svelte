<script>
import { createEventDispatcher } from 'svelte';
import { run } from 'svelte/legacy';
import {
  FALLBACK_APPEARANCE_LIST,
  FALLBACK_ATTRIBUTE_LIST,
  loadAppearanceConfig,
  loadAttributeConfig,
} from '$lib/utils/apiUtils.js';

const dispatch = createEventDispatcher();

/**
 * @typedef {Object} Props
 * @property {any} [currentStats]
 * @property {string} [currentView]
 * @property {any} [selectedAttributes]
 * @property {any} [hiddenAttributes]
 * @property {number} [totalGenes]
 * @property {number} [neutralGenes]
 * @property {any} [petSpecies]
 * @property {any} [pet]
 */

/** @type {Props} */
const {
  currentStats = null,
  currentView = 'attribute',
  selectedAttributes = [],
  hiddenAttributes = [],
  totalGenes = 0,
  neutralGenes = 0,
  petSpecies = null,
  pet = null,
} = $props();

let attributeList = $state([]);
let appearanceList = $state([]);

async function loadAttributeConfigForTable(species) {
  if (!species) {
    // Default to BeeWasp if no species specified
    species = 'BeeWasp';
  }

  const config = await loadAttributeConfig(species);
  if (config) {
    attributeList = config.attributes || [];
  } else {
    // Fallback to hardcoded attributes
    attributeList = FALLBACK_ATTRIBUTE_LIST;
  }
}

async function loadAppearanceConfigForTable(species) {
  if (!species) {
    // Default to BeeWasp if no species specified
    species = 'BeeWasp';
  }

  const config = await loadAppearanceConfig(species);
  if (config) {
    appearanceList = config.appearance_attributes || [];
  } else {
    // Fallback to hardcoded appearance attributes
    appearanceList = FALLBACK_APPEARANCE_LIST;
  }
}

function calculateTotals() {
  const totals = { value: 0, positive: 0, negative: 0, dominant: 0, recessive: 0, mixed: 0 };
  if (!currentStats || currentView !== 'attribute') return totals;

  attributeList.forEach((attr) => {
    const s = currentStats[attr.key];
    if (!s) return;
    const attrKey = attr.key.toLowerCase();
    totals.value += pet?.[attrKey] ?? 0;
    totals.positive += s.positive || 0;
    totals.negative += s.negative || 0;
    totals.dominant += s.dominant || 0;
    totals.recessive += s.recessive || 0;
    totals.mixed += s.mixed || 0;
  });
  return totals;
}

function calculateAppearanceGrandTotal() {
  if (!currentStats) return 0;
  let total = 0;
  appearanceList.forEach((attr) => {
    const attrKey = attr.key.replace(/_/g, '-');
    total += currentStats[attrKey] || 0;
  });
  return total;
}

function handleAttributeClick(attributeKey, event) {
  const isCtrlClick = event.ctrlKey || event.metaKey;
  const isAltClick = event.altKey;

  dispatch('attributeFilter', {
    attribute: attributeKey,
    ctrlKey: isCtrlClick,
    altKey: isAltClick,
  });
}

const totals = $derived(calculateTotals());
const appearanceGrandTotal = $derived(calculateAppearanceGrandTotal());
run(() => {
  if (petSpecies) {
    loadAttributeConfigForTable(petSpecies);
  }
});
run(() => {
  if (petSpecies && currentView === 'appearance') {
    loadAppearanceConfigForTable(petSpecies);
  }
});
const selectedCount = $derived(selectedAttributes.length);
// Create reactive object lookups
const selectedLookup = $derived(
  selectedAttributes.reduce((acc, attr) => {
    acc[attr] = true;
    return acc;
  }, {}),
);
const hiddenLookup = $derived(
  hiddenAttributes.reduce((acc, attr) => {
    acc[attr] = true;
    return acc;
  }, {}),
);
</script>

<div class="stats-section">
    <div class="stats-table-container">
        <div class="table-header">
            <h4 id="tableTitle">
                {currentView === "attribute"
                    ? "Attribute Effects Summary"
                    : "Appearance Effects Summary"}
            </h4>
            <div class="selection-counters">
                {#if selectedCount > 0}
                    <div class="selection-counter" id="selectionCounter">
                        <span id="selectedCount">{selectedCount}</span> selected
                    </div>
                {/if}
            </div>
        </div>
        <div class="table-instructions">
            Click attributes to select • Ctrl+click to add multiple • Alt+click
            to hide
        </div>

        <table class="stats-table">
            <thead id="tableHeaders">
                {#if currentView === "attribute"}
                    <tr>
                        <th>Attribute</th>
                        <th class="num">Value</th>
                        <th class="num pos">+</th>
                        <th class="num neg">&minus;</th>
                        <th class="num" title="Dominant">D</th>
                        <th class="num" title="Recessive">R</th>
                        <th class="num" title="Mixed">x</th>
                    </tr>
                {:else}
                    <tr>
                        <th>Effect Type</th>
                        <th>Count</th>
                        <th>Details</th>
                    </tr>
                {/if}
            </thead>
            <tbody id="tableBody">
                {#if currentView === "attribute"}
                    {#each attributeList as attr (attr.key)}
                        {@const s = currentStats?.[attr.key] ?? {}}
                        {@const attrKey = attr.key.toLowerCase()}
                        {@const value = pet?.[attrKey] ?? 0}
                        <tr
                            class="attribute-row"
                            class:selected={selectedLookup[attr.key]}
                            class:hidden-attribute={hiddenLookup[attr.key]}
                            data-attribute={attr.key}
                            onclick={(e) => handleAttributeClick(attr.key, e)}
                        >
                            <td>
                                <span class="color-indicator positive"></span>
                                {attr.icon}
                                {attr.name}
                            </td>
                            <td class="num">{value}</td>
                            <td class="num pos">{s.positive || 0}</td>
                            <td class="num neg">{s.negative || 0}</td>
                            <td class="num">{s.dominant || 0}</td>
                            <td class="num">{s.recessive || 0}</td>
                            <td class="num">{s.mixed || 0}</td>
                        </tr>
                    {/each}
                    <tr class="totals-row">
                        <td><strong>Total</strong></td>
                        <td class="num"><strong>{totals.value}</strong></td>
                        <td class="num pos"><strong>{totals.positive}</strong></td>
                        <td class="num neg"><strong>{totals.negative}</strong></td>
                        <td class="num"><strong>{totals.dominant}</strong></td>
                        <td class="num"><strong>{totals.recessive}</strong></td>
                        <td class="num"><strong>{totals.mixed}</strong></td>
                    </tr>
                {:else}
                    {#each appearanceList as type (type.key)}
                        {@const attrKey = type.key.replace(/_/g, "-")}
                        {@const count = currentStats?.[attrKey] || 0}

                        <tr
                            class="appearance-row"
                            class:selected={selectedLookup[attrKey]}
                            class:hidden-attribute={hiddenLookup[attrKey]}
                            data-attribute={attrKey}
                            onclick={(e) => handleAttributeClick(attrKey, e)}
                        >
                            <td>
                                <span
                                    class="color-indicator"
                                    style="background: {type.color_indicator}"
                                    title={type.name}
                                ></span>
                                {type.name}
                            </td>
                            <td>{count}</td>
                            <td>
                                {#if count > 0}
                                    {type.examples}
                                {:else}
                                    <em>None</em>
                                {/if}
                            </td>
                        </tr>
                    {/each}
                    <tr class="totals-row">
                        <td><strong>Total Effects</strong></td>
                        <td><strong>{appearanceGrandTotal}</strong></td>
                        <td><em>All appearance effects</em></td>
                    </tr>
                {/if}
            </tbody>
        </table>

        <div class="summary-info">
            <span>Active Genes: <span id="totalGenesDisplay">{totalGenes}</span></span>
            <span>No Effects: <span id="neutralGenesDisplay">{neutralGenes}</span></span>
        </div>
    </div>
</div>

<style>
    .stats-section {
        width: 100%;
        background: #f9fafb;
        padding: 10px;
        overflow-y: auto;
    }

    .stats-table-container {
        position: sticky;
        top: 0;
    }

    .table-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
    }

    .stats-table-container h4 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        color: #374151;
    }

    .selection-counters {
        position: relative;
        min-height: 20px;
    }

    .selection-counter {
        position: absolute;
        top: 0;
        right: 0;
        background: #dbeafe;
        color: #1d4ed8;
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid #93c5fd;
        white-space: nowrap;
    }

    .selection-counter span {
        font-weight: 600;
    }

    .table-instructions {
        font-size: 11px;
        color: #6b7280;
        margin-bottom: 8px;
        font-style: italic;
    }

    .stats-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        background: white;
        border-radius: 6px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .stats-table th,
    .stats-table td {
        padding: 8px 8px;
        text-align: left;
        border-bottom: 1px solid #e2e8f0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .stats-table th.num,
    .stats-table td.num {
        text-align: center;
        padding: 8px 4px;
    }

    .stats-table th.pos,
    .stats-table td.pos {
        color: #16a34a;
    }

    .stats-table th.neg,
    .stats-table td.neg {
        color: #dc2626;
    }

    .stats-table th {
        background: #f3f4f6;
        font-weight: 600;
        color: #374151;
    }

    .stats-table tbody tr {
        cursor: pointer;
        transition: background-color 0.2s ease;
    }

    .stats-table tbody tr:hover {
        background-color: #f9fafb;
    }

    .stats-table tbody tr.selected {
        background-color: #dbeafe !important;
        box-shadow:
            inset 4px 0 0 0 #3b82f6,
            inset 0 0 0 1px rgba(59, 130, 246, 0.2);
    }

    .stats-table tbody tr.selected td {
        color: #1d4ed8;
        font-weight: 500;
    }

    .stats-table tbody tr.selected:hover {
        background-color: #bfdbfe !important;
    }

    .attribute-row.hidden-attribute,
    .appearance-row.hidden-attribute {
        background-color: #fef2f2 !important;
        box-shadow:
            inset 4px 0 0 0 #ef4444,
            inset 0 0 0 1px rgba(239, 68, 68, 0.2);
    }

    .attribute-row.hidden-attribute td,
    .appearance-row.hidden-attribute td {
        color: #dc2626;
        font-weight: 500;
        text-decoration: line-through;
    }

    .attribute-row.hidden-attribute:hover,
    .appearance-row.hidden-attribute:hover {
        background-color: #fecaca !important;
    }

    .totals-row {
        border-top: 2px solid #e5e7eb;
        background-color: #f8fafc !important;
    }

    .totals-row:hover {
        background-color: #f8fafc !important;
        cursor: default !important;
    }

    /* Color indicators for table rows */
    .stats-table td:first-child {
        position: relative;
    }

    .color-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        display: inline-block;
        margin-right: 8px;
        vertical-align: middle;
        border: 1px solid rgba(0, 0, 0, 0.1);
    }

    /* Default colors */
    .color-indicator.positive {
        background-color: #10b981;
    }

    .summary-info {
        margin-top: 12px;
        display: flex;
        gap: 16px;
        font-size: 11px;
        color: #6b7280;
    }
</style>
