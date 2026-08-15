<script lang="ts">
interface Props {
  visible?: boolean;
  x?: number;
  y?: number;
  geneId?: string;
  geneType?: string;
  effect?: string;
  potentialEffects?: string[];
  /** Optional muted line under the header (e.g. the attribute name). */
  subtitle?: string;
  /** Heading for the list section; defaults to "Potential Effects". */
  effectsLabel?: string;
  /**
   * Whether to tint each line green/red by sniffing it for `+` / `-`.
   *
   * On by default, because the attribute/appearance views pass plain effect
   * strings and rely on it. The rarity card must switch it **off**: its lines
   * already colour their own spans, and each carries an effect name — so
   * sniffing would tint the whole row, putting valence red on the frequency
   * figure. Keeping "rare" and "good" in separate colours is the entire reason
   * that view uses purple/orange rather than green/red.
   */
  valenceFromText?: boolean;
}

const {
  visible = false,
  x = 0,
  y = 0,
  geneId = '',
  geneType = '',
  effect = '',
  potentialEffects = [],
  subtitle = '',
  effectsLabel = 'Potential Effects',
  valenceFromText = true,
}: Props = $props();

function getTypeDescription(type: string) {
  switch (type) {
    case 'R':
      return 'Recessive';
    case 'D':
      return 'Dominant';
    case 'x':
      return 'Mixed (treated as dominant)';
    case '?':
      return 'Unknown';
    default:
      return 'Unknown';
  }
}
</script>

{#if visible}
    <div class="gene-tooltip" style="left: {x}px; top: {y}px;">
        <div class="tooltip-header">
            <strong>Gene {geneId}</strong>
            {#if subtitle}<div class="tooltip-subtitle">{subtitle}</div>{/if}
        </div>
        <div class="tooltip-content">
            {#if geneType}
                <div class="gene-type">Type: {getTypeDescription(geneType)}</div>
            {/if}
            {#if effect}
                <div class="current-effect">
                    <strong
                        >Current Effect: <span
                            class:positive={effect.includes("+")}
                            class:negative={effect.includes("-")}>{effect}</span
                        ></strong
                    >
                </div>
            {/if}
            {#if potentialEffects.length > 0}
                <div class="potential-effects">
                    <strong>{effectsLabel}:</strong>
                    {#each potentialEffects as potentialEffect, i (i)}
                        <div
                            class="potential-effect"
                            class:positive={valenceFromText && potentialEffect.includes("+")}
                            class:negative={valenceFromText && potentialEffect.includes("-")}
                        >
                            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
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
        position: fixed;
        background: #1f2937;
        color: white;
        padding: var(--space-sm) var(--space-lg);
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
        margin-bottom: var(--space-2xs);
    }

    .tooltip-header strong {
        color: #60a5fa;
        font-weight: 600;
    }

    .tooltip-subtitle {
        color: #9ca3af;
        font-size: 11px;
        margin-top: 1px;
    }

    .tooltip-content {
        display: flex;
        flex-direction: column;
        gap: var(--space-3xs);
    }

    .gene-type {
        color: #d1d5db;
        font-size: 11px;
    }

    .current-effect {
        margin: var(--space-3xs) 0;
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
        margin-top: var(--space-2xs);
        padding-top: var(--space-2xs);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }

    .potential-effects strong {
        color: #a78bfa;
        font-size: 11px;
        display: block;
        margin-bottom: var(--space-3xs);
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
