#!/usr/bin/env node
/**
 * Drain new gene effect reports from Firestore `/geneReports` into GitHub
 * issues: one issue per gene, with a tally of proposals. Run daily by
 * .github/workflows/gene-reports.yml. Design: docs/design/gene-effect-reports-v1.md §7.
 *
 * Firestore is the only state. Each issue body is rebuilt from all of the
 * gene's reports and the current templates in `assets/`, so a run can be
 * repeated safely; batch comments carry a marker so a retry does not post
 * twice; the cursor is written last, so a failed run repeats, never skips.
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
export const PAGE_SIZE = 200;
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
 * @property {(species: string, gene: string) => Promise<Report[]>} reportsForGene
 *
 * @typedef {object} IssueTracker
 * @property {() => Promise<Map<string, Issue>>} listReportIssues  keyed by `species/gene`
 * @property {(title: string) => Promise<Issue | null>} findIssueByTitle
 *   Fallback for an issue that lost its label; exact title match.
 * @property {(number: number) => Promise<void>} addLabel
 * @property {(title: string, body: string) => Promise<Issue>} createIssue
 * @property {(number: number, patch: { body?: string, state?: 'open' }) => Promise<void>} updateIssue
 * @property {(number: number) => Promise<string[]>} listCommentBodies
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
 * Take reports in order until the next one would add a gene past
 * `maxGenes`. Returns the reports taken, grouped by gene, and the cursor
 * after the last one taken (null when none were taken).
 * @param {Report[]} reports  in (submittedAt, id) order
 * @param {Set<string>} genes  genes already picked this run (mutated)
 * @param {number} maxGenes
 */
