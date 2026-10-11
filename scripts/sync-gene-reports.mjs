#!/usr/bin/env node
/**
 * Drain new gene effect reports from Firestore `/geneReports` into GitHub
 * issues: one issue per gene. Run daily by .github/workflows/gene-reports.yml.
 * Design: docs/design/gene-effect-reports-v1.md §7.
 *
 * The issue body describes the gene and the first proposal, plus a
 * "Reports so far" line refreshed from a server-side count. Each run adds
 * one comment per gene for its new reports. Every run is bounded: at most
 * MAX_REPORTS_PER_RUN reports and MAX_GENES_PER_RUN genes. Comments carry a
 * marker so a retry does not post twice; the cursor is written last, so a
 * failed run repeats, never skips.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='<key JSON>' GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo \
 *     node scripts/sync-gene-reports.mjs [--dry-run]
 *
 * FIREBASE_SERVICE_ACCOUNT_PATH (a key file) works in place of
 * FIREBASE_SERVICE_ACCOUNT. `--dry-run` reads Firestore and GitHub but
 * writes neither issues nor the cursor; it prints what it would do.
 * See docs/firebase-setup.md for the key and secret setup.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServiceAccount } from './firebase-service-account.mjs';

export const LABEL = 'gene-report';
export const MAX_GENES_PER_RUN = 20;
/** Bounds a run's reads and runtime when one gene is flooded. */
export const MAX_REPORTS_PER_RUN = 5000;
export const PAGE_SIZE = 200;
/** The identity the workflow's GITHUB_TOKEN posts as; only its comment markers are trusted. */
export const DEFAULT_BOT_LOGIN = 'github-actions[bot]';
export const MAX_NOTES_PER_COMMENT = 20;
export const MAX_NOTE_CHARS_PER_COMMENT = 30_000;
/**
 * Only reports older than this are taken. Guards the cursor against a
 * report that becomes visible after a later-stamped one: once the cursor
 * passed it, it would be skipped for good. Costs nothing for a daily job.
 */
export const SETTLE_MS = 5 * 60_000;
const CURSOR_DOC = 'meta/geneReportSync';
const COLLECTION = 'geneReports';

/**
 * @typedef {{ seconds: number, nanoseconds: number }} Instant
 * @typedef {{
 *   id: string,
 *   species: string,
 *   gene: string,
 *   bundledDominant: string,
 *   bundledRecessive: string,
 *   proposedDominant: string,
 *   proposedRecessive: string,
 *   note: string,
 *   templateBundleHash: string,
 *   appVersion: string,
 *   submittedAt: Instant,
 * }} Report
 * @typedef {{ submittedAt: Instant, docId: string }} Cursor
 * @typedef {{ effectDominant: string, effectRecessive: string }} TemplateGene
 * @typedef {Map<string, TemplateGene>} Templates  keyed by `species/gene`
 * @typedef {{ number: number, state: 'open' | 'closed', body: string }} Issue
 *
 * @typedef {object} ReportStore
 * @property {() => Promise<Cursor | null>} readCursor
 * @property {(cursor: Cursor) => Promise<void>} writeCursor
 * @property {(after: Cursor | null, limit: number, before: Instant) => Promise<Report[]>} pageAfter
 *   Reports ordered by (submittedAt, doc ID), strictly after `after` and
 *   submitted strictly before `before`.
 * @property {(species: string, gene: string) => Promise<number>} countForGene
 *   Server-side count of all reports of one gene.
 *
 * @typedef {object} IssueTracker
 * @property {() => Promise<Map<string, Issue>>} listReportIssues  keyed by `species/gene`
 * @property {(title: string) => Promise<Issue | null>} findIssueByTitle
 *   Fallback for an issue that lost its label; exact title match.
 * @property {(number: number) => Promise<void>} addLabel
 * @property {(title: string, body: string) => Promise<Issue>} createIssue
 * @property {(number: number, patch: { body?: string, state?: 'open' }) => Promise<void>} updateIssue
 * @property {(number: number) => Promise<string[]>} listCommentBodies
 *   Bodies of comments written by the sync's own identity only: anyone can
 *   comment on a public issue, and a forged marker must not stop posting.
 * @property {(number: number, body: string) => Promise<void>} createComment
 */

