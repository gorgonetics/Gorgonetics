import { describe, expect, it } from 'vitest';
import { resolveFilterClick, toggleFilterState, triStateToggle } from '$lib/utils/filterToggle.js';

describe('toggleFilterState', () => {
  it('selects an unselected key', () => {
    expect(toggleFilterState([], [], 'a', 'select')).toEqual({ selected: ['a'], hidden: [] });
  });

  it('toggle-select removes an already-selected key', () => {
    expect(toggleFilterState(['a'], [], 'a', 'toggle-select')).toEqual({ selected: [], hidden: [] });
  });

  it('selecting a hidden key drops it from both lists', () => {
    expect(toggleFilterState([], ['a'], 'a', 'select')).toEqual({ selected: [], hidden: [] });
  });

  it('hides an un-hidden key, removing it from selected', () => {
    expect(toggleFilterState(['a'], [], 'a', 'hide')).toEqual({ selected: [], hidden: [] });
    expect(toggleFilterState([], [], 'a', 'toggle-hide')).toEqual({ selected: [], hidden: ['a'] });
  });

  it('returns the inputs unchanged for an unknown action', () => {
    expect(toggleFilterState(['a'], ['b'], 'c', 'bogus')).toEqual({ selected: ['a'], hidden: ['b'] });
  });
});

describe('resolveFilterClick', () => {
  it('plain click selects a key alone', () => {
    expect(resolveFilterClick(['x'], [], 'a', false, false)).toEqual({ selected: ['a'], hidden: [] });
  });

  it('plain click on the sole selection clears it', () => {
    expect(resolveFilterClick(['a'], [], 'a', false, false)).toEqual({ selected: [], hidden: [] });
  });

  it('plain click on a hidden key un-hides it', () => {
    expect(resolveFilterClick([], ['a'], 'a', false, false)).toEqual({ selected: [], hidden: [] });
  });

  it('ctrl click toggles multi-select', () => {
    expect(resolveFilterClick(['a'], [], 'b', true, false)).toEqual({ selected: ['a', 'b'], hidden: [] });
  });

  it('alt click toggles hide', () => {
    expect(resolveFilterClick([], [], 'a', false, true)).toEqual({ selected: [], hidden: ['a'] });
  });
});

describe('triStateToggle', () => {
  it('plain click selects a key alone', () => {
    expect(triStateToggle('a', ['x'], [], false, false)).toEqual({ selected: ['a'], hidden: [] });
  });

  it('plain click on the sole selection clears it', () => {
    expect(triStateToggle('a', ['a'], [], false, false)).toEqual({ selected: [], hidden: [] });
  });

  it('ctrl click toggles multi-select', () => {
    expect(triStateToggle('b', ['a'], [], true, false)).toEqual({ selected: ['a', 'b'], hidden: [] });
    expect(triStateToggle('a', ['a', 'b'], [], true, false)).toEqual({ selected: ['b'], hidden: [] });
  });

  it('alt click moves a selected key into hidden (unlike toggleFilterState)', () => {
    // toggleFilterState would drop the key from both lists here; triStateToggle hides it.
    expect(triStateToggle('a', ['a'], [], false, true)).toEqual({ selected: [], hidden: ['a'] });
  });

  it('alt click un-hides an already-hidden key', () => {
    expect(triStateToggle('a', [], ['a'], false, true)).toEqual({ selected: [], hidden: [] });
  });
});
