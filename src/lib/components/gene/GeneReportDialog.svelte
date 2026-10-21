<script lang="ts">
import StatusBanner from '#lib/components/shared/StatusBanner.svelte';
import { isPlaceholderConfig } from '#lib/firebase.js';
import { MAX_NOTE_LENGTH, type ReportableChange, submitGeneReports } from '#lib/services/geneReportService.js';
import type { DialogResult } from '#lib/types/index.js';
import { errorMessage } from '#lib/utils/error.js';
import { focusTrap } from '#lib/utils/focusTrap.js';

interface Props {
  species: string;
  chromosome: string;
  /** The editor's current reportable changes; the dialog does not reload them. */
  changes: ReportableChange[];
  onClose: () => void;
  onResult: (result: DialogResult) => void;
}

const { species, chromosome, changes: initialChanges, onClose, onResult }: Props = $props();

// Local copy: after a partial failure, the sent ones are marked here so the
// dialog can stay open on the rest without reloading anything.
// svelte-ignore state_referenced_locally
let changes = $state<ReportableChange[]>(initialChanges);
let note = $state('');
let sending = $state(false);
let sendError = $state('');

const pending = $derived(changes.filter((c) => !c.alreadySent));
// Every change on one chromosome shares these; show them once.
const shared = $derived(changes[0]?.report);

// Closing mid-send would drop the result: the parent would refresh before
// the writes finish, and a failure would land on a destroyed dialog.
function close(): void {
  if (!sending) onClose();
}

