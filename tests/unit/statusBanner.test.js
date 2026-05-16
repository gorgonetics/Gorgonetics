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

  it('uses role="alert" for errors and role="status" otherwise', () => {
    const { container, rerender } = render(StatusBanner, { type: 'error', message: 'oops' });
    expect(container.querySelector('[data-testid="status-banner"]').getAttribute('role')).toBe('alert');
    rerender({ type: 'info', message: 'fyi' });
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

  it('restarts the timer when the message changes in place', () => {
    // Regression guard for the `onMount`-only timer (commit 5ce4514 →
    // 1d30ec9): PetVisualization updates `shareStatus` on a second
    // share without remounting the toast. The new banner inherited
    // the old countdown and could disappear immediately.
    const onDismiss = vi.fn();
    const { rerender } = render(StatusBanner, {
      type: 'success',
      message: 'First',
      autoDismissMs: 5000,
      onDismiss,
    });
    vi.advanceTimersByTime(3000);
    // Caller swaps the message in place — should re-arm the full 5s timer.
    rerender({ type: 'success', message: 'Second', autoDismissMs: 5000, onDismiss });
    vi.advanceTimersByTime(3000);
    // 3s after the swap (6s overall) — old timer would have fired at 5s.
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    // 5s after the swap — new timer fires now.
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // The "does not restart on onDismiss-identity churn" invariant
  // (the original regression we were defending against) can't be
  // verified through `@testing-library/svelte` v5 rerender, which
  // currently appears to remount the component on every call —
  // erasing the timer-state we'd be probing. The defensive `untrack`
  // around `onDismiss` in the component remains the load-bearing
  // mitigation for inline arrow callbacks in PetVisualization.

  it('clears the timer on unmount (no leak)', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(StatusBanner, { type: 'success', message: 'A', autoDismissMs: 5000, onDismiss });
    vi.advanceTimersByTime(2000);
    unmount();
    vi.advanceTimersByTime(10_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
