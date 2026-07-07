import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DetailOverlayHarness from '../fixtures/DetailOverlayHarness.svelte';

// DetailOverlay's Escape handling is a document-level listener scoped to the
// topmost mounted overlay (#396): it must fire even when focus rests on
// document.body (a section-scoped handler misses that), stacked overlays must
// unwind one per press, and an open true-modal (.modal-backdrop) owns Escape.

afterEach(cleanup);

const pressEscape = () => fireEvent.keyDown(document.body, { key: 'Escape' });

describe('DetailOverlay Escape handling', () => {
  it('backs out when Escape is pressed with focus on document.body', async () => {
    const onBackA = vi.fn();
    render(DetailOverlayHarness, { onBackA } as never);

    // Simulate focus having drifted to the body (e.g. after a click on
    // non-focusable overlay content).
    (document.activeElement as HTMLElement | null)?.blur?.();
    await pressEscape();
    expect(onBackA).toHaveBeenCalledTimes(1);
  });

  it('only the topmost of stacked overlays backs out per press', async () => {
    const onBackA = vi.fn();
    const onBackB = vi.fn();
    const { rerender } = render(DetailOverlayHarness, { onBackA, onBackB, showB: true } as never);

    await pressEscape();
    expect(onBackB).toHaveBeenCalledTimes(1);
    expect(onBackA).not.toHaveBeenCalled();

    // Once the top overlay unmounts, the one beneath becomes topmost.
    await rerender({ onBackA, onBackB, showB: false });
    await pressEscape();
    expect(onBackA).toHaveBeenCalledTimes(1);
    expect(onBackB).toHaveBeenCalledTimes(1);
  });

  it('defers to an open .modal-backdrop true-modal', async () => {
    const onBackA = vi.fn();
    const { rerender } = render(DetailOverlayHarness, { onBackA, showModal: true } as never);

    await pressEscape();
    expect(onBackA).not.toHaveBeenCalled();

    // With the modal gone, Escape reaches the overlay again.
    await rerender({ onBackA, showModal: false });
    await pressEscape();
    expect(onBackA).toHaveBeenCalledTimes(1);
  });

  it('ignores non-Escape keys', async () => {
    const onBackA = vi.fn();
    render(DetailOverlayHarness, { onBackA } as never);

    await fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onBackA).not.toHaveBeenCalled();
  });

  it('removes its document listener on unmount', async () => {
    const onBackA = vi.fn();
    const { unmount } = render(DetailOverlayHarness, { onBackA } as never);

    unmount();
    await pressEscape();
    expect(onBackA).not.toHaveBeenCalled();
  });
});
