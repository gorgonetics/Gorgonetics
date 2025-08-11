<script>
    import { createEventDispatcher } from "svelte";

    /**
     * @typedef {Object} Props
     * @property {any} [gene]
     * @property {string} [chromosome]
     * @property {any} [geneAnalysis]
     * @property {string} [currentView]
     * @property {boolean} [isVisible]
     */

    /** @type {Props} */
    let {
        gene = null,
        chromosome = "",
        geneAnalysis = null,
        currentView = "attribute",
        isVisible = true,
    } = $props();

    const dispatch = createEventDispatcher();

    function computeCssClass(gene, geneAnalysis, currentView, isVisible) {
        if (!gene || !geneAnalysis) return "gene-cell";

        let cssClass = "gene-cell ";

        if (currentView === "appearance") {
            cssClass += `gene-${geneAnalysis.type} `;
        } else {
            cssClass += `gene-${geneAnalysis.type} `;
        }

        if (gene.type === "?") {
            cssClass = "gene-cell gene-neutral gene-unknown";
        } else if (gene.type === "D") {
            cssClass += "gene-dominant";
        } else if (gene.type === "R") {
            cssClass += "gene-recessive";
        } else if (gene.type === "x") {
            cssClass += "gene-mixed";
        } else {
            cssClass += "gene-recessive";
        }

        if (currentView === "appearance" && geneAnalysis.attribute) {
            cssClass += ` gene-${geneAnalysis.attribute}`;
        }

        if (!isVisible) {
            cssClass += " gene-filtered-out";
        }

        return cssClass;
    }

    function handleMouseEnter(event) {
        if (!gene) return;
        dispatch("tooltip-show", {
            event,
            geneId: gene.id,
            geneType: gene.type,
            chromosome,
            effect: geneAnalysis?.effect || "",
        });
    }

    function handleMouseLeave(event) {
        dispatch("tooltip-hide", { event });
    }
    let cssClass = $derived(
        computeCssClass(gene, geneAnalysis, currentView, isVisible),
    );
</script>

