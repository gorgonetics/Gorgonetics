/**
 * Focus trap utility for modals and dialogs.
 * Traps Tab focus within a container and restores focus on cleanup.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden')) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
}

/**
 * Activates a focus trap on the given element.
 * Returns a cleanup function that removes the trap and restores focus.
 */
export function createFocusTrap(container: HTMLElement): () => void {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  // Focus the container itself or the first focusable child
  const focusable = getFocusableElements(container);
  if (focusable.length > 0) {
    focusable[0].focus();
  } else {
    container.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;

    const elements = getFocusableElements(container);
    if (elements.length === 0) {
      e.preventDefault();
      return;
    }

    const first = elements[0];
    const last = elements[elements.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  container.addEventListener('keydown', handleKeydown);

  return () => {
    container.removeEventListener('keydown', handleKeydown);
    previouslyFocused?.focus();
  };
}

/**
 * Svelte action that applies a focus trap for the lifetime of the element.
 * Usage: <div use:focusTrap>
 */
export function focusTrap(node: HTMLElement) {
  const cleanup = createFocusTrap(node);
  return { destroy: cleanup };
}