// ── Pure helpers ───────────────────────────────────────────────────────────

/** @param {string} species @param {string} gene */
export function geneKey(species, gene) {
  return `${species}/${gene}`;
}

/** @param {string} species @param {string} gene */
export function issueMarker(species, gene) {
  return `<!-- gene-report:${geneKey(species, gene)} -->`;
}

/** The `species/gene` key in an issue body's marker, or null. @param {string} body */
export function keyFromIssueBody(body) {
  const m = body.match(/<!-- gene-report:([a-z]+\/[0-9]{2}[A-Z][0-9]) -->/);
  return m ? m[1] : null;
}

/** @param {string} species @param {string} gene */
export function issueTitle(species, gene) {
  return `Gene report: ${species} ${gene}`;
}

/** Inline code that a value cannot break out of. @param {string} value */
function code(value) {
  return `\`${String(value).replaceAll('`', '')}\``;
}

/**
 * Make user text safe to post: no backticks (it goes inside a fenced code
 * block it must not close), and no `@` or `#` before a word character, so
 * it cannot mention users or link issues even if rendered outside a block.
 * @param {string} note
 */
export function sanitiseNote(note) {
  return note.replaceAll('`', '').replace(/[@#](?=\w)/g, '').trim();
}

/** @param {Report} r @returns {Cursor} */
function positionOf(r) {
  return { submittedAt: r.submittedAt, docId: r.id };
}

/** Order of two positions in sync order. @param {Cursor} a @param {Cursor} b */
export function compareCursor(a, b) {
  return (
    a.submittedAt.seconds - b.submittedAt.seconds ||
    a.submittedAt.nanoseconds - b.submittedAt.nanoseconds ||
    (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0)
  );
}

/**
 * Hidden marker in each batch comment: the position of the last report it
 * covers. Reports reach a gene's comments in sync order, so every report at
 * or before the highest marker on an issue has been posted. A retry skips
 * those, even when new reports for the gene arrived in between.
 * @param {Cursor} c
 */
export function progressMarker(c) {
  return `<!-- gene-report-upto:${c.submittedAt.seconds}.${String(c.submittedAt.nanoseconds).padStart(9, '0')}:${c.docId} -->`;
}

/**
 * The highest position marked in a set of comment bodies, or null.
 * @param {string[]} bodies
 * @returns {Cursor | null}
 */
export function postedUpTo(bodies) {
  /** @type {Cursor | null} */
  let max = null;
  for (const body of bodies) {
    for (const m of body.matchAll(/<!-- gene-report-upto:(\d+)\.(\d{9}):(\S+) -->/g)) {
      const c = { submittedAt: { seconds: Number(m[1]), nanoseconds: Number(m[2]) }, docId: m[3] };
      if (!max || compareCursor(c, max) > 0) max = c;
    }
  }
  return max;
}

/**
 * Take reports in order until the next one would add a known gene past
 * `maxGenes`. Reports for genes not in the templates are taken (so the
 * cursor moves past them) but use no gene slot: a flood of made-up gene
 * IDs cannot block real reports.
 * @param {Report[]} reports  in (submittedAt, id) order
 * @param {Set<string>} genes  known genes already picked this run (mutated)
 * @param {number} maxGenes
 * @param {(key: string) => boolean} isKnown
 */
export function takeWithinGeneLimit(reports, genes, maxGenes, isKnown) {
  /** @type {Report[]} */
  const taken = [];
  let full = false;
  for (const r of reports) {
    const key = geneKey(r.species, r.gene);
    if (isKnown(key) && !genes.has(key)) {
      if (genes.size >= maxGenes) {
        full = true;
        break;
      }
      genes.add(key);
    }
    taken.push(r);
  }
  return { taken, full };
}

const COUNT_LINE = /^Reports so far: .*<!-- gene-report-count -->$/m;

/** @param {number} count */
function countLine(count) {
  return `Reports so far: **${count}** <!-- gene-report-count -->`;
}

/**
 * Body of a new issue: the gene, its template on main, the first proposal
 * and the report count. Written once; later runs only refresh the count line.
 * @param {Report} first
 * @param {TemplateGene} current
 * @param {number} count
 */
export function renderIssueBody(first, current, count) {
  return [
    issueMarker(first.species, first.gene),
    `Gene effect report for **${first.species} ${first.gene}**, sent from the app.`,
    '',
    `Template on \`main\` when this issue was opened: dominant ${code(current.effectDominant)}, recessive ${code(current.effectRecessive)}.`,
    '',
    `First report proposes: dominant ${code(first.proposedDominant)}, recessive ${code(first.proposedRecessive)} ` +
      `(the reporter's app had dominant ${code(first.bundledDominant)}, recessive ${code(first.bundledRecessive)}).`,
    '',
    countLine(count),
    '',
    'Each sync adds a comment with its new reports, including other proposals, and their notes.',
  ].join('\n');
}

/**
 * The body with its count line set to `count`; appended if a maintainer
 * removed the line. The rest of the body, including edits, is kept.
 * @param {string} body
 * @param {number} count
 */
export function withReportCount(body, count) {
  return COUNT_LINE.test(body) ? body.replace(COUNT_LINE, countLine(count)) : `${body}\n\n${countLine(count)}`;
}

/**
 * One comment for a gene's newly posted reports, with the newest notes.
 * @param {Report[]} newReports  in sync order
 */
export function renderBatchComment(newReports) {
  const last = newReports.reduce((a, b) => (compareCursor(positionOf(b), positionOf(a)) > 0 ? b : a));
  const marker = progressMarker(positionOf(last));
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const r of newReports) {
    const key = `${code(r.bundledDominant)} / ${code(r.bundledRecessive)} → ${code(r.proposedDominant)} / ${code(r.proposedRecessive)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const withNotes = newReports
    .map((r) => ({ r, note: sanitiseNote(r.note) }))
    .filter((x) => x.note.length > 0)
    .sort((a, b) => compareCursor(positionOf(b.r), positionOf(a.r)));
  /** @type {string[]} */
  const noteBlocks = [];
  let chars = 0;
  for (const { r, note } of withNotes) {
    if (noteBlocks.length >= MAX_NOTES_PER_COMMENT) break;
    // A shorter later note may still fit.
    if (chars + note.length > MAX_NOTE_CHARS_PER_COMMENT) continue;
    chars += note.length;
    const when = new Date(r.submittedAt.seconds * 1000).toISOString().slice(0, 10);
    noteBlocks.push(`${when}, app ${code(r.appVersion)}:\n\`\`\`text\n${note}\n\`\`\``);
  }
  const omitted = withNotes.length - noteBlocks.length;

  const lines = [
    marker,
    `${newReports.length} new report(s):`,
    ...[...counts].map(([k, n]) => `- ${k}: ${n}`),
  ];
  if (noteBlocks.length > 0) lines.push('', 'Notes (newest first):', '', noteBlocks.join('\n\n'));
  if (omitted > 0) lines.push('', `${omitted} more note(s) not shown; all notes stay in Firestore.`);
  return lines.join('\n');
}

