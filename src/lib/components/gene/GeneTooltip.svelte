<script>
    /**
     * @typedef {Object} Props
     * @property {boolean} [visible]
     * @property {number} [x]
     * @property {number} [y]
     * @property {string} [geneId]
     * @property {string} [geneType]
     * @property {string} [effect]
     * @property {any} [potentialEffects]
     */

    /** @type {Props} */
    const {
        visible = false,
        x = 0,
        y = 0,
        geneId = "",
        geneType = "",
        effect = "",
        potentialEffects = [],
    } = $props();

    function getTypeDescription(type) {
        switch (type) {
            case "R":
                return "Recessive";
            case "D":
                return "Dominant";
            case "x":
                return "Mixed (treated as dominant)";
            case "?":
                return "Unknown";
            default:
                return "Unknown";
        }
    }
</script>

{#if visible}
    <div class="gene-tooltip" style="left: {x}px; top: {y}px;">
        <div class="tooltip-header">
            <strong>Gene {geneId}</strong>
        </div>
        <div class="tooltip-content">
            <div class="gene-type">Type: {getTypeDescription(geneType)}</div>
            <div class="current-effect">
                <strong
                    >Current Effect: <span
                        class:positive={effect.includes("+")}
                        class:negative={effect.includes("-")}>{effect}</span
                    ></strong
                >
            </div>
            {#if potentialEffects.length > 0}
                <div class="potential-effects">
                    <strong>Potential Effects:</strong>
                    {#each potentialEffects as potentialEffect}
                        <div
                            class="potential-effect"
                            class:positive={potentialEffect.includes("+")}
                            class:negative={potentialEffect.includes("-")}
                        >
                            {@html potentialEffect}
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </div>
{/if}

<style>
    .gene-tooltip {
        position: absolute;
        background: #1f2937;
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        line-height: 1.4;
        max-width: 250px;
        z-index: 9999;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        pointer-events: none;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .tooltip-header {
        margin-bottom: 4px;
    }

    .tooltip-header strong {
        color: #60a5fa;
        font-weight: 600;
    }

    .tooltip-content {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .gene-type {
        color: #d1d5db;
        font-size: 11px;
    }

    .current-effect {
        margin: 2px 0;
    }

    .current-effect strong {
        color: #fbbf24;
    }

    .current-effect .positive {
        color: #34d399;
    }

    .current-effect .negative {
        color: #f87171;
    }

    .potential-effects {
        margin-top: 4px;
        padding-top: 4px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    .potential-effects strong {
        color: #a78bfa;
        font-size: 11px;
        display: block;
        margin-bottom: 2px;
    }

    .potential-effect {
        font-size: 11px;
        line-height: 1.3;
        margin: 1px 0;
    }

    .potential-effect.positive {
        color: #34d399;
    }

    .potential-effect.negative {
        color: #f87171;
    }

    /* Smooth appearance animation */
    .gene-tooltip {
        animation: tooltipFadeIn 0.15s ease-out;
    }

    @keyframes tooltipFadeIn {
        from {
            opacity: 0;
            transform: scale(0.95) translateY(-2px);
        }
        to {
            opacity: 1;
            transform: scale(1) translateY(0);
        }
    }
</style>
