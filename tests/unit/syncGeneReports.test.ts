import { describe, expect, it, vi } from 'vitest';
import {
  dryRunTracker,
  githubTracker,
  issueMarker,
  keyFromIssueBody,
  loadTemplates,
  MAX_NOTES_PER_COMMENT,
  postedUpTo,
  progressMarker,
  renderBatchComment,
  renderIssueBody,
  SETTLE_MS,
  sanitiseNote,
  syncGeneReports,
  takeWithinGeneLimit,
  withReportCount,
} from '../../scripts/sync-gene-reports.mjs';

// Covers the sync logic with an in-memory report store and issue tracker.
// The Firestore adapter's queries are covered against the emulator in
// tests/integration/syncGeneReports.emulator.test.ts.

type Report = Parameters<typeof renderBatchComment>[0][number];
type Issue = { number: number; state: 'open' | 'closed'; body: string };
type FakeIssue = Issue & { title: string; labelled: boolean };
type Comment = { body: string; login: string };

let seq = 0;
function report(overrides: Partial<Report> = {}): Report {
  seq++;
  return {
    id: `r${String(seq).padStart(4, '0')}`,
    species: 'horse',
    gene: '26B3',
    bundledDominant: 'Toughness+',
    bundledRecessive: 'None',
    proposedDominant: 'Ruggedness+',
    proposedRecessive: 'None',
    note: '',
    templateBundleHash: 'c'.repeat(64),
    appVersion: '0.10.3',
    submittedAt: { seconds: 1_700_000_000 + seq, nanoseconds: 0 },
    ...overrides,
  };
}

const TEMPLATES = new Map(
  ['26B3', '26B4', '01A1', '01A2', '01A3', '01A4'].map((g) => [
    `horse/${g}`,
    { effectDominant: 'Toughness+', effectRecessive: 'None' },
  ]),
);

/** In-memory store with the same ordering contract as the Firestore adapter. */
function fakeStore(reports: Report[]) {
  const all = [...reports];
  let cursor: { submittedAt: Report['submittedAt']; docId: string } | null = null;
  const order = (r: Report) => [r.submittedAt.seconds, r.submittedAt.nanoseconds, r.id] as const;
  const after = (r: Report, c: NonNullable<typeof cursor>) => {
    const [s, n, id] = order(r);
    return (
      s > c.submittedAt.seconds ||
      (s === c.submittedAt.seconds &&
        (n > c.submittedAt.nanoseconds || (n === c.submittedAt.nanoseconds && id > c.docId)))
    );
  };
  return {
    all,
    get cursor() {
      return cursor;
    },
    readCursor: vi.fn(async () => cursor),
    writeCursor: vi.fn(async (c: NonNullable<typeof cursor>) => {
      cursor = c;
    }),
    pageAfter: vi.fn(async (c: typeof cursor, limit: number, before: Report['submittedAt']) =>
      [...all]
        .filter(
          (r) =>
            r.submittedAt.seconds < before.seconds ||
            (r.submittedAt.seconds === before.seconds && r.submittedAt.nanoseconds < before.nanoseconds),
        )
        .sort((a, b) => {
          const [x, y] = [order(a), order(b)];
          return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
        })
        .filter((r) => !c || after(r, c))
        .slice(0, limit),
    ),
    countForGene: vi.fn(
      async (species: string, gene: string) => all.filter((r) => r.species === species && r.gene === gene).length,
    ),
  };
}

const BOT = 'github-actions[bot]';

function fakeTracker(initial: FakeIssue[] = []) {
  const issues = new Map<number, FakeIssue>(initial.map((i) => [i.number, { ...i }]));
  const comments = new Map<number, Comment[]>();
  let next = 100;
  return {
    issues,
    comments,
    bodies: (n: number) => (comments.get(n) ?? []).map((c) => c.body),
    listReportIssues: vi.fn(async () => {
      const byKey = new Map<string, Issue>();
      for (const i of issues.values()) {
        const key = keyFromIssueBody(i.body);
        if (key && i.labelled) byKey.set(key, { number: i.number, state: i.state, body: i.body });
      }
      return byKey;
    }),
    findIssueByTitle: vi.fn(async (title: string) => {
      const i = [...issues.values()].find((x) => x.title === title);
      return i ? { number: i.number, state: i.state, body: i.body } : null;
    }),
    addLabel: vi.fn(async (number: number) => {
      const i = issues.get(number);
      if (i) i.labelled = true;
    }),
    createIssue: vi.fn(async (title: string, body: string) => {
      const issue: FakeIssue = { number: next++, state: 'open', body, title, labelled: true };
      issues.set(issue.number, issue);
      return { number: issue.number, state: issue.state, body };
    }),
    updateIssue: vi.fn(async (number: number, patch: { body?: string; state?: 'open' }) => {
      const i = issues.get(number);
      if (i) Object.assign(i, patch);
    }),
    // Same filter as githubTracker: only the bot's own comments count.
    listCommentBodies: vi.fn(async (number: number) =>
      (comments.get(number) ?? []).filter((c) => c.login === BOT).map((c) => c.body),
    ),
    createComment: vi.fn(async (number: number, body: string) => {
      comments.set(number, [...(comments.get(number) ?? []), { body, login: BOT }]);
    }),
  };
}

