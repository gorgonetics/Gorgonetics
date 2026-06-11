import { tick } from 'svelte';

/**
 * Shared drag-and-drop reorder state and handlers.
 * Components provide their own handleDrop since the reorder logic differs
 * (PetList resolves through a filtered list, gallery operates on a flat array).
 */
export function createDragState() {
  let draggedIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);

  return {
    get draggedIndex() {
      return draggedIndex;
    },
    set draggedIndex(v: number | null) {
      draggedIndex = v;
    },
    get dragOverIndex() {
      return dragOverIndex;
    },
    set dragOverIndex(v: number | null) {
      dragOverIndex = v;
    },

    handleDragStart(e: DragEvent, index: number) {
      draggedIndex = index;
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    },

    handleDragOver(e: DragEvent, index: number) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      dragOverIndex = index;
    },

    handleDragLeave() {
      dragOverIndex = null;
    },

    handleDragEnd() {
      draggedIndex = null;
      dragOverIndex = null;
    },
  };
}

export interface KeyboardReorderOptions {
  /** Current number of reorderable items. */
  count: () => number;
  /** Move the item at `from` to `to` in the in-memory list (no persistence). */
  reorder: (from: number, to: number) => void;
  /** Persist the current order. Called once on drop, only if the item moved. */
  persist: () => void | Promise<void>;
  /** Focus the reorder handle at `index` (called after the DOM settles so the
   * moved item keeps focus across a keyed `{#each}` reorder). */
  focusItem: (index: number) => void;
  /** Snapshot the pre-grab order so a failed persist() can roll back. */
  onGrab?: () => void;
  /** Human label for the item at `index`, used in screen-reader announcements. */
  label: (index: number) => string;
  /** Emit a message; wire to an aria-live region. */
  announce: (message: string) => void;
}

/**
 * Keyboard-accessible reordering (#105) — the a11y counterpart to
 * `createDragState`, driven by a focusable reorder handle per item:
 *
 *   - Space / Enter   grab the item, or drop it if already grabbed
 *   - ArrowUp / Down  (while grabbed) move the item one slot
 *   - Escape          (while grabbed) cancel and restore the original position
 *   - blur            (while grabbed) commit at the current position
 *
 * Tab moves between handles natively (every handle is tabbable). Arrow keys do
 * nothing until an item is grabbed, so they never fight native focus movement.
 *
 * A keyed `{#each}` reorder detaches the focused handle, which fires `blur`
 * (and would otherwise drop the grab after one move). We suppress that
 * transient blur and re-focus the handle at its new index once the DOM settles
 * (`tick`), so a grab survives repeated arrow presses. The component supplies
 * the list mutation, persistence, focus and labels so this stays list-shape
 * agnostic.
 */
export function createKeyboardReorder(opts: KeyboardReorderOptions) {
  let grabbedIndex = $state<number | null>(null);
  let originIndex: number | null = null;
  // Guards the blur that a keyed reorder fires while we relocate focus.
  let suppressBlur = false;

  /** Reorder in place, then keep focus on the moved handle after the DOM updates. */
  async function moveGrabbed(from: number, to: number) {
    suppressBlur = true;
    opts.reorder(from, to);
    grabbedIndex = to;
    await tick();
    opts.focusItem(to);
    suppressBlur = false;
  }

  async function drop(): Promise<number | null> {
    if (grabbedIndex === null) return null;
    const moved = grabbedIndex !== originIndex;
    const at = grabbedIndex;
    grabbedIndex = null;
    originIndex = null;
    if (moved) await opts.persist();
    return at;
  }

  return {
    get grabbedIndex() {
      return grabbedIndex;
    },
    isGrabbed(index: number) {
      return grabbedIndex === index;
    },

    async handleKeydown(e: KeyboardEvent, index: number) {
      const count = opts.count();
      if (count <= 0) return;

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (grabbedIndex === null) {
          grabbedIndex = index;
          originIndex = index;
          opts.onGrab?.();
          opts.announce(
            `Grabbed ${opts.label(index)}, position ${index + 1} of ${count}. ` +
              'Use up and down arrows to move, space to drop, escape to cancel.',
          );
        } else {
          const at = await drop();
          if (at !== null) opts.announce(`Dropped ${opts.label(at)} at position ${at + 1} of ${count}.`);
        }
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (grabbedIndex === null) return;
        e.preventDefault();
        e.stopPropagation();
        const to = grabbedIndex + (e.key === 'ArrowDown' ? 1 : -1);
        if (to < 0 || to >= count) return;
        await moveGrabbed(grabbedIndex, to);
        opts.announce(`${opts.label(to)} moved to position ${to + 1} of ${count}.`);
        return;
      }

      if (e.key === 'Escape' && grabbedIndex !== null) {
        e.preventDefault();
        e.stopPropagation();
        const origin = originIndex ?? grabbedIndex;
        if (grabbedIndex !== origin) {
          suppressBlur = true;
          opts.reorder(grabbedIndex, origin);
          grabbedIndex = null;
          originIndex = null;
          await tick();
          opts.focusItem(origin);
          suppressBlur = false;
        } else {
          grabbedIndex = null;
          originIndex = null;
        }
        opts.announce(`Cancelled. ${opts.label(origin)} returned to position ${origin + 1} of ${count}.`);
      }
    },

    /** Commit the current position when focus genuinely leaves a grabbed handle. */
    async handleBlur() {
      if (suppressBlur) return;
      await drop();
    },
  };
}
