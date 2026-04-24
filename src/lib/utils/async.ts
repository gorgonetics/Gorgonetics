/**
 * Yield to the browser event loop so any pending UI work (paint, input)
 * can run before the caller resumes. Used by batched background jobs to
 * keep the main thread responsive.
 *
 * Uses `setTimeout(0)` rather than `queueMicrotask` (microtasks run before
 * paint, defeating the point) or `requestIdleCallback` (not reliably
 * available in all Tauri WebView backends).
 */
export function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
