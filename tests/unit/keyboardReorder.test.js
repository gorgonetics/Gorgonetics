import { beforeEach, describe, expect, it, vi } from 'vitest';
import { arrayMove, createKeyboardReorder, moveByFilteredIndex } from '$lib/utils/dragReorder.svelte.js';

// Fake keyboard event with the only two methods the helper calls.
function key(k) {
  return { key: k, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

describe('createKeyboardReorder', () => {
  let items;
  let persist;
  let announce;
  let focusItem;
  let kb;

  beforeEach(() => {
    items = ['Alpha', 'Bravo', 'Charlie'];
    persist = vi.fn().mockResolvedValue(undefined);
    announce = vi.fn();
    focusItem = vi.fn();
    kb = createKeyboardReorder({
      count: () => items.length,
      reorder: (from, to) => {
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
      },
      persist,
      focusItem,
      snapshot: () => [...items],
      restore: (snap) => {
        items = snap;
      },
      label: (i) => items[i],
      announce,
    });
  });

  it('grabs on Space, exposing grabbedIndex without mutating or persisting', async () => {
    await kb.handleKeydown(key(' '), 1);
    expect(kb.grabbedIndex).toBe(1);
    expect(kb.isGrabbed(1)).toBe(true);
    expect(items).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(persist).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('moves the grabbed item with ArrowDown and tracks the new index, deferring persist to drop', async () => {
    await kb.handleKeydown(key(' '), 0); // grab Alpha
    await kb.handleKeydown(key('ArrowDown'), 0);
    expect(items).toEqual(['Bravo', 'Alpha', 'Charlie']);
    expect(kb.grabbedIndex).toBe(1);
    expect(focusItem).toHaveBeenCalledWith(1); // focus follows the moved handle
    expect(persist).not.toHaveBeenCalled();

    await kb.handleKeydown(key(' '), 1); // drop
    expect(kb.grabbedIndex).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not move past the last position', async () => {
    await kb.handleKeydown(key(' '), 2); // grab Charlie (last)
    await kb.handleKeydown(key('ArrowDown'), 2);
    expect(items).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(kb.grabbedIndex).toBe(2);
  });

  it('does not move past the first position', async () => {
    await kb.handleKeydown(key(' '), 0); // grab Alpha (first)
    await kb.handleKeydown(key('ArrowUp'), 0);
    expect(items).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(kb.grabbedIndex).toBe(0);
  });

  it('Escape restores the original position and does not persist', async () => {
    await kb.handleKeydown(key(' '), 0); // grab Alpha
    await kb.handleKeydown(key('ArrowDown'), 0); // -> [Bravo, Alpha, Charlie]
    await kb.handleKeydown(key('ArrowDown'), 1); // -> [Bravo, Charlie, Alpha]
    expect(items).toEqual(['Bravo', 'Charlie', 'Alpha']);

    await kb.handleKeydown(key('Escape'), 2);
    expect(items).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(kb.grabbedIndex).toBeNull();
    expect(persist).not.toHaveBeenCalled();
  });

  it('ignores arrow keys when nothing is grabbed', async () => {
    await kb.handleKeydown(key('ArrowDown'), 0);
    expect(items).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(kb.grabbedIndex).toBeNull();
  });

  it('drop without movement does not persist', async () => {
    await kb.handleKeydown(key(' '), 1); // grab
    await kb.handleKeydown(key(' '), 1); // drop, unmoved
    expect(persist).not.toHaveBeenCalled();
  });

  it('rolls back to the pre-grab order when persist fails', async () => {
    persist.mockRejectedValueOnce(new Error('db down'));
    await kb.handleKeydown(key(' '), 0); // grab Alpha
    await kb.handleKeydown(key('ArrowDown'), 0); // optimistic -> [Bravo, Alpha, Charlie]
    expect(items).toEqual(['Bravo', 'Alpha', 'Charlie']);

    await kb.handleKeydown(key(' '), 1); // drop -> persist rejects -> restore snapshot
    expect(items).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('blur commits a moved item', async () => {
    await kb.handleKeydown(key(' '), 0);
    await kb.handleKeydown(key('ArrowDown'), 0);
    await kb.handleBlur();
    expect(kb.grabbedIndex).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('prevents default and stops propagation for handled keys so they do not bubble', async () => {
    const grab = key(' ');
    await kb.handleKeydown(grab, 0);
    expect(grab.preventDefault).toHaveBeenCalled();
    expect(grab.stopPropagation).toHaveBeenCalled();

    const move = key('ArrowDown');
    await kb.handleKeydown(move, 0);
    expect(move.preventDefault).toHaveBeenCalled();
  });

  it('announces a restore (not a successful drop) when persist fails on drop', async () => {
    persist.mockRejectedValueOnce(new Error('db down'));
    await kb.handleKeydown(key(' '), 0);
    await kb.handleKeydown(key('ArrowDown'), 0);
    announce.mockClear();
    await kb.handleKeydown(key(' '), 1); // drop -> persist rejects
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/restored/i));
    expect(announce).not.toHaveBeenCalledWith(expect.stringMatching(/^Dropped/));
  });

  it('announces the drop on blur-commit (not silent for screen readers)', async () => {
    await kb.handleKeydown(key(' '), 0);
    await kb.handleKeydown(key('ArrowDown'), 0);
    announce.mockClear();
    await kb.handleBlur();
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^Dropped/));
  });
});

describe('moveByFilteredIndex', () => {
  const id = (x) => x.id;
  const full = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('matches arrayMove when the view is the full list', () => {
    const out = moveByFilteredIndex(full, full, 0, 1, id);
    expect(out.map(id)).toEqual(arrayMove(full, 0, 1).map(id));
    expect(out.map(id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('reorders the FULL list correctly when the view is a filtered subset', () => {
    // View hides 'b' and 'd' (e.g. a marker filter): view = [a, c].
    const view = [full[0], full[2]];
    // Move 'a' (view idx 0) down past 'c' (view idx 1): 'a' should land just
    // after 'c' in the full list, NOT swap with 'b'.
    const out = moveByFilteredIndex(full, view, 0, 1, id);
    expect(out.map(id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moving up in a filtered view places the item before the target in the full list', () => {
    const view = [full[0], full[2]]; // [a, c]
    // Move 'c' (view idx 1) up above 'a' (view idx 0).
    const out = moveByFilteredIndex(full, view, 1, 0, id);
    expect(out.map(id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('returns the original list when indices do not resolve', () => {
    expect(moveByFilteredIndex(full, [], 0, 1, id)).toBe(full);
  });
});