export function takeWithinGeneLimit(reports, genes, maxGenes) {
  /** @type {Report[]} */
  const taken = [];
  let full = false;
  for (const r of reports) {
    const key = geneKey(r.species, r.gene);
    if (!genes.has(key)) {
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

/**
 * Tally all reports of one gene by proposal.
 * @param {Report[]} reports
 * @param {TemplateGene | undefined} current  template on main
 */
export function buildTally(reports, current) {
  /** @type {Map<string, { dominant: string, recessive: string, count: number, applied: boolean }>} */
  const proposals = new Map();
  /** @type {Map<string, number>} */
  const hashes = new Map();
  for (const r of reports) {
    const key = `${r.proposedDominant}|${r.proposedRecessive}`;
    const entry = proposals.get(key) ?? {
      dominant: r.proposedDominant,
      recessive: r.proposedRecessive,
      count: 0,
      applied:
        current !== undefined &&
        current.effectDominant === r.proposedDominant &&
        current.effectRecessive === r.proposedRecessive,
    };
    entry.count++;
    proposals.set(key, entry);
    hashes.set(r.templateBundleHash, (hashes.get(r.templateBundleHash) ?? 0) + 1);
  }
  const sorted = [...proposals.values()].sort(
    (a, b) => b.count - a.count || a.dominant.localeCompare(b.dominant) || a.recessive.localeCompare(b.recessive),
  );
  return { proposals: sorted, hashes, total: reports.length };
}

/**
 * The full issue body. Rebuilt from scratch every run; no notes, so its
 * size is bounded by the number of distinct proposals.
 * @param {string} species
 * @param {string} gene
 * @param {TemplateGene | undefined} current
 * @param {ReturnType<typeof buildTally>} tally
 */
export function renderIssueBody(species, gene, current, tally) {
  const lines = [
    issueMarker(species, gene),
    `Gene effect reports for **${species} ${gene}**, sent from the app.`,
    '',
    current
      ? `Current template on \`main\`: dominant ${code(current.effectDominant)}, recessive ${code(current.effectRecessive)}.`
      : 'This gene is not in the current templates on `main`.',
    '',
    '| Proposed dominant | Proposed recessive | Reports | |',
    '|---|---|---|---|',
    ...tally.proposals.map(
      (p) => `| ${code(p.dominant)} | ${code(p.recessive)} | ${p.count} | ${p.applied ? 'already applied' : ''} |`,
    ),
    '',
    `Reports: ${tally.total}. Template bundles they were made against: ${[...tally.hashes]
      .map(([h, n]) => `${code(h.slice(0, 12))} (${n})`)
      .join(', ')}.`,
    '',
    '_This body is rewritten by `scripts/sync-gene-reports.mjs` on every run; edits to it are lost. Notes are in the comments._',
  ];
  return lines.join('\n');
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
    .sort((a, b) => b.r.submittedAt.seconds - a.r.submittedAt.seconds);
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
  pageSize = PAGE_SIZE,
  now = Date.now(),
  settleMs = SETTLE_MS,
  log = () => {},
}) {
  const cutoffMs = now - settleMs;
  /** @type {Instant} */
  const before = { seconds: Math.floor(cutoffMs / 1000), nanoseconds: (cutoffMs % 1000) * 1_000_000 };

  // 1–2. New reports in order, up to the gene limit.
  const start = await store.readCursor();
  let cursor = start;
  /** @type {Set<string>} */
  const genes = new Set();
  /** @type {Map<string, Report[]>} */
  const newByGene = new Map();
  for (;;) {
    const page = await store.pageAfter(cursor, pageSize, before);
    if (page.length === 0) break;
    const { taken, full } = takeWithinGeneLimit(page, genes, maxGenes);
    for (const r of taken) {
      const key = geneKey(r.species, r.gene);
      const list = newByGene.get(key);
      if (list) list.push(r);
      else newByGene.set(key, [r]);
    }
    if (taken.length > 0) {
      const last = taken[taken.length - 1];
      cursor = { submittedAt: last.submittedAt, docId: last.id };
    }
    if (full || page.length < pageSize) break;
  }
  if (newByGene.size === 0) {
    log('No new reports.');
    return { genes: 0, reports: 0 };
  }

  // 3. Every report of each picked gene, read in parallel (independent
  // Firestore reads). The GitHub writes below stay sequential.
  const [issues, allByGene] = await Promise.all([
    tracker.listReportIssues(),
    Promise.all(
      [...newByGene.keys()].map(async (key) => {
        const [species, gene] = key.split('/');
        return /** @type {const} */ ([key, await store.reportsForGene(species, gene)]);
      }),
    ).then((entries) => new Map(entries)),
  ]);

  let reports = 0;
  for (const [key, newReports] of newByGene) {
    const [species, gene] = key.split('/');
    const current = templates.get(key);
    reports += newReports.length;

    // Recount from every report of the gene, not just the new ones.
    const tally = buildTally(allByGene.get(key) ?? [], current);
    const body = renderIssueBody(species, gene, current, tally);

    // 4. Create or rewrite the issue. An issue that lost its label is not
    // in `issues`; find it by title and relabel it rather than duplicate it.
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
      issue = await tracker.createIssue(title, body);
      log(`Created issue #${issue.number} for ${key}.`);
    } else {
      // 6. Reopen when a new report proposes something not yet in the templates.
      const reopen =
        issue.state === 'closed' &&
        newReports.some(
          (r) =>
            !current || r.proposedDominant !== current.effectDominant || r.proposedRecessive !== current.effectRecessive,
        );
      if (issue.body !== body || reopen) {
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

  // 7. Cursor last: a failure above repeats this batch on the next run.
  if (cursor && cursor !== start) await store.writeCursor(cursor);
  log(`Processed ${reports} report(s) across ${newByGene.size} gene(s).`);
  return { genes: newByGene.size, reports };
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
    async reportsForGene(species, gene) {
      const snap = await db.collection(COLLECTION).where('species', '==', species).where('gene', '==', gene).get();
      return snap.docs.map(toReport);
    },
  };
}

/**
 * GitHub issues over the REST API with the workflow's GITHUB_TOKEN.
 * @param {string} repo  `owner/name`
 * @param {string} token
 * @param {typeof fetch} [fetchImpl]
 * @returns {IssueTracker}
 */
export function githubTracker(repo, token, fetchImpl = fetch) {
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
      return (await paginate(`/issues/${number}/comments`)).map((c) => c.body ?? '');
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
  const tracker = githubTracker(repo, token);
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
