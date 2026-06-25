<script lang="ts">
/**
 * The unified full-view shell for the Workspace's detail lenses — single pet,
 * Compare (2-pet diff), and the offspring Trio. A full-screen overlay (covers
 * the still-mounted table/list underneath, preserving its scroll) with a
 * back-button header and a body. Replaces the trio's bespoke modal popup so all
 * three detail views share one presentation.
 * See docs/design/redesign-library-workspace-v1.md (§3, component unification).
 *
 * Position: absolute/inset:0, so it covers its nearest positioned ancestor —
 * mount it inside a `position: relative` (or absolute) container.
 */
import type { Snippet } from 'svelte';

interface Props {
  /** Back out of the detail view (back button click). */
  onBack: () => void;
  /** Visible back-button text (e.g. "← Pets", "← Pairs"). */
  backLabel?: string;
  /** Accessible name for the back button; defaults to the visible label. */
  backAriaLabel?: string;
  /** testid for the overlay root, so callers keep their existing hooks. */
  testid?: string;
  /** testid for the back button. */
  backTestid?: string;
  /** Header title content (plain text, or rich markup like the trio cross). */
  title: Snippet;
  /** The lens body (PetVisualization / GenomeGridDiff / GenomeGridTrio …). */
  children: Snippet;
}

const { onBack, backLabel = '← Back', backAriaLabel, testid, backTestid, title, children }: Props = $props();
</script>

<section class="detail-overlay" data-testid={testid}>
  <header class="do-head">
    <button
      type="button"
      class="back-btn"
      data-testid={backTestid}
      aria-label={backAriaLabel ?? backLabel}
      onclick={onBack}
    >{backLabel}</button>
    <span class="do-title">{@render title()}</span>
  </header>
  <div class="do-body">{@render children()}</div>
</section>

<style>
  .detail-overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    background: var(--bg-primary);
    display: flex;
    flex-direction: column;
  }
  .do-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }
  .do-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .back-btn {
    padding: 5px 12px;
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .back-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
  .do-body { flex: 1; min-height: 0; overflow: hidden; display: flex; }
</style>