async function handleSend() {
  if (isPlaceholderConfig || pending.length === 0 || sending) return;
  sending = true;
  sendError = '';
  try {
    const result = await submitGeneReports(pending, note.trim());
    if (result.failed > 0) {
      // Keep the dialog open on the failed ones; mark the rest as sent.
      const recorded = new Set(result.recorded);
      changes = changes.map((c) => (recorded.has(c.docId) ? { ...c, alreadySent: true } : c));
      const done = result.sent + result.duplicates;
      sendError = (done > 0 ? `${done} report(s) sent. ` : '') + `${result.failed} could not be sent: ${result.error}`;
      return;
    }
    const parts = [`Sent ${result.sent} gene report(s) for ${chromosome}.`];
    if (result.duplicates > 0) parts.push(`${result.duplicates} had already been sent from this install.`);
    onResult({ type: 'success', message: parts.join(' ') });
    onClose();
  } catch (err) {
    sendError = errorMessage(err);
  } finally {
    sending = false;
  }
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
  class="modal-backdrop"
  onclick={close}
  onkeydown={(e) => {
    if (e.key === 'Escape') close();
  }}
  role="presentation"
  data-testid="gene-report-backdrop"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dialog gene-report-dialog"
    role="dialog"
    aria-label="Report gene corrections"
    aria-modal="true"
    tabindex="-1"
    use:focusTrap
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      if (e.key === 'Escape') close();
    }}
  >
    <div class="dialog-header">
      <h3>Report gene corrections — {species} {chromosome}</h3>
      <button class="close-btn" onclick={close} disabled={sending} aria-label="Close">×</button>
    </div>

    <div class="dialog-body">
      {#if isPlaceholderConfig}
        <div class="banner banner-warn" data-testid="gene-report-not-configured">
          The report database isn't configured for this build of Gorgonetics, so reports are
          disabled.
        </div>
      {/if}

      <p class="dialog-desc">
        These genes differ from the gene data bundled with the app. Sending reports them to the
        project's public database, where the maintainer checks them and may correct the bundled
        data. Only the fields below are sent. Reports cannot be edited or deleted after sending.
      </p>

      {#if changes.length === 0}
        <div class="banner" data-testid="gene-report-empty">
          No gene on this chromosome differs from the bundled data.
        </div>
      {:else}
        <table class="changes" data-testid="gene-report-preview">
          <thead>
            <tr>
              <th>Gene</th>
              <th>Dominant</th>
              <th>Recessive</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each changes as c (c.docId)}
              <tr class:sent={c.alreadySent} data-testid="gene-report-row">
                <td class="gene-id">{c.report.gene}</td>
                <td>
                  {#if c.report.bundledDominant === c.report.proposedDominant}
                    <span class="muted">{c.report.bundledDominant}</span>
                  {:else}
                    {c.report.bundledDominant} → <strong>{c.report.proposedDominant}</strong>
                  {/if}
                </td>
                <td>
                  {#if c.report.bundledRecessive === c.report.proposedRecessive}
                    <span class="muted">{c.report.bundledRecessive}</span>
                  {:else}
                    {c.report.bundledRecessive} → <strong>{c.report.proposedRecessive}</strong>
                  {/if}
                </td>
                <td class="status">
                  {#if c.alreadySent}<span data-testid="gene-report-sent">Reported</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

        {#if shared}
          <dl class="preview-grid" data-testid="gene-report-fields">
            <dt>Species</dt>
            <dd>{shared.species}</dd>
            <dt>Template version</dt>
            <dd><code title={shared.templateBundleHash}>{shared.templateBundleHash.slice(0, 12)}…</code></dd>
            <dt>App version</dt>
            <dd>{shared.appVersion}</dd>
            <dt>Schema version</dt>
            <dd>{shared.schemaVersion}</dd>
            <dt>Submission time</dt>
            <dd class="muted">set by the server</dd>
          </dl>
        {/if}

        {#if pending.length > 0}
          <label class="note-label" for="gene-report-note">
            Note (optional) — sent with every report above. How did you confirm the effect?
          </label>
          <textarea
            id="gene-report-note"
            data-testid="gene-report-note"
            bind:value={note}
            maxlength={MAX_NOTE_LENGTH}
            rows="3"
          ></textarea>
          <div class="note-count">{note.length} / {MAX_NOTE_LENGTH}</div>
        {/if}
      {/if}

      {#if sendError}
        <div data-testid="gene-report-error">
          <StatusBanner type="error" message={sendError} />
        </div>
      {/if}
    </div>

    <div class="dialog-footer">
      <button class="btn btn-secondary" onclick={close} disabled={sending}>Cancel</button>
      <button
        class="btn btn-primary"
        data-testid="gene-report-send"
        onclick={handleSend}
        disabled={sending || isPlaceholderConfig || pending.length === 0}
      >
        {sending ? 'Sending…' : `Send ${pending.length} report(s)`}
      </button>
    </div>
  </div>
</div>

<style>
  .gene-report-dialog {
    max-width: 560px;
  }

  .dialog-desc {
    font-size: 14px;
    color: var(--text-tertiary);
    margin: 0 0 var(--space-lg);
  }

  .changes {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    margin: 0 0 var(--space-lg);
  }

  .changes th {
    text-align: left;
    color: var(--text-tertiary);
    font-weight: 500;
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--border-primary);
  }

  .changes td {
    padding: var(--space-xs) var(--space-sm);
    color: var(--text-primary);
  }

  .changes tr.sent td {
    opacity: 0.6;
  }

  .gene-id {
    font-family: var(--font-mono, monospace);
  }

  .status {
    color: var(--text-tertiary);
    white-space: nowrap;
  }

  .preview-grid {
    display: grid;
    grid-template-columns: 130px 1fr;
    gap: var(--space-xs) var(--space-lg);
    margin: 0 0 var(--space-lg);
    font-size: 13px;
  }

  .preview-grid dt {
    color: var(--text-tertiary);
    font-weight: 500;
  }

  .preview-grid dd {
    margin: 0;
    color: var(--text-primary);
  }

  .muted {
    color: var(--text-tertiary);
  }

  .note-label {
    display: block;
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: var(--space-xs);
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font: inherit;
    font-size: 13px;
    padding: var(--space-sm);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .note-count {
    text-align: right;
    font-size: 12px;
    color: var(--text-tertiary);
  }
</style>