function openIssue(number: number, state: 'open' | 'closed' = 'open'): FakeIssue {
  return {
    number,
    state,
    title: 'Gene report: horse 26B3',
    labelled: true,
    body: renderIssueBody(report(), { effectDominant: 'Toughness+', effectRecessive: 'None' }, 1),
  };
}

describe('sanitiseNote', () => {
  it('removes backticks, mentions and issue links', () => {
    expect(sanitiseNote('```\nhi @octocat see #12 and owner/repo#3 ` ')).toBe('hi octocat see 12 and owner/repo3');
  });

  it('keeps a lone @ or # that does not precede a word', () => {
    expect(sanitiseNote('cost # 5 @ noon')).toBe('cost # 5 @ noon');
  });
});

describe('takeWithinGeneLimit', () => {
  const known = () => true;

  it('stops before the report that would add one gene too many', () => {
    const rs = [report({ gene: '01A1' }), report({ gene: '01A2' }), report({ gene: '01A1' }), report({ gene: '01A3' })];
    const { taken, full } = takeWithinGeneLimit(rs, new Set<string>(), 2, known);
    expect(taken.map((r) => r.gene)).toEqual(['01A1', '01A2', '01A1']);
    expect(full).toBe(true);
  });

  it('takes unknown genes without using a gene slot', () => {
    const rs = [report({ gene: '99Z1' }), report({ gene: '99Z2' }), report({ gene: '01A1' })];
    const genes = new Set<string>();
    const { taken, full } = takeWithinGeneLimit(rs, genes, 1, (k) => k === 'horse/01A1');
    expect(taken).toHaveLength(3);
    expect(full).toBe(false);
    expect([...genes]).toEqual(['horse/01A1']);
  });
});

describe('issue body', () => {
  it('describes the gene, the first proposal and the count', () => {
    const body = renderIssueBody(report(), { effectDominant: 'None', effectRecessive: 'Virility-' }, 3);
    expect(keyFromIssueBody(body)).toBe('horse/26B3');
    expect(body).toContain('dominant `None`, recessive `Virility-`');
    expect(body).toContain('First report proposes: dominant `Ruggedness+`, recessive `None`');
    expect(body).toContain('Reports so far: **3**');
  });

  it('refreshes only the count line and keeps the rest', () => {
    const body = `${renderIssueBody(report(), { effectDominant: 'None', effectRecessive: 'None' }, 1)}\n\nMaintainer note.`;
    const updated = withReportCount(body, 5);
    expect(updated).toContain('Reports so far: **5**');
    expect(updated).not.toContain('Reports so far: **1**');
    expect(updated).toContain('Maintainer note.');
  });

  it('appends the count line if a maintainer removed it', () => {
    expect(withReportCount('edited body', 2)).toBe('edited body\n\nReports so far: **2** <!-- gene-report-count -->');
  });
});