/**
 * Load every bundled template gene from `assets/<species>/*.json`.
 * @param {string} assetsDir
 * @returns {Templates}
 */
export function loadTemplates(assetsDir) {
  /** @type {Templates} */
  const templates = new Map();
  for (const species of readdirSync(assetsDir, { withFileTypes: true })) {
    if (!species.isDirectory()) continue;
    const dir = resolve(assetsDir, species.name);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const genes = /** @type {({ gene: string } & TemplateGene)[]} */ (
        JSON.parse(readFileSync(resolve(dir, file), 'utf-8'))
      );
      for (const g of genes) {
        templates.set(geneKey(species.name, g.gene), {
          effectDominant: g.effectDominant,
          effectRecessive: g.effectRecessive,
        });
      }
    }
  }
  return templates;
}

// ── Sync ───────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   store: ReportStore,
 *   tracker: IssueTracker,
 *   templates: Templates,
 *   maxGenes?: number,
 *   maxReports?: number,
 *   pageSize?: number,
 *   now?: number,
 *   settleMs?: number,
 *   log?: (msg: string) => void,
 * }} deps
 */
export async function syncGeneReports({
  store,
  tracker,
  templates,
  maxGenes = MAX_GENES_PER_RUN,
  maxReports = MAX_REPORTS_PER_RUN,
  pageSize = PAGE_SIZE,
  now = Date.now(),
  settleMs = SETTLE_MS,
  log = () => {},
}) {
  const cutoffMs = now - settleMs;
  /** @type {Instant} */
  const before = { seconds: Math.floor(cutoffMs / 1000), nanoseconds: (cutoffMs % 1000) * 1_000_000 };
  const isKnown = (/** @type {string} */ key) => templates.has(key);

  // 1–2. New reports in order, up to the report and gene limits.
  const start = await store.readCursor();
  let cursor = start;
  /** @type {Set<string>} */
  const genes = new Set();
  /** @type {Map<string, Report[]>} */
  const newByGene = new Map();
  let takenCount = 0;
  let unknown = 0;
  while (takenCount < maxReports) {
    const page = await store.pageAfter(cursor, Math.min(pageSize, maxReports - takenCount), before);
    if (page.length === 0) break;
    const { taken, full } = takeWithinGeneLimit(page, genes, maxGenes, isKnown);
    for (const r of taken) {
      const key = geneKey(r.species, r.gene);
      if (!isKnown(key)) {
        unknown++;
        continue;
      }
      const list = newByGene.get(key);
      if (list) list.push(r);
      else newByGene.set(key, [r]);
    }
    takenCount += taken.length;
    if (taken.length > 0) {
      const last = taken[taken.length - 1];
      cursor = { submittedAt: last.submittedAt, docId: last.id };
    }
    if (full || page.length < pageSize) break;
  }
  if (unknown > 0) log(`Skipped ${unknown} report(s) for genes not in the templates.`);

  if (newByGene.size > 0) {
    // 3. Report counts, read in parallel (independent server-side counts).
    // The GitHub writes below stay sequential.
    const [issues, counts] = await Promise.all([
      tracker.listReportIssues(),
      Promise.all(
        [...newByGene.keys()].map(async (key) => {
          const [species, gene] = key.split('/');
          return /** @type {const} */ ([key, await store.countForGene(species, gene)]);
        }),
      ).then((entries) => new Map(entries)),
    ]);

    for (const [key, newReports] of newByGene) {
      const [species, gene] = key.split('/');
      const current = /** @type {TemplateGene} */ (templates.get(key));
      const count = counts.get(key) ?? newReports.length;

      // 4. Find the issue (relabel one that lost its label rather than
      // duplicate it), or create it from the gene's first new report.
      const title = issueTitle(species, gene);
      let issue = issues.get(key);
      if (!issue) {
        const unlabelled = await tracker.findIssueByTitle(title);
        if (unlabelled) {
          await tracker.addLabel(unlabelled.number);
          log(`Relabelled issue #${unlabelled.number} for ${key}.`);
          issue = unlabelled;
        }
      }
      if (!issue) {
        issue = await tracker.createIssue(title, renderIssueBody(newReports[0], current, count));
        log(`Created issue #${issue.number} for ${key}.`);
      } else {
        // 6. Reopen when a new report proposes something not yet in the templates.
        const reopen =
          issue.state === 'closed' &&
          newReports.some(
            (r) => r.proposedDominant !== current.effectDominant || r.proposedRecessive !== current.effectRecessive,
          );
        const body = withReportCount(issue.body, count);
        if (body !== issue.body || reopen) {
          await tracker.updateIssue(issue.number, reopen ? { body, state: 'open' } : { body });
          log(`${reopen ? 'Reopened' : 'Updated'} issue #${issue.number} for ${key}.`);
        }
      }

      // 5. One comment for the reports not yet posted. After a failed run,
      // the retry skips those an earlier comment already covers.
      const upTo = postedUpTo(await tracker.listCommentBodies(issue.number));
      const unposted = upTo ? newReports.filter((r) => compareCursor(positionOf(r), upTo) > 0) : newReports;
      if (unposted.length > 0) await tracker.createComment(issue.number, renderBatchComment(unposted));
    }
  }

  // 7. Cursor last: a failure above repeats this batch on the next run.
  if (cursor && cursor !== start) await store.writeCursor(cursor);
  const reports = [...newByGene.values()].reduce((n, list) => n + list.length, 0);
  log(newByGene.size > 0 ? `Processed ${reports} report(s) across ${newByGene.size} gene(s).` : 'No new reports.');
  return { genes: newByGene.size, reports, unknown };
}