{#if gene}
    <div
        class={cssClass}
        data-chromosome={chromosome}
        data-gene-id={gene.id}
        data-gene-type={gene.type}
        data-effect={geneAnalysis?.effect || ""}
        onmouseenter={handleMouseEnter}
        onmouseleave={handleMouseLeave}
        role="button"
        tabindex="0"
    >
        {#if gene.type === "?"}
            <span class="gene-unknown-symbol" title="Unknown gene">?</span>
        {/if}
    </div>
{/if}

<style>
    /* CSS Custom Properties for Gene Colors */
    :global(:root) {
        --gene-body-hue: #ff9800;
        --gene-body-saturation: #ff6f00;
        --gene-body-intensity: #ffcc02;
        --gene-wing-hue: #2196f3;
        --gene-wing-saturation: #1976d2;
        --gene-wing-intensity: #0d47a1;
        --gene-body-scale: #9c27b0;
        --gene-wing-scale: #7b1fa2;
        --gene-head-scale: #8e24aa;
        --gene-tail-scale: #ab47bc;
        --gene-antenna-scale: #ba68c8;
        --gene-leg-deformity: #e91e63;
        --gene-antenna-deformity: #c2185b;
        --gene-particles: #00bcd4;
        --gene-particle-location: #0097a7;
        --gene-glow: #8bc34a;
        --gene-appearance-neutral: #95a5a6;

        /* Horse appearance colors */
        --gene-scale-kb: #8b5cf6;
        --gene-attributes-kb: #06b6d4;
        --gene-selector-sb: #8b4513;
        --gene-selector-pt: #f59e0b;
        --gene-selector-po: #84cc16;
        --gene-selector-kb: #ec4899;
        --gene-selector-bl: #3b82f6;
        --gene-horn: #ef4444;
        --gene-horn-kb: #f97316;
    }

    :global(.gene-cell) {
        width: 19px;
        height: 19px;
        margin: 0px;
        border-radius: 50%;
        border: 3px solid;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    :global(.gene-cell:hover) {
        transform: scale(1.2);
        z-index: 20;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    /* Gene effect colors */
    :global(.gene-positive.gene-dominant) {
        background-color: #4caf50;
        border-color: #4caf50;
    }

    :global(.gene-negative.gene-dominant) {
        background-color: #f44336;
        border-color: #f44336;
    }

    :global(.gene-neutral.gene-dominant) {
        background-color: #95a5a6;
        border-color: #95a5a6;
    }

    :global(.gene-positive.gene-recessive) {
        background-color: rgba(76, 175, 80, 0.15);
        border-color: #4caf50;
        border-width: 4px;
    }

    :global(.gene-negative.gene-recessive) {
        background-color: rgba(244, 67, 54, 0.15);
        border-color: #f44336;
        border-width: 4px;
    }

    :global(.gene-neutral.gene-recessive) {
        background-color: rgba(149, 165, 166, 0.15);
        border-color: #95a5a6;
        border-width: 4px;
    }

    :global(.gene-positive.gene-mixed) {
        background: linear-gradient(135deg, transparent 50%, #4caf50 50%);
        border-color: #4caf50;
    }

    :global(.gene-negative.gene-mixed) {
        background: linear-gradient(135deg, transparent 50%, #f44336 50%);
        border-color: #f44336;
    }

    :global(.gene-neutral.gene-mixed) {
        background: linear-gradient(135deg, transparent 50%, #95a5a6 50%);
        border-color: #95a5a6;
    }

    :global(.gene-neutral.gene-unknown) {
        background: #f3f4f6;
        border: 2.5px dashed rgba(149, 165, 166, 0.5);
        color: #b0b4ba;
        opacity: 0.7;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .gene-unknown-symbol {
        color: #b0b4ba;
        font-size: 1em;
        font-weight: 600;
        opacity: 1;
        text-align: center;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    /* Potential effect colors */
    :global(.gene-potential-positive.gene-dominant) {
        background-color: #3498db;
        border-color: #3498db;
    }

    :global(.gene-potential-positive.gene-recessive) {
        background-color: rgba(52, 152, 219, 0.15);
        border-color: #3498db;
        border-width: 4px;
    }

    :global(.gene-potential-positive.gene-mixed) {
        background: linear-gradient(135deg, transparent 50%, #3498db 50%);
        border-color: #3498db;
    }

    :global(.gene-potential-negative.gene-dominant) {
        background-color: #9b59b6;
        border-color: #9b59b6;
    }

    :global(.gene-potential-negative.gene-recessive) {
        background-color: rgba(155, 89, 182, 0.15);
        border-color: #9b59b6;
        border-width: 4px;
    }

    :global(.gene-potential-negative.gene-mixed) {
        background: linear-gradient(135deg, transparent 50%, #9b59b6 50%);
        border-color: #9b59b6;
    }

    :global(.gene-filtered-out) {
        opacity: 0.25 !important;
        filter: grayscale(1) blur(0.5px);
        pointer-events: none !important;
        background: #f3f4f6 !important;
        border-color: #b0b4ba !important;
        color: #b0b4ba !important;
        transition: opacity 0.2s;
    }

    /* Appearance-based gene colors */
    :global(.gene-body-color-hue) {
        --gene-color: var(--gene-body-hue);
    }

    :global(.gene-body-color-saturation) {
        --gene-color: var(--gene-body-saturation);
    }

    :global(.gene-body-color-intensity) {
        --gene-color: var(--gene-body-intensity);
    }

    :global(.gene-wing-color-hue) {
        --gene-color: var(--gene-wing-hue);
    }

    :global(.gene-wing-color-saturation) {
        --gene-color: var(--gene-wing-saturation);
    }

    :global(.gene-wing-color-intensity) {
        --gene-color: var(--gene-wing-intensity);
    }

    :global(.gene-body-scale) {
        --gene-color: var(--gene-body-scale);
    }

    :global(.gene-wing-scale) {
        --gene-color: var(--gene-wing-scale);
    }

    :global(.gene-head-scale) {
        --gene-color: var(--gene-head-scale);
    }

    :global(.gene-tail-scale) {
        --gene-color: var(--gene-tail-scale);
    }

    :global(.gene-antenna-scale) {
        --gene-color: var(--gene-antenna-scale);
    }

    :global(.gene-leg-deformity) {
        --gene-color: var(--gene-leg-deformity);
    }

    :global(.gene-antenna-deformity) {
        --gene-color: var(--gene-antenna-deformity);
    }

    :global(.gene-particles) {
        --gene-color: var(--gene-particles);
    }

    :global(.gene-particle-location) {
        --gene-color: var(--gene-particle-location);
    }

    :global(.gene-glow) {
        --gene-color: var(--gene-glow);
    }

    /* Horse appearance gene colors */
    :global(.gene-scale-kb) {
        --gene-color: var(--gene-scale-kb);
    }

    :global(.gene-attributes-kb) {
        --gene-color: var(--gene-attributes-kb);
    }

    :global(.gene-selector-sb) {
        --gene-color: var(--gene-selector-sb);
    }

    :global(.gene-selector-pt) {
        --gene-color: var(--gene-selector-pt);
    }

    :global(.gene-selector-po) {
        --gene-color: var(--gene-selector-po);
    }

    :global(.gene-selector-kb) {
        --gene-color: var(--gene-selector-kb);
    }

    :global(.gene-selector-bl) {
        --gene-color: var(--gene-selector-bl);
    }

    :global(.gene-horn) {
        --gene-color: var(--gene-horn);
    }

    :global(.gene-horn-kb) {
        --gene-color: var(--gene-horn-kb);
    }

    :global(.gene-appearance-neutral) {
        --gene-color: var(--gene-appearance-neutral);
    }

    /* Universal patterns for appearance genes */
    :global(.gene-body-color-hue.gene-dominant),
    :global(.gene-body-color-saturation.gene-dominant),
    :global(.gene-body-color-intensity.gene-dominant),
    :global(.gene-wing-color-hue.gene-dominant),
    :global(.gene-wing-color-saturation.gene-dominant),
    :global(.gene-wing-color-intensity.gene-dominant),
    :global(.gene-body-scale.gene-dominant),
    :global(.gene-wing-scale.gene-dominant),
    :global(.gene-head-scale.gene-dominant),
    :global(.gene-tail-scale.gene-dominant),
    :global(.gene-antenna-scale.gene-dominant),
    :global(.gene-leg-deformity.gene-dominant),
    :global(.gene-antenna-deformity.gene-dominant),
    :global(.gene-particles.gene-dominant),
    :global(.gene-particle-location.gene-dominant),
    :global(.gene-glow.gene-dominant),
    :global(.gene-scale-kb.gene-dominant),
    :global(.gene-attributes-kb.gene-dominant),
    :global(.gene-selector-sb.gene-dominant),
    :global(.gene-selector-pt.gene-dominant),
    :global(.gene-selector-po.gene-dominant),
    :global(.gene-selector-kb.gene-dominant),
    :global(.gene-selector-bl.gene-dominant),
    :global(.gene-horn.gene-dominant),
    :global(.gene-horn-kb.gene-dominant),
    :global(.gene-appearance-neutral.gene-dominant) {
        background-color: var(--gene-color);
        border-color: var(--gene-color);
    }

    :global(.gene-body-color-hue.gene-recessive),
    :global(.gene-body-color-saturation.gene-recessive),
    :global(.gene-body-color-intensity.gene-recessive),
    :global(.gene-wing-color-hue.gene-recessive),
    :global(.gene-wing-color-saturation.gene-recessive),
    :global(.gene-wing-color-intensity.gene-recessive),
    :global(.gene-body-scale.gene-recessive),
    :global(.gene-wing-scale.gene-recessive),
    :global(.gene-head-scale.gene-recessive),
    :global(.gene-tail-scale.gene-recessive),
    :global(.gene-antenna-scale.gene-recessive),
    :global(.gene-leg-deformity.gene-recessive),
    :global(.gene-antenna-deformity.gene-recessive),
    :global(.gene-particles.gene-recessive),
    :global(.gene-particle-location.gene-recessive),
    :global(.gene-glow.gene-recessive),
    :global(.gene-scale-kb.gene-recessive),
    :global(.gene-attributes-kb.gene-recessive),
    :global(.gene-selector-sb.gene-recessive),
    :global(.gene-selector-pt.gene-recessive),
    :global(.gene-selector-po.gene-recessive),
    :global(.gene-selector-kb.gene-recessive),
    :global(.gene-selector-bl.gene-recessive),
    :global(.gene-horn.gene-recessive),
    :global(.gene-horn-kb.gene-recessive),
    :global(.gene-appearance-neutral.gene-recessive) {
        border-color: var(--gene-color);
        border-width: 4px;
    }

    :global(.gene-body-color-hue.gene-mixed),
    :global(.gene-body-color-saturation.gene-mixed),
    :global(.gene-body-color-intensity.gene-mixed),
    :global(.gene-wing-color-hue.gene-mixed),
    :global(.gene-wing-color-saturation.gene-mixed),
    :global(.gene-wing-color-intensity.gene-mixed),
    :global(.gene-body-scale.gene-mixed),
    :global(.gene-wing-scale.gene-mixed),
    :global(.gene-head-scale.gene-mixed),
    :global(.gene-tail-scale.gene-mixed),
    :global(.gene-antenna-scale.gene-mixed),
    :global(.gene-leg-deformity.gene-mixed),
    :global(.gene-antenna-deformity.gene-mixed),
    :global(.gene-particles.gene-mixed),
    :global(.gene-particle-location.gene-mixed),
    :global(.gene-glow.gene-mixed),
    :global(.gene-scale-kb.gene-mixed),
    :global(.gene-attributes-kb.gene-mixed),
    :global(.gene-selector-sb.gene-mixed),
    :global(.gene-selector-pt.gene-mixed),
    :global(.gene-selector-po.gene-mixed),
    :global(.gene-selector-kb.gene-mixed),
    :global(.gene-selector-bl.gene-mixed),
    :global(.gene-horn.gene-mixed),
    :global(.gene-horn-kb.gene-mixed),
    :global(.gene-appearance-neutral.gene-mixed) {
        background: linear-gradient(
            135deg,
            transparent 50%,
            var(--gene-color) 50%
        );
        border-color: var(--gene-color);
    }

    /* Individual rgba backgrounds for recessive genes */
    :global(.gene-body-color-hue.gene-recessive) {
        background-color: rgba(255, 152, 0, 0.15);
    }

    :global(.gene-body-color-saturation.gene-recessive) {
        background-color: rgba(255, 111, 0, 0.15);
    }

    :global(.gene-body-color-intensity.gene-recessive) {
        background-color: rgba(255, 204, 2, 0.15);
    }

    :global(.gene-wing-color-hue.gene-recessive) {
        background-color: rgba(33, 150, 243, 0.15);
    }

    :global(.gene-wing-color-saturation.gene-recessive) {
        background-color: rgba(25, 118, 210, 0.15);
    }

    :global(.gene-wing-color-intensity.gene-recessive) {
        background-color: rgba(13, 71, 161, 0.15);
    }

    :global(.gene-body-scale.gene-recessive) {
        background-color: rgba(156, 39, 176, 0.15);
    }

    :global(.gene-wing-scale.gene-recessive) {
        background-color: rgba(123, 31, 162, 0.15);
    }

    :global(.gene-head-scale.gene-recessive) {
        background-color: rgba(142, 36, 170, 0.15);
    }

    :global(.gene-tail-scale.gene-recessive) {
        background-color: rgba(171, 71, 188, 0.15);
    }

    :global(.gene-antenna-scale.gene-recessive) {
        background-color: rgba(186, 104, 200, 0.15);
    }

    :global(.gene-leg-deformity.gene-recessive) {
        background-color: rgba(233, 30, 99, 0.15);
    }

    :global(.gene-antenna-deformity.gene-recessive) {
        background-color: rgba(194, 24, 91, 0.15);
    }

    :global(.gene-particles.gene-recessive) {
        background-color: rgba(0, 188, 212, 0.15);
    }

    :global(.gene-particle-location.gene-recessive) {
        background-color: rgba(0, 151, 167, 0.15);
    }

    :global(.gene-glow.gene-recessive) {
        background-color: rgba(139, 195, 74, 0.15);
    }

    :global(.gene-appearance-neutral.gene-recessive) {
        background-color: rgba(149, 165, 166, 0.15);
    }
</style>
