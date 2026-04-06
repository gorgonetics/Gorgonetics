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