// ── Adapters ───────────────────────────────────────────────────────────────

/**
 * Firestore via the Admin SDK's modular API. The Admin SDK bypasses the
 * rules, which deny clients any listing of /geneReports and any access to
 * /meta. Takes the `firebase-admin/firestore` module so this file can be
 * imported (for its pure helpers) without loading the Admin SDK.
 * @param {typeof import('firebase-admin/firestore')} firestoreModule
 * @param {import('firebase-admin/firestore').Firestore} db
 * @returns {ReportStore}
 */
export function firestoreStore(firestoreModule, db) {
  const { FieldPath, Timestamp } = firestoreModule;
  /** @param {import('firebase-admin/firestore').DocumentSnapshot} doc @returns {Report} */
  const toReport = (doc) => {
    const d = /** @type {Record<string, any>} */ (doc.data());
    return {
      id: doc.id,
      species: d.species,
      gene: d.gene,
      bundledDominant: d.bundledDominant,
      bundledRecessive: d.bundledRecessive,
      proposedDominant: d.proposedDominant,
      proposedRecessive: d.proposedRecessive,
      note: typeof d.note === 'string' ? d.note : '',
      templateBundleHash: d.templateBundleHash,
      appVersion: d.appVersion,
      submittedAt: { seconds: d.submittedAt.seconds, nanoseconds: d.submittedAt.nanoseconds },
    };
  };
  return {
    async readCursor() {
      const snap = await db.doc(CURSOR_DOC).get();
      if (!snap.exists) return null;
      const d = /** @type {Record<string, any>} */ (snap.data());
      return { submittedAt: { seconds: d.submittedAt.seconds, nanoseconds: d.submittedAt.nanoseconds }, docId: d.docId };
    },
    async writeCursor(cursor) {
      await db.doc(CURSOR_DOC).set({
        submittedAt: new Timestamp(cursor.submittedAt.seconds, cursor.submittedAt.nanoseconds),
        docId: cursor.docId,
      });
    },
    async pageAfter(after, limit, before) {
      let q = db
        .collection(COLLECTION)
        .where('submittedAt', '<', new Timestamp(before.seconds, before.nanoseconds))
        .orderBy('submittedAt')
        .orderBy(FieldPath.documentId());
      if (after) q = q.startAfter(new Timestamp(after.submittedAt.seconds, after.submittedAt.nanoseconds), after.docId);
      const snap = await q.limit(limit).get();
      return snap.docs.map(toReport);
    },
    async countForGene(species, gene) {
      // An aggregation query: counted on the server, about one read per
      // 1,000 reports, so a flood on one gene stays cheap and loads nothing.
      const snap = await db.collection(COLLECTION).where('species', '==', species).where('gene', '==', gene).count().get();
      return snap.data().count;
    },
  };
}

