import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeyboardReorder } from '$lib/utils/dragReorder.svelte.js';

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
});
