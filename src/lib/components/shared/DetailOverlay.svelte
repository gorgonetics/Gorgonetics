<script lang="ts" module>
/**
 * Stack of currently-mounted overlays, bottom → top. Escape is handled by a
 * document-level listener (so it works no matter where focus sits — e.g. on
 * document.body after a click on non-focusable content), but only the topmost
 * overlay backs out, so stacked lenses (Settings opened over a pet detail)
 * unwind one per press.
 */
const overlayStack: symbol[] = [];
</script>

<script lang="ts">
/**
 * The unified full-view shell for the Workspace's detail lenses — single pet,
 * Compare (2-pet diff), and the offspring Trio. A full-screen overlay (covers
 * the still-mounted table/list underneath, preserving its scroll) with a
 * back-button header and a body. Replaces the trio's bespoke modal popup so all
 * three detail views share one presentation.
 * See docs/design/redesign-library-workspace-v1.md (§3, component unification).
 *
 * These are deliberately *non-modal* in-tab lenses (you can still switch tabs),
 * not dialogs — so this is a `region` landmark, not `role="dialog"`. It still
 * manages keyboard affordances: focus lands inside on open and is restored to
 * the trigger on close, and Escape backs out. A true modal layered on top
 * (the delete-confirm dialog) keeps its own focus trap + Escape; the Escape
 * handler here defers to it so it can't double-close. (Settings and the pet
 * editor are themselves in-space DetailOverlays mounted at the page root, not
 * modals nested here.)
 *
 * Position: absolute/inset:0, so it covers its nearest positioned ancestor —
 * mount it inside a `position: relative` (or absolute) container.
 */
import type { Snippet } from 'svelte';
import { onMount } from 'svelte';

interface Props {
  /** Back out of the detail view (back button / Escape). */
  onBack: () => void;
  /** Visible back-button text (e.g. "← Pets", "← Pairs"). */
  backLabel?: string;
  /** Accessible name for the region landmark (e.g. "Offspring trio"). */
  ariaLabel?: string;
  /** testid for the overlay root, so callers keep their existing hooks. */
  testid?: string;
  /** testid for the back button. */
  backTestid?: string;
  /** Header title content (plain text, or rich markup like the trio cross). */
  title: Snippet;
  /** The lens body (PetVisualization / GenomeGridDiff / GenomeGridTrio …). */
  children: Snippet;
}

const {
  onBack,
  backLabel = '← Back',
  ariaLabel = 'Detail view',
  testid,
  backTestid,
  title,
  children,
}: Props = $props();

let sectionEl = $state<HTMLElement | null>(null);
let backBtn = $state<HTMLButtonElement | null>(null);

const stackId = Symbol('detail-overlay');

onMount(() => {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  overlayStack.push(stackId);

  // Make the covered UI inert: the overlay sits over its siblings (the
  // table/list), so keyboard focus and assistive tech must not reach controls
  // hidden behind it. Scoped to siblings, so nested modals (PetEditor /
  // delete-confirm) — which are our descendants — stay interactive, and the top
  // nav — a sibling of our *container*, not ours — stays reachable (these are
  // non-modal in-tab lenses by design).
  const covered: Element[] = [];
  for (const sib of sectionEl?.parentElement?.children ?? []) {
    if (sib !== sectionEl && !sib.hasAttribute('inert')) {
      sib.setAttribute('inert', '');
      covered.push(sib);
    }
  }

  // Land focus inside the overlay so keyboard / SR users start in the lens.
  backBtn?.focus();

  return () => {
    const idx = overlayStack.indexOf(stackId);
    if (idx !== -1) overlayStack.splice(idx, 1);
    for (const sib of covered) sib.removeAttribute('inert');
    previouslyFocused?.focus();
  };
});

// Document-level so Escape backs out regardless of where focus is (a section
// -scoped handler misses it when focus rests on document.body). Scoped to the
// topmost mounted overlay via the module-level stack.
function handleDocumentKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (overlayStack[overlayStack.length - 1] !== stackId) return;
  // Defer to an open true-modal (delete/discard confirms, import dialogs —
  // anything on a .modal-backdrop): it owns its own Escape, so don't also
  // tear down the lens underneath it.
  if (document.querySelector('.modal-backdrop')) return;
  // The modal's own Escape handler may already have torn it down earlier in
  // this same event's bubble path (Svelte flushes the removal synchronously),
  // so the live-DOM check above misses it. The event target still sits in the
  // detached subtree, and `closest` walks detached trees — if this Escape was
  // aimed at a modal, it's consumed, not a back-out of the lens beneath.
  if ((e.target as HTMLElement | null)?.closest?.('.modal-backdrop')) return;
  onBack();
}
</script>

<svelte:document onkeydown={handleDocumentKeydown} />

<!-- A <section> with an accessible name is already a `region` landmark. -->
<section
  bind:this={sectionEl}
  class="detail-overlay"
  data-testid={testid}
  aria-label={ariaLabel}
  tabindex="-1"
>
  <header class="do-head">
    <button bind:this={backBtn} type="button" class="back-btn" data-testid={backTestid} onclick={onBack}>
      {backLabel}
    </button>
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
  /* Landmark is focusable for Escape/focus-on-open but shows no focus ring. */
  .detail-overlay:focus { outline: none; }
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