describe('renderBatchComment', () => {
  it('marks the position of the last report it covers', () => {
    const a = report();
    const b = report();
    const marker = renderBatchComment([a, b]).split('\n')[0];
    expect(marker).toBe(progressMarker({ submittedAt: b.submittedAt, docId: b.id }));
    expect(renderBatchComment([b, a]).split('\n')[0]).toBe(marker);
    expect(postedUpTo(['x', `${marker}\nbody`])).toEqual({ submittedAt: b.submittedAt, docId: b.id });
  });

  it('puts sanitised notes in fenced blocks, newest first, and caps them', () => {
    const rs = Array.from({ length: MAX_NOTES_PER_COMMENT + 3 }, (_, i) => report({ note: `note ${i} @someone` }));
    const comment = renderBatchComment(rs);
    expect(comment).not.toContain('@someone');
    expect(comment.match(/```text/g)).toHaveLength(MAX_NOTES_PER_COMMENT);
    expect(comment.indexOf(`note ${rs.length - 1}`)).toBeLessThan(comment.indexOf('note 3 '));
    expect(comment).not.toContain('note 0 ');
    expect(comment).toContain('3 more note(s) not shown');
  });

  it('orders notes within the same second by full position, newest first', () => {
    const at = 1_700_500_000;
    const older = report({ note: 'older-note', submittedAt: { seconds: at, nanoseconds: 1000 } });
    const newer = report({ note: 'newer-note', submittedAt: { seconds: at, nanoseconds: 2000 } });
    const comment = renderBatchComment([older, newer]);
    expect(comment.indexOf('newer-note')).toBeLessThan(comment.indexOf('older-note'));
  });

  it('skips a note that does not fit the size cap but keeps later ones that do', () => {
    const comment = renderBatchComment([
      report({ note: 'short note' }),
      report({ note: 'm'.repeat(10_000) }),
      report({ note: 'l'.repeat(25_000) }),
    ]);
    expect(comment).toContain('l'.repeat(100));
    expect(comment).not.toContain('m'.repeat(100));
    expect(comment).toContain('short note');
    expect(comment).toContain('1 more note(s) not shown');
  });

  it('skips empty notes', () => {
    expect(renderBatchComment([report({ note: '  ' })])).not.toContain('```');
  });
});

describe('syncGeneReports', () => {
  it('creates one issue per gene with a comment, then writes the cursor', async () => {
    const rs = [report(), report({ gene: '26B4' }), report({ note: 'bred twice' })];
    const store = fakeStore(rs);
    const tracker = fakeTracker();

    const result = await syncGeneReports({ store, tracker, templates: TEMPLATES });

    expect(result).toEqual({ genes: 2, reports: 3, unknown: 0 });
    expect(tracker.createIssue.mock.calls.map((c) => c[0]).sort()).toEqual([
      'Gene report: horse 26B3',
      'Gene report: horse 26B4',
    ]);
    const issue26B3 = [...tracker.issues.values()].find((i) => i.title.endsWith('26B3'));
    expect(issue26B3?.body).toContain('Reports so far: **2**');
    expect(tracker.createComment).toHaveBeenCalledTimes(2);
    expect(store.cursor).toEqual({ submittedAt: rs[2].submittedAt, docId: rs[2].id });
  });

  it('does nothing and keeps the cursor when there are no new reports', async () => {
    const store = fakeStore([]);
    const tracker = fakeTracker();
    expect(await syncGeneReports({ store, tracker, templates: TEMPLATES })).toEqual({
      genes: 0,
      reports: 0,
      unknown: 0,
    });
    expect(store.writeCursor).not.toHaveBeenCalled();
    expect(tracker.listReportIssues).not.toHaveBeenCalled();
  });

  it('skips genes not in the templates without creating issues, and moves the cursor past them', async () => {
    const rs = [report({ gene: '99Z9' }), report({ gene: '98Y8' })];
    const store = fakeStore(rs);
    const tracker = fakeTracker();
    const result = await syncGeneReports({ store, tracker, templates: TEMPLATES, maxGenes: 1 });
    expect(result).toEqual({ genes: 0, reports: 0, unknown: 2 });
    expect(tracker.createIssue).not.toHaveBeenCalled();
    expect(store.cursor?.docId).toBe(rs[1].id);
  });

  it('pages through reports and stops at the gene limit, leaving the rest for the next run', async () => {
    const rs = ['01A1', '01A2', '01A1', '01A3', '01A4'].map((gene) => report({ gene }));
    const store = fakeStore(rs);
    const tracker = fakeTracker();

    await syncGeneReports({ store, tracker, templates: TEMPLATES, maxGenes: 2, pageSize: 2 });
    expect(tracker.createIssue).toHaveBeenCalledTimes(2);
    expect(store.cursor?.docId).toBe(rs[2].id);

    await syncGeneReports({ store, tracker, templates: TEMPLATES, maxGenes: 2, pageSize: 2 });
    expect(tracker.createIssue).toHaveBeenCalledTimes(4);
    expect(store.cursor?.docId).toBe(rs[4].id);
  });

  it('stops at the report limit even when every report is for one gene', async () => {
    const rs = Array.from({ length: 7 }, () => report());
    const store = fakeStore(rs);
    const tracker = fakeTracker();

    const result = await syncGeneReports({ store, tracker, templates: TEMPLATES, maxReports: 5, pageSize: 2 });
    expect(result.reports).toBe(5);
    expect(store.cursor?.docId).toBe(rs[4].id);
    expect(store.pageAfter.mock.calls.map((c) => c[1])).toEqual([2, 2, 1]);
  });

  it('pages correctly when reports share a timestamp', async () => {
    const at = { seconds: 1_700_000_000, nanoseconds: 5 };
    const rs = ['01A1', '01A2', '01A3'].map((gene) => report({ gene, submittedAt: at }));
    const store = fakeStore(rs);
    const tracker = fakeTracker();
    await syncGeneReports({ store, tracker, templates: TEMPLATES, pageSize: 1 });
    expect(tracker.createIssue).toHaveBeenCalledTimes(3);
  });

  it('refreshes the count line and adds a comment on later runs', async () => {
    const store = fakeStore([report(), report()]);
    const tracker = fakeTracker();
    await syncGeneReports({ store, tracker, templates: TEMPLATES });

    store.all.push(report());
    await syncGeneReports({ store, tracker, templates: TEMPLATES });

    const [issue] = tracker.issues.values();
    expect(issue.body).toContain('Reports so far: **3**');
    expect(tracker.bodies(issue.number)).toHaveLength(2);
  });

  it('after a failed run, posts only the reports no comment covers yet, even if more arrived', async () => {
    const a = report({ note: 'note-alpha' });
    const b = report({ note: 'note-beta' });
    const store = fakeStore([a, b]);
    store.writeCursor.mockRejectedValueOnce(new Error('cursor write failed'));
    const tracker = fakeTracker();
    await expect(syncGeneReports({ store, tracker, templates: TEMPLATES })).rejects.toThrow();

    store.all.push(report({ note: 'note-gamma' }));
    await syncGeneReports({ store, tracker, templates: TEMPLATES });

    const [issue] = tracker.issues.values();
    const comments = tracker.bodies(issue.number);
    expect(comments).toHaveLength(2);
    expect(comments[1]).toContain('1 new report(s)');
    expect(comments[1]).toContain('note-gamma');
    expect(comments[1]).not.toContain('note-alpha');
    expect(comments[1]).not.toContain('note-beta');
  });

  it('ignores a forged marker in a comment from another user', async () => {
    const store = fakeStore([report({ note: 'real-note' })]);
    const tracker = fakeTracker([openIssue(7)]);
    const forged = progressMarker({ submittedAt: { seconds: 4_000_000_000, nanoseconds: 0 }, docId: 'z' });
    tracker.comments.set(7, [{ body: forged, login: 'someone' }]);

    await syncGeneReports({ store, tracker, templates: TEMPLATES });
    expect(tracker.createComment).toHaveBeenCalledWith(7, expect.stringContaining('real-note'));
  });

  it('relabels an issue that lost its label instead of creating a second one', async () => {
    const store = fakeStore([report()]);
    const tracker = fakeTracker([{ ...openIssue(9), labelled: false }]);
    await syncGeneReports({ store, tracker, templates: TEMPLATES });
    expect(tracker.createIssue).not.toHaveBeenCalled();
    expect(tracker.addLabel).toHaveBeenCalledWith(9);
    expect(tracker.bodies(9)).toHaveLength(1);
  });

  it('leaves reports younger than the settle time for a later run', async () => {
    const at = 1_800_000_000;
    const old = report({ submittedAt: { seconds: at - SETTLE_MS / 1000 - 1, nanoseconds: 0 } });
    const fresh = report({ gene: '26B4', submittedAt: { seconds: at - 10, nanoseconds: 0 } });
    const store = fakeStore([old, fresh]);
    const tracker = fakeTracker();

    await syncGeneReports({ store, tracker, templates: TEMPLATES, now: at * 1000 });
    expect(tracker.createIssue).toHaveBeenCalledTimes(1);
    expect(store.cursor?.docId).toBe(old.id);

    await syncGeneReports({ store, tracker, templates: TEMPLATES, now: (at + SETTLE_MS / 1000) * 1000 });
    expect(tracker.createIssue).toHaveBeenCalledTimes(2);
  });

  it('reopens a closed issue for a proposal not yet in the templates', async () => {
    const store = fakeStore([report()]);
    const tracker = fakeTracker([openIssue(7, 'closed')]);
    await syncGeneReports({ store, tracker, templates: TEMPLATES });
    expect(tracker.updateIssue).toHaveBeenCalledWith(7, expect.objectContaining({ state: 'open' }));
  });

  it('leaves a closed issue closed when the new report is already applied', async () => {
    const store = fakeStore([report({ proposedDominant: 'Toughness+', bundledDominant: 'Ruggedness+' })]);
    const tracker = fakeTracker([openIssue(7, 'closed')]);
    await syncGeneReports({ store, tracker, templates: TEMPLATES });
    expect(tracker.issues.get(7)?.state).toBe('closed');
  });
});

describe('dryRunTracker', () => {
  it('logs writes instead of making them', async () => {
    const inner = fakeTracker();
    const log = vi.fn();
    const tracker = dryRunTracker(inner, log);
    const issue = await tracker.createIssue('t', 'b');
    await tracker.createComment(issue.number, 'c');
    await tracker.updateIssue(3, { body: 'x' });
    await tracker.addLabel(3);
    expect(inner.addLabel).not.toHaveBeenCalled();
    expect(inner.createIssue).not.toHaveBeenCalled();
    expect(inner.createComment).not.toHaveBeenCalled();
    expect(inner.updateIssue).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(4);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('githubTracker', () => {
  it('lists labelled issues across pages, skipping pull requests and unmarked issues', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      state: 'open',
      body: i === 0 ? issueMarker('horse', '26B3') : 'no marker',
    }));
    const page2 = [
      { number: 200, state: 'closed', body: issueMarker('beewasp', '01A1') },
      { number: 201, state: 'open', body: issueMarker('horse', '01A1'), pull_request: {} },
    ];
    const fetchImpl = vi.fn(async (url: string) => jsonResponse(url.endsWith('&page=1') ? page1 : page2));
    const tracker = githubTracker('o/r', 'tok', fetchImpl as unknown as typeof fetch);

    const issues = await tracker.listReportIssues();
    expect([...issues.keys()].sort()).toEqual(['beewasp/01A1', 'horse/26B3']);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/o/r/issues?labels=gene-report&state=all&per_page=100&page=1',
    );
  });

  it("returns only the bot's own comment bodies", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        { body: 'from bot', user: { login: 'github-actions[bot]' } },
        { body: 'from someone', user: { login: 'someone' } },
        { body: 'no user' },
      ]),
    );
    const tracker = githubTracker('o/r', 'tok', fetchImpl as unknown as typeof fetch);
    expect(await tracker.listCommentBodies(5)).toEqual(['from bot']);

    const local = githubTracker('o/r', 'tok', fetchImpl as unknown as typeof fetch, 'someone');
    expect(await local.listCommentBodies(5)).toEqual(['from someone']);
  });

  it('creates issues with the label and throws on an HTTP error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ number: 5, state: 'open', body: 'b' }, 201))
      .mockResolvedValueOnce(jsonResponse('forbidden', 403));
    const tracker = githubTracker('o/r', 'tok', fetchImpl as unknown as typeof fetch);

    expect(await tracker.createIssue('t', 'b')).toEqual({ number: 5, state: 'open', body: 'b' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ title: 't', body: 'b', labels: ['gene-report'] });
    await expect(tracker.createComment(5, 'c')).rejects.toThrow(/HTTP 403/);
  });

  it('finds an issue by exact title, ignoring near matches and pull requests', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        items: [
          { number: 1, title: 'Gene report: horse 26B31', state: 'open', body: '' },
          { number: 2, title: 'Gene report: horse 26B3', state: 'open', body: '', pull_request: {} },
          { number: 3, title: 'Gene report: horse 26B3', state: 'closed', body: 'b' },
        ],
      }),
    );
    const tracker = githubTracker('o/r', 'tok', fetchImpl as unknown as typeof fetch);
    expect(await tracker.findIssueByTitle('Gene report: horse 26B3')).toEqual({
      number: 3,
      state: 'closed',
      body: 'b',
    });
    expect(decodeURIComponent(String((fetchImpl.mock.calls[0] as unknown[])[0]))).toContain(
      'search/issues?q=repo:o/r is:issue in:title "Gene report: horse 26B3"',
    );
  });
});

describe('loadTemplates', () => {
  it('loads every bundled gene keyed by species/gene', () => {
    const templates = loadTemplates('assets');
    expect(templates.get('horse/26B3')).toEqual({
      effectDominant: expect.any(String),
      effectRecessive: expect.any(String),
    });
    expect(templates.has('beewasp/01A1')).toBe(true);
  });
});
