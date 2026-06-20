<script lang="ts">
import { onDestroy, untrack } from 'svelte';
import type { StatusType } from '$lib/types/index.js';

/**
 * Inline or toast-mode status banner. Colour palette comes from the
 * global `.banner` + `.banner-{type}` rules in `src/app.css` (see the
 * "Shared inline banner" block). Set `toast` to position fixed bottom-
 * right; combine with `autoDismissMs` + `onDismiss` to fade out after a
 * fixed interval.
 *
 * Props:
 *  - `type`         — visual variant
 *  - `message`      — body text
 *  - `toast`        — render fixed bottom-right, with shadow + z-index
 *  - `autoDismissMs`— ms before calling onDismiss; only fires when
 *                     onDismiss is also provided.
 *  - `onDismiss`    — invoked when the auto-dismiss timer elapses (or
 *                     can be wired to a manual close button by callers
 *                     that don't use the timer).
 *
 * The dismiss timer restarts whenever the visible content
 * (`message` / `type` / `autoDismissMs`) changes, so callers that
 * update an already-mounted banner in place (e.g. PetVisualization's
 * `shareStatus` toast on a second share) get a fresh countdown each
 * time. `onDismiss` is read via `untrack` so inline arrow callbacks
 * (which change identity on every parent re-render) don't keep
 * resetting the countdown on their own.
 */
interface Props {
  type: StatusType;
  message: string;
  toast?: boolean;
  autoDismissMs?: number;
  onDismiss?: () => void;
}

const { type, message, toast = false, autoDismissMs, onDismiss }: Props = $props();

let timer: ReturnType<typeof setTimeout> | 0 = 0;

$effect(() => {
  // Depend explicitly on the user-visible content so an in-place
  // message swap re-arms the timer; the `untrack` around the
  // `onDismiss` read keeps it OUT of the effect's tracked deps so
  // parents passing an inline arrow (`onDismiss={() => …}`) don't
  // re-fire the effect — and clear the timer — on every parent
  // re-render. The callback that eventually fires is whatever
  // `onDismiss` resolved to at `setTimeout` install time; Svelte 5
  // destructured props are reactive, so a subsequent prop swap could
  // in principle be picked up by reading `onDismiss` inside a closure
  // at fire time, but that's not the trade-off we want here — the
  // identity-stable closure is what makes the timer countdown
  // predictable.
  void message;
  void type;
  void autoDismissMs;
  clearTimeout(timer);
  untrack(() => {
    if (autoDismissMs && onDismiss) {
      timer = setTimeout(onDismiss, autoDismissMs);
    }
  });
});

onDestroy(() => clearTimeout(timer));
</script>

<div
  class="banner banner-{type}"
  class:banner-toast={toast}
  role={type === 'error' ? 'alert' : 'status'}
  data-testid="status-banner"
>
  {message}
</div>

<style>
  /* Floating toast: solid background under the variant's coloured
     border so the toast stays readable over arbitrary page content.
     The `.banner.banner-toast` selector beats the single-class
     `.banner-success` / `.banner-info` / … rules in `app.css`, so the
     solid bg wins regardless of stylesheet load order. Inline banners
     keep their translucent variant tint — they sit on a known pane
     background where the tint reads correctly. */
  :global(.banner.banner-toast) {
    position: fixed;
    bottom: 24px;
    right: 24px;
    max-width: 420px;
    margin: 0;
    background: var(--bg-secondary);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    z-index: 1000;
  }
</style>
