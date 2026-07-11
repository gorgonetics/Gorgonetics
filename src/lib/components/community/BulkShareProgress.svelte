<script lang="ts">
/**
 * Global, non-blocking progress for the background "Share all pets" job.
 * Mounted once at the layout root so it persists across destination switches
 * while the job runs. Reads the module-scoped `bulkShareJob` state directly.
 */
import { bulkShareJob, bulkSharePercent, cancelBulkShare, dismissBulkShare } from '$lib/stores/bulkShare.svelte.js';

const job = bulkShareJob;

const summaryText = $derived.by(() => {
  if (job.error) return `Sharing failed: ${job.error}`;
  const s = job.summary;
  if (!s) return 'Sharing complete.';
  const parts = [`${s.created} shared`];
  if (s.alreadyShared > 0) parts.push(`${s.alreadyShared} already in catalogue`);
  if (s.skipped > 0) parts.push(`${s.skipped} skipped`);
  if (s.failed > 0) parts.push(`${s.failed} failed`);
  return parts.join(' · ');
});

const tone = $derived(job.error || (job.summary?.failed ?? 0) > 0 ? 'warn' : 'ok');
</script>

{#if job.status !== 'idle'}
  <section class="bulk-share-progress" class:tone-warn={tone === 'warn'} data-testid="bulk-share-progress-global" aria-live="polite">
    {#if job.status === 'running'}
      <div class="bsp-row">
        <span class="bsp-title">Sharing pets to community…</span>
        <button type="button" class="bsp-btn" data-testid="bulk-share-cancel" onclick={cancelBulkShare}>Cancel</button>
      </div>
      <div
        class="bsp-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={job.total}
        aria-valuenow={job.done}
      >
        <div class="bsp-fill" style="width: {bulkSharePercent()}%"></div>
      </div>
      <span class="bsp-count">{job.done} / {job.total}</span>
    {:else}
      <div class="bsp-row">
        <span class="bsp-title" data-testid="bulk-share-done">{summaryText}</span>
        <button type="button" class="bsp-btn" data-testid="bulk-share-dismiss" onclick={dismissBulkShare} aria-label="Dismiss">×</button>
      </div>
    {/if}
  </section>
{/if}

<style>
  .bulk-share-progress {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 1000;
    width: min(360px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid var(--border-primary);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    background: var(--bg-primary);
    box-shadow: var(--shadow-lg);
  }
  .bulk-share-progress.tone-warn { border-left-color: var(--warning-text, #b8860b); }

  .bsp-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .bsp-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .bsp-count { font-size: 12px; color: var(--text-tertiary); }

  .bsp-bar {
    height: 6px;
    border-radius: 3px;
    background: var(--bg-secondary);
    overflow: hidden;
  }
  .bsp-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.2s ease;
  }

  .bsp-btn {
    flex-shrink: 0;
    padding: 3px 10px;
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .bsp-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
</style>
