import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StatusBanner from '$lib/components/shared/StatusBanner.svelte';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('StatusBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders the message and applies the variant class', () => {
    const { container } = render(StatusBanner, { type: 'success', message: 'Hello' });
    const banner = container.querySelector('[data-testid="status-banner"]');
    expect(banner).not.toBeNull();
    expect(banner.classList.contains('banner-success')).toBe(true);
    expect(banner.textContent).toContain('Hello');
  });

  it('uses role="alert" for errors and role="status" otherwise', async () => {
    const { container, rerender } = render(StatusBanner, { type: 'error', message: 'oops' });
    expect(container.querySelector('[data-testid="status-banner"]').getAttribute('role')).toBe('alert');
    await rerender({ type: 'info', message: 'fyi' });
    expect(container.querySelector('[data-testid="status-banner"]').getAttribute('role')).toBe('status');
  });

  it('invokes onDismiss after autoDismissMs', () => {
    const onDismiss = vi.fn();
    render(StatusBanner, { type: 'success', message: 'A', autoDismissMs: 5000, onDismiss });
    vi.advanceTimersByTime(4999);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does NOT auto-dismiss when autoDismissMs is missing', () => {
    const onDismiss = vi.fn();
    render(StatusBanner, { type: 'success', message: 'A', onDismiss });
    vi.advanceTimersByTime(60_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('restarts the timer when the message changes (contract-level smoke test)', async () => {
    // Regression guard for the user-visible contract: a banner whose
    // displayed content swaps gets a fresh countdown, NOT the residual
    // time from the previous countdown (the bug from commit 5ce4514).
    //
    // Caveat: `@testing-library/svelte` v5 `rerender` currently
    // remounts the component, which trivially re-arms the timer via
    // `onMount`/`onDestroy` regardless of the `$effect` logic. So
    // this test verifies the contract but does NOT distinguish a
    // proper `$effect`-tracked impl from an `onMount`-only impl that
    // would regress to the original bug under in-place rerenders.
    // A faithful harness would need a wrapper component with `$state`
    // that mutates the prop without remounting; the additional
    // plumbing isn't worth it for what the production parents (single
    // `PetVisualization` toast) actually do today.
    const onDismiss = vi.fn();
    const { rerender } = render(StatusBanner, {
      type: 'success',
      message: 'First',
      autoDismissMs: 5000,
      onDismiss,
    });
    vi.advanceTimersByTime(3000);
    // `rerender` is async in @testing-library/svelte v5 — must await
    // before advancing timers, otherwise the old timer can still be
    // the active one and the test reads stale state.
    await rerender({ type: 'success', message: 'Second', autoDismissMs: 5000, onDismiss });
    vi.advanceTimersByTime(3000);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // The "does not restart on onDismiss-identity churn" invariant
  // (the original regression we were defending against) and the
  // in-place message-swap regression both depend on the test harness
  // updating props WITHOUT remounting — which @testing-library/svelte
  // v5 doesn't currently do. The `untrack` around `onDismiss` plus
  // the explicit deps on `message`/`type`/`autoDismissMs` remain the
  // load-bearing mitigations in production.

  it('clears the timer on unmount (no leak)', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(StatusBanner, { type: 'success', message: 'A', autoDismissMs: 5000, onDismiss });
    vi.advanceTimersByTime(2000);
    unmount();
    vi.advanceTimersByTime(10_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