/**
 * GitHub issues over the REST API with the workflow's GITHUB_TOKEN.
 * @param {string} repo  `owner/name`
 * @param {string} token
 * @param {typeof fetch} [fetchImpl]
 * @param {string} [botLogin]  the login the token posts as
 * @returns {IssueTracker}
 */
export function githubTracker(repo, token, fetchImpl = fetch, botLogin = DEFAULT_BOT_LOGIN) {
  /** @param {string} path @param {RequestInit} [init] */
  function api(path, init = {}) {
    return apiUrl(`https://api.github.com/repos/${repo}${path}`, init);
  }

  /** @param {string} url @param {RequestInit} [init] */
  async function apiUrl(url, init = {}) {
    const path = url.replace('https://api.github.com', '');
    const res = await fetchImpl(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  /** @param {string} path @returns {Promise<any[]>} */
  async function paginate(path) {
    /** @type {any[]} */
    const all = [];
    for (let page = 1; ; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const batch = await api(`${path}${sep}per_page=100&page=${page}`);
      all.push(...batch);
      if (batch.length < 100) return all;
    }
  }

  return {
    async listReportIssues() {
      // List by label rather than search: search is indexed with a delay,
      // so a retry right after a create could miss the issue and make a
      // second one.
      /** @type {Map<string, Issue>} */
      const byKey = new Map();
      for (const i of await paginate(`/issues?labels=${LABEL}&state=all`)) {
        if (i.pull_request) continue;
        const key = keyFromIssueBody(i.body ?? '');
        if (key && !byKey.has(key)) byKey.set(key, { number: i.number, state: i.state, body: i.body ?? '' });
      }
      return byKey;
    },
    async findIssueByTitle(title) {
      // Search lags for new issues, but this only looks for old issues that
      // lost their label; a just-created issue still has it.
      const q = encodeURIComponent(`repo:${repo} is:issue in:title "${title}"`);
      const result = await apiUrl(`https://api.github.com/search/issues?q=${q}&per_page=10`);
      const i = (result.items ?? []).find((/** @type {any} */ x) => x.title === title && !x.pull_request);
      return i ? { number: i.number, state: i.state, body: i.body ?? '' } : null;
    },
    async addLabel(number) {
      await api(`/issues/${number}/labels`, { method: 'POST', body: JSON.stringify({ labels: [LABEL] }) });
    },
    async createIssue(title, body) {
      const i = await api('/issues', { method: 'POST', body: JSON.stringify({ title, body, labels: [LABEL] }) });
      return { number: i.number, state: i.state, body: i.body ?? '' };
    },
    async updateIssue(number, patch) {
      await api(`/issues/${number}`, { method: 'PATCH', body: JSON.stringify(patch) });
    },
    async listCommentBodies(number) {
      return (await paginate(`/issues/${number}/comments`))
        .filter((c) => c.user?.login === botLogin)
        .map((c) => c.body ?? '');
    },
    async createComment(number, body) {
      await api(`/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    },
  };
}

/**
 * Wrap a tracker so writes are logged, not made. Reads still run.
 * @param {IssueTracker} tracker
 * @param {(msg: string) => void} log
 * @returns {IssueTracker}
 */
export function dryRunTracker(tracker, log) {
  let next = -1;
  return {
    listReportIssues: () => tracker.listReportIssues(),
    findIssueByTitle: (title) => tracker.findIssueByTitle(title),
    async addLabel(number) {
      log(`[dry run] would add label ${LABEL} to #${number}`);
    },
    listCommentBodies: (n) => (n < 0 ? Promise.resolve([]) : tracker.listCommentBodies(n)),
    async createIssue(title, body) {
      log(`[dry run] would create "${title}":\n${body}\n`);
      return { number: next--, state: 'open', body };
    },
    async updateIssue(number, patch) {
      log(`[dry run] would update #${number}${patch.state ? ` (state: ${patch.state})` : ''}:\n${patch.body ?? ''}\n`);
    },
    async createComment(number, body) {
      log(`[dry run] would comment on #${number}:\n${body}\n`);
    },
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(`sync-gene-reports: ${message}`);
  process.exit(1);
}


async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) fail('GITHUB_REPOSITORY and GITHUB_TOKEN are required.');

  /** @type {Record<string, any>} */
  let serviceAccount;
  try {
    serviceAccount = loadServiceAccount();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  // Loaded here, not at the top, so tests can import the pure helpers
  // without the Admin SDK.
  const { initializeApp, cert } = await import('firebase-admin/app');
  const firestoreModule = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: cert(serviceAccount) });

  const log = (/** @type {string} */ msg) => console.log(msg);
  // Local runs post as the token's user; set GENE_REPORT_BOT_LOGIN to it.
  const tracker = githubTracker(repo, token, fetch, process.env.GENE_REPORT_BOT_LOGIN || DEFAULT_BOT_LOGIN);
  const store = firestoreStore(firestoreModule, firestoreModule.getFirestore(app));
  const result = await syncGeneReports({
    store: dryRun ? { ...store, writeCursor: async () => {} } : store,
    tracker: dryRun ? dryRunTracker(tracker, log) : tracker,
    templates: loadTemplates(resolve(fileURLToPath(new URL('../assets', import.meta.url)))),
    log,
  });
  if (dryRun) log('[dry run] cursor not written.');
  return result;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => fail(err.stack ?? err.message ?? String(err)));
}
