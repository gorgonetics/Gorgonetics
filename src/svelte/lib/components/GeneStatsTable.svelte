<script>
    import { run } from 'svelte/legacy';

    import { createEventDispatcher } from "svelte";
    import App from "../../App.svelte";

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
     */

    /** @type {Props} */
    let {
        currentStats = null,
        currentView = "attribute",
        selectedAttributes = [],
        hiddenAttributes = [],
        totalGenes = 0,
        neutralGenes = 0,
        petSpecies = null
    } = $props();

    let attributeList = $state([]);
    let attributeConfig = null;
    let appearanceList = $state([]);
    let appearanceConfig = null;
    const fallbackAttributeList = [
        { key: "Intelligence", name: "Intelligence", icon: "🧠" },
        { key: "Toughness", name: "Toughness", icon: "💪" },
        { key: "Friendliness", name: "Friendliness", icon: "😊" },
        { key: "Ruggedness", name: "Ruggedness", icon: "🏔️" },
        { key: "Enthusiasm", name: "Enthusiasm", icon: "✨" },
        { key: "Virility", name: "Virility", icon: "💜" },
        { key: "Ferocity", name: "Ferocity", icon: "🔥" },
    ];


    async function loadAttributeConfig(species) {
        if (!species) {
            // Default to BeeWasp if no species specified
            species = "BeeWasp";
        }

        try {
            const response = await fetch(`/api/attribute-config/${species}`);
            if (response.ok) {
                attributeConfig = await response.json();
                attributeList = attributeConfig.attributes || [];
            } else {
                console.warn(`Failed to load attribute config for ${species}`);
                // Fallback to hardcoded BeeWasp attributes
                attributeList = fallbackAttributeList;
            }
        } catch (error) {
            console.error(
                `Error loading attribute config for ${species}:`,
                error,
            );
            // Fallback to hardcoded attributes
            attributeList = fallbackAttributeList;
        }
    }

    async function loadAppearanceConfig(species) {
        if (!species) {
            // Default to BeeWasp if no species specified
            species = "BeeWasp";
        }

        try {
            const response = await fetch(`/api/appearance-config/${species}`);
            if (response.ok) {
                appearanceConfig = await response.json();
                appearanceList = appearanceConfig.appearance_attributes || [];
            } else {
                console.warn(`Failed to load appearance config for ${species}`);
                // Fallback to hardcoded BeeWasp appearance attributes
                appearanceList = [
                    {
                        key: "body_color_hue",
                        name: "Body Color Hue",
                        examples: "Color tone",
                    },
                    {
                        key: "body_color_saturation",
                        name: "Body Color Saturation",
                        examples: "Color intensity",
                    },
                    {
                        key: "body_color_intensity",
                        name: "Body Color Intensity",
                        examples: "Brightness",
                    },
                    {
                        key: "wing_color_hue",
                        name: "Wing Color Hue",
                        examples: "Wing tone",
                    },
                    {
                        key: "wing_color_saturation",
                        name: "Wing Color Saturation",
                        examples: "Wing intensity",
                    },
                    {
                        key: "wing_color_intensity",
                        name: "Wing Color Intensity",
                        examples: "Wing brightness",
                    },
                    {
                        key: "body_scale",
                        name: "Body Scale",
                        examples: "Body size",
                    },
                    {
                        key: "wing_scale",
                        name: "Wing Scale",
                        examples: "Wing size",
                    },
                    {
                        key: "head_scale",
                        name: "Head Scale",
                        examples: "Head size",
                    },
                    {
                        key: "tail_scale",
                        name: "Tail Scale",
                        examples: "Tail size",
                    },
                    {
                        key: "antenna_scale",
                        name: "Antenna Scale",
                        examples: "Antenna size",
                    },
                    {
                        key: "leg_deformity",
                        name: "Leg Deformity",
                        examples: "Leg shape",
                    },
                    {
                        key: "antenna_deformity",
                        name: "Antenna Deformity",
                        examples: "Antenna shape",
                    },
                    {
                        key: "particles",
                        name: "Particles",
                        examples: "Special effects",
                    },
                    {
                        key: "particle_location",
                        name: "Particle Location",
                        examples: "Effect position",
                    },
                    { key: "glow", name: "Glow", examples: "Luminescence" },
                ];
            }
        } catch (error) {
            console.error(
                `Error loading appearance config for ${species}:`,
                error,
            );
            // Fallback to hardcoded attributes
            appearanceList = [
                {
                    key: "body_color_hue",
                    name: "Body Color Hue",
                    examples: "Color tone",
                },
                {
                    key: "body_color_saturation",
                    name: "Body Color Saturation",
                    examples: "Color intensity",
                },
                {
                    key: "body_color_intensity",
                    name: "Body Color Intensity",
                    examples: "Brightness",
                },
                {
                    key: "wing_color_hue",
                    name: "Wing Color Hue",
                    examples: "Wing tone",
                },
                {
                    key: "wing_color_saturation",
                    name: "Wing Color Saturation",
                    examples: "Wing intensity",
                },
                {
                    key: "wing_color_intensity",
                    name: "Wing Color Intensity",
                    examples: "Wing brightness",
                },
                {
                    key: "body_scale",
                    name: "Body Scale",
                    examples: "Body size",
                },
                {
                    key: "wing_scale",
                    name: "Wing Scale",
                    examples: "Wing size",
                },
                {
                    key: "head_scale",
                    name: "Head Scale",
                    examples: "Head size",
                },
                {
                    key: "tail_scale",
                    name: "Tail Scale",
                    examples: "Tail size",
                },
                {
                    key: "antenna_scale",
                    name: "Antenna Scale",
                    examples: "Antenna size",
                },
                {
                    key: "leg_deformity",
                    name: "Leg Deformity",
                    examples: "Leg shape",
                },
                {
                    key: "antenna_deformity",
                    name: "Antenna Deformity",
                    examples: "Antenna shape",
                },
                {
                    key: "particles",
                    name: "Particles",
                    examples: "Special effects",
                },
                {
                    key: "particle_location",
                    name: "Particle Location",
                    examples: "Effect position",
                },
                { key: "glow", name: "Glow", examples: "Luminescence" },
            ];
        }
    }

    function calculateGrandTotal() {
        if (!currentStats) return 0;

        let total = 0;
        if (currentView === "attribute") {
            attributeList.forEach((attr) => {
                const positiveCount = currentStats[attr.key]?.positive || 0;
                const negativeCount = currentStats[attr.key]?.negative || 0;
                total += positiveCount + negativeCount;
            });
        } else {
            // Use dynamic appearance attributes
            appearanceList.forEach((attr) => {
                const attrKey = attr.key.replace(/_/g, "-"); // Convert underscores back to dashes for stats
                total += currentStats[attrKey] || 0;
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



    let grandTotal = $derived(calculateGrandTotal());
    run(() => {
        if (petSpecies) {
            loadAttributeConfig(petSpecies);
        }
    });
    run(() => {
        if (petSpecies && currentView === "appearance") {
            loadAppearanceConfig(petSpecies);
        }
    });
    let selectedCount = $derived(selectedAttributes.length);
    // Create reactive object lookups
    let selectedLookup = $derived(selectedAttributes.reduce((acc, attr) => {
        acc[attr] = true;
        return acc;
    }, {}));
    let hiddenLookup = $derived(hiddenAttributes.reduce((acc, attr) => {
        acc[attr] = true;
        return acc;
    }, {}));
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
                    {#each attributeList as attr}
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
                            onclick={(e) => handleAttributeClick(attr.key, e)}
                        >
                            <td>
                                <span class="color-indicator positive"></span>
                                {attr.icon}
                                {attr.name}
                            </td>
                            <td>{totalCount}</td>
                            <td>
                                {#if totalCount > 0}
                                    {#if positiveCount > 0}+{positiveCount}{/if}{#if negativeCount > 0}
                                        -{negativeCount}{/if}
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
                    {#each appearanceList as type}
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
                                <span class="color-indicator {attrKey}"></span>
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
