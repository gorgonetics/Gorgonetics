import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Selection is dispatched via the community store. The component test
// doesn't care about the store's behaviour — just that clicking /
// pressing Enter calls `selectPet(hash)` with the row's contentHash.
const selectPetSpy = vi.fn();
vi.mock('$lib/stores/community.svelte.js', () => ({
  selectPet: (hash) => selectPetSpy(hash),
}));

vi.mock('$lib/utils/timestamp.js', () => ({
  formatShortDate: (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : ''),
}));

import CommunityPetRow from '$lib/components/community/CommunityPetRow.svelte';

afterEach(() => {
  cleanup();
  selectPetSpy.mockReset();
});

function makePet(overrides = {}) {
  return {
    contentHash: 'abc123',
    name: 'Buzz',
    character: 'Player',
    species: 'BeeWasp',
    tags: ['fast'],
    uploadedAt: new Date('2026-05-10T12:00:00Z'),
    ...overrides,
  };
}

describe('CommunityPetRow accessibility', () => {
  it('renders a real <tr> with row semantics (no role="button" override)', () => {
    const { container } = render(CommunityPetRow, { pet: makePet(), selected: false });
    const row = container.querySelector('[data-testid="community-row"]');
    expect(row).not.toBeNull();
    expect(row.tagName).toBe('TR');
    // Regression: an earlier revision applied `role="button"` directly to
    // the `<tr>`, which silently overrode the row's implicit `role="row"`
    // and hid the cells from assistive tech.
    expect(row.getAttribute('role')).toBeNull();
    expect(row.getAttribute('aria-pressed')).toBeNull();
  });

  it('exposes aria-selected reflecting the selected prop', () => {
    const { container, rerender } = render(CommunityPetRow, { pet: makePet(), selected: false });
    let row = container.querySelector('[data-testid="community-row"]');
    expect(row.getAttribute('aria-selected')).toBe('false');

    rerender({ pet: makePet(), selected: true });
    row = container.querySelector('[data-testid="community-row"]');
    expect(row.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the row tabbable so keyboard users can land on it', () => {
    const { container } = render(CommunityPetRow, { pet: makePet(), selected: false });
    const row = container.querySelector('[data-testid="community-row"]');
    expect(row.getAttribute('tabindex')).toBe('0');
  });

  it('invokes selectPet on click and on Enter/Space key', async () => {
    const { container } = render(CommunityPetRow, { pet: makePet({ contentHash: 'xyz' }), selected: false });
    const row = container.querySelector('[data-testid="community-row"]');

    row.click();
    expect(selectPetSpy).toHaveBeenLastCalledWith('xyz');

    // Enter and Space both activate the row (synthesized via the
    // keydown handler — JSDOM doesn't run real default actions).
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(selectPetSpy).toHaveBeenLastCalledWith('xyz');

    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(selectPetSpy).toHaveBeenLastCalledWith('xyz');
    expect(selectPetSpy).toHaveBeenCalledTimes(3);
  });
});
