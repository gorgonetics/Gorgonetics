<script>
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();

    export let currentStats = null;
    export let currentView = "attribute";
    export let selectedAttributes = [];
    export let hiddenAttributes = [];
    export let totalGenes = 0;
    export let neutralGenes = 0;

    $: grandTotal = calculateGrandTotal();

    function calculateGrandTotal() {
        if (!currentStats) return 0;

        let total = 0;
        if (currentView === "attribute") {
            const attributes = [
                "Intelligence",
                "Toughness",
                "Friendliness",
                "Ruggedness",
                "Ferocity",
                "Enthusiasm",
                "Virility",
                "Speed",
            ];
            attributes.forEach((attr) => {
                const positiveCount = currentStats[attr]?.positive || 0;
                const negativeCount = currentStats[attr]?.negative || 0;
                total += positiveCount + negativeCount;
            });
        } else {
            const appearanceTypes = [
                "body-color-hue",
                "body-color-saturation",
                "body-color-intensity",
                "wing-color-hue",
                "wing-color-saturation",
                "wing-color-intensity",
                "body-scale",
                "wing-scale",
                "head-scale",
                "tail-scale",
                "antenna-scale",
                "leg-deformity",
                "antenna-deformity",
                "particles",
                "particle-location",
                "glow",
            ];
            appearanceTypes.forEach((type) => {
                total += currentStats[type] || 0;
            });
        }
        return total;
    }

    function handleAttributeClick(attributeKey, event) {
        const isCtrlClick = event.ctrlKey || event.metaKey;
        const isAltClick = event.altKey;

        dispatch("attributeFilter", {
            attribute: attributeKey,
            ctrlKey: isCtrlClick,
            altKey: isAltClick,
        });
    }

    $: selectedCount = selectedAttributes.length;

    // Create reactive object lookups
    $: selectedLookup = selectedAttributes.reduce((acc, attr) => {
        acc[attr] = true;
        return acc;
    }, {});

    $: hiddenLookup = hiddenAttributes.reduce((acc, attr) => {
        acc[attr] = true;
        return acc;
    }, {});
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
                <tr>
                    <th
                        >{currentView === "attribute"
                            ? "Attribute"
                            : "Effect Type"}</th
                    >
                    <th>Count</th>
                    <th>Details</th>
                </tr>
            </thead>
            <tbody id="tableBody">
                {#if currentView === "attribute"}
                    {#each [{ key: "Intelligence", name: "Intelligence", icon: "🧠" }, { key: "Toughness", name: "Toughness", icon: "💪" }, { key: "Friendliness", name: "Friendliness", icon: "😊" }, { key: "Ruggedness", name: "Ruggedness", icon: "🏔️" }, { key: "Ferocity", name: "Ferocity", icon: "🔥" }, { key: "Enthusiasm", name: "Enthusiasm", icon: "✨" }, { key: "Virility", name: "Virility", icon: "💜" }, { key: "Speed", name: "Speed", icon: "⚡" }] as attr}
                        {@const positiveCount =
                            currentStats?.[attr.key]?.positive || 0}
                        {@const negativeCount =
                            currentStats?.[attr.key]?.negative || 0}
                        {@const totalCount = positiveCount + negativeCount}
                        <tr
                            class="attribute-row"
                            class:selected={selectedLookup[attr.key]}
                            class:hidden-attribute={hiddenLookup[attr.key]}
                            data-attribute={attr.key}
                            on:click={(e) => handleAttributeClick(attr.key, e)}
                        >
                            <td>
                                <span class="color-indicator positive"></span>
                                {attr.icon}
                                {attr.name}
                            </td>
                            <td>{totalCount}</td>
                            <td>
                                {#if totalCount > 0}
                                    {#if positiveCount > 0}+{positiveCount}{/if}{#if negativeCount > 0} -{negativeCount}{/if}
                                {:else}
                                    <em>None</em>
                                {/if}
                            </td>
                        </tr>
                    {/each}
                    <tr class="totals-row">
                        <td><strong>Total Effects</strong></td>
                        <td><strong>{grandTotal}</strong></td>
                        <td><em>All attributes</em></td>
                    </tr>
                {:else}
                    {#each [{ key: "body-color-hue", name: "Body Color Hue", examples: "Color tone" }, { key: "body-color-saturation", name: "Body Color Saturation", examples: "Color intensity" }, { key: "body-color-intensity", name: "Body Color Intensity", examples: "Brightness" }, { key: "wing-color-hue", name: "Wing Color Hue", examples: "Wing tone" }, { key: "wing-color-saturation", name: "Wing Color Saturation", examples: "Wing intensity" }, { key: "wing-color-intensity", name: "Wing Color Intensity", examples: "Wing brightness" }, { key: "body-scale", name: "Body Scale", examples: "Body size" }, { key: "wing-scale", name: "Wing Scale", examples: "Wing size" }, { key: "head-scale", name: "Head Scale", examples: "Head size" }, { key: "tail-scale", name: "Tail Scale", examples: "Tail size" }, { key: "antenna-scale", name: "Antenna Scale", examples: "Antenna size" }, { key: "leg-deformity", name: "Leg Deformity", examples: "Leg shape" }, { key: "antenna-deformity", name: "Antenna Deformity", examples: "Antenna shape" }, { key: "particles", name: "Particles", examples: "Special effects" }, { key: "particle-location", name: "Particle Location", examples: "Effect position" }, { key: "glow", name: "Glow", examples: "Luminescence" }] as type}
                        {@const count = currentStats?.[type.key] || 0}
                        <tr
                            class="appearance-row"
                            class:selected={selectedLookup[type.key]}
                            class:hidden-attribute={hiddenLookup[type.key]}
                            data-attribute={type.key}
                            on:click={(e) => handleAttributeClick(type.key, e)}
                        >
                            <td>
                                <span class="color-indicator {type.key}"></span>
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
                        <td><strong>{grandTotal}</strong></td>
                        <td><em>All appearance effects</em></td>
                    </tr>
                {/if}
            </tbody>
        </table>

        <div class="summary-info">
            <span
                >Total Genes: <span id="totalGenesDisplay">{totalGenes}</span
                ></span
            >
            <span
                >No Effects: <span id="neutralGenesDisplay">{neutralGenes}</span
                ></span
            >
        </div>
    </div>
</div>

<style>
    .stats-section {
        width: 300px;
        background: #f9fafb;
        padding: 10px;
        overflow-y: auto;
        border-left: 1px solid #e2e8f0;
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
        padding: 8px 12px;
        text-align: left;
        border-bottom: 1px solid #e2e8f0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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

    .color-indicator.negative {
        background-color: #ef4444;
    }

    .color-indicator.neutral {
        background-color: #6b7280;
    }

    /* Appearance effect colors */
    .color-indicator.body-color-hue {
        background: linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1);
    }

    .color-indicator.body-color-saturation {
        background: linear-gradient(90deg, #f8f9fa, #ff6b6b);
    }

    .color-indicator.body-color-intensity {
        background: linear-gradient(90deg, #343a40, #f8f9fa);
    }

    .color-indicator.wing-color-hue {
        background: linear-gradient(45deg, #ffd93d, #6bcf7f, #4d72aa);
    }

    .color-indicator.wing-color-saturation {
        background: linear-gradient(90deg, #e9ecef, #ffd93d);
    }

    .color-indicator.wing-color-intensity {
        background: linear-gradient(90deg, #495057, #fff3cd);
    }

    .color-indicator.body-scale {
        background-color: #8b5cf6;
    }

    .color-indicator.wing-scale {
        background-color: #06b6d4;
    }

    .color-indicator.head-scale {
        background-color: #f59e0b;
    }

    .color-indicator.tail-scale {
        background-color: #84cc16;
    }

    .color-indicator.antenna-scale {
        background-color: #ec4899;
    }

    .color-indicator.leg-deformity {
        background-color: #ef4444;
    }

    .color-indicator.antenna-deformity {
        background-color: #f97316;
    }

    .color-indicator.particles {
        background: radial-gradient(circle, #fbbf24, #f59e0b);
    }

    .color-indicator.particle-location {
        background: conic-gradient(#8b5cf6, #ec4899, #06b6d4, #8b5cf6);
    }

    .color-indicator.glow {
        background: radial-gradient(circle, #fef3c7, #f59e0b);
        box-shadow: 0 0 4px rgba(245, 158, 11, 0.5);
    }

    .summary-info {
        margin-top: 12px;
        display: flex;
        gap: 16px;
        font-size: 11px;
        color: #6b7280;
    }
</style>
