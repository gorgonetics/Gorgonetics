/**
 * Keyboard navigation utilities for composite widgets.
 * Implements roving tabindex pattern for lists and grids.
 */

/**
 * Handles arrow-key navigation within a list of elements (roving tabindex).
 * Call from the container's keydown handler.
 *
 * @param items - Array of focusable HTMLElements
 * @param currentIndex - Index of the currently focused item
 * @param event - The keyboard event
 * @param options - Navigation options
 * @returns The new index after navigation, or -1 if the key was not handled
 */
export function handleListNavigation(
  items: HTMLElement[],
  currentIndex: number,
  event: KeyboardEvent,
  options: { orientation?: 'vertical' | 'horizontal'; wrap?: boolean } = {},
): number {
  const { orientation = 'vertical', wrap = true } = options;
  const len = items.length;
  if (len === 0) return -1;

  const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
  const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';

  let newIndex = -1;

  if (event.key === nextKey) {
    event.preventDefault();
    newIndex = currentIndex + 1;
    if (newIndex >= len) newIndex = wrap ? 0 : len - 1;
  } else if (event.key === prevKey) {
    event.preventDefault();
    newIndex = currentIndex - 1;
    if (newIndex < 0) newIndex = wrap ? len - 1 : 0;
  } else if (event.key === 'Home') {
    event.preventDefault();
    newIndex = 0;
  } else if (event.key === 'End') {
    event.preventDefault();
    newIndex = len - 1;
  }

  if (newIndex >= 0 && newIndex < len) {
    // Roving tabindex: deactivate old, activate new
    items[currentIndex]?.setAttribute('tabindex', '-1');
    items[newIndex].setAttribute('tabindex', '0');
    items[newIndex].focus();
  }

  return newIndex;
}

/**
 * Handles arrow-key navigation within a 2D grid of elements.
 * Elements should be laid out in row-major order.
 */
export function handleGridNavigation(
  items: HTMLElement[],
  currentIndex: number,
  event: KeyboardEvent,
  columns: number,
): number {
  const len = items.length;
  if (len === 0) return -1;

  let newIndex = -1;

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    newIndex = currentIndex + 1;
    if (newIndex >= len) newIndex = currentIndex;
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    newIndex = currentIndex - 1;
    if (newIndex < 0) newIndex = 0;
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    newIndex = currentIndex + columns;
    if (newIndex >= len) newIndex = currentIndex;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    newIndex = currentIndex - columns;
    if (newIndex < 0) newIndex = currentIndex;
  } else if (event.key === 'Home') {
    event.preventDefault();
    newIndex = 0;
  } else if (event.key === 'End') {
    event.preventDefault();
    newIndex = len - 1;
  }

  if (newIndex >= 0 && newIndex !== currentIndex) {
    items[currentIndex]?.setAttribute('tabindex', '-1');
    items[newIndex].setAttribute('tabindex', '0');
    items[newIndex].focus();
  }

  return newIndex;
}
