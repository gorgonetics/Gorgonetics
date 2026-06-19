/**
 * Pure select/hide reducers for the grid filter legends.
 *
 * The genome grids drive their filters with click modifiers: a plain click
 * sets a single selection (or clears it on a second click), Ctrl toggles a
 * multi-select, Alt toggles a hide. Two distinct reducers exist because the
 * two grids were written independently and their tri-state semantics differ
 * (see `triStateToggle` vs `resolveFilterClick`); both are extracted here so
 * they can be unit-tested rather than living as closures inside components.
 */

/** A `{ selected, hidden }` filter pair. */
export interface FilterPair {
  selected: string[];
  hidden: string[];
}

/**
 * Low-level reducer used by `GeneVisualizer`. Applies one `action` to a key,
 * keeping the selected/hidden lists mutually exclusive.
 *
 * Actions:
 * - `select` / `toggle-select`: move into (or out of) the selected list
 * - `hide` / `toggle-hide`: move into (or out of) the hidden list
 *
 * `select`/`toggle-select` on a currently-hidden key (and the hide variants on
 * a currently-selected key) drop it from both lists.
 */
export function toggleFilterState(selectedArr: string[], hiddenArr: string[], key: string, action: string): FilterPair {
  const isSelected = selectedArr.includes(key);
  const isHidden = hiddenArr.includes(key);

  if (
    (action === 'select' && isHidden) ||
    (action === 'hide' && isSelected) ||
    (action === 'toggle-select' && isHidden) ||
    (action === 'toggle-hide' && isSelected)
  ) {
    return {
      selected: selectedArr.filter((k) => k !== key),
      hidden: hiddenArr.filter((k) => k !== key),
    };
  }

  if (action === 'select' || action === 'toggle-select') {
    if (isSelected) {
      return { selected: selectedArr.filter((k) => k !== key), hidden: hiddenArr };
    }
    return { selected: [...selectedArr, key], hidden: hiddenArr.filter((k) => k !== key) };
  }

  if (action === 'hide' || action === 'toggle-hide') {
    if (isHidden) {
      return { selected: selectedArr, hidden: hiddenArr.filter((k) => k !== key) };
    }
    return { selected: selectedArr.filter((k) => k !== key), hidden: [...hiddenArr, key] };
  }

  return { selected: selectedArr, hidden: hiddenArr };
}

/**
 * Resolve a legend click into the next filter pair for `GeneVisualizer`. This
 * is the decision core shared by the attribute / effect / value legend
 * handlers (the only difference between them was the variable names and a
 * value-name remap done by the caller).
 *
 * - Alt: toggle the key's hidden state
 * - Ctrl: toggle the key's selected state
 * - plain click: select the key alone, or clear it if it was the sole
 *   selection; clicking a hidden key un-hides it
 */
export function resolveFilterClick(
  selectedArr: string[],
  hiddenArr: string[],
  key: string,
  ctrlKey: boolean,
  altKey: boolean,
): FilterPair {
  if (altKey) {
    return toggleFilterState(selectedArr, hiddenArr, key, 'toggle-hide');
  }
  if (ctrlKey) {
    return toggleFilterState(selectedArr, hiddenArr, key, 'toggle-select');
  }
  if (hiddenArr.includes(key)) {
    return toggleFilterState([], hiddenArr, key, 'toggle-select');
  }
  if (selectedArr.length === 1 && selectedArr[0] === key) {
    return { selected: [], hidden: hiddenArr.filter((k) => k !== key) };
  }
  return { selected: [key], hidden: hiddenArr.filter((k) => k !== key) };
}

/**
 * Tri-state reducer used by `GenomeGridDiff`. Distinct from `toggleFilterState`
 * in that Alt toggles hidden *membership* directly (a selected key becomes
 * hidden), rather than dropping the key from both lists.
 *
 * - Alt: toggle the key in the hidden list, always removing it from selected
 * - Ctrl: toggle the key in the selected list, removing it from hidden
 * - plain click: select the key alone, or clear it if it was the sole
 *   selection, removing it from hidden either way
 */
export function triStateToggle(
  key: string,
  selected: string[],
  hidden: string[],
  ctrlKey: boolean,
  altKey: boolean,
): FilterPair {
  if (altKey) {
    const nextHidden = hidden.includes(key)
      ? hidden.filter((k) => k !== key)
      : [...hidden.filter((k) => k !== key), key];
    return { selected: selected.filter((k) => k !== key), hidden: nextHidden };
  }
  if (ctrlKey) {
    const nextSelected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    return { selected: nextSelected, hidden: hidden.filter((k) => k !== key) };
  }
  const nextSelected = selected.length === 1 && selected[0] === key ? [] : [key];
  return { selected: nextSelected, hidden: hidden.filter((k) => k !== key) };
}
