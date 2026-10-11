import { describe, expect, it, vi } from 'vitest';
import {
  batchIdFor,
  buildTally,
  dryRunTracker,
  githubTracker,
  issueMarker,
  keyFromIssueBody,
  loadTemplates,
  MAX_NOTES_PER_COMMENT,
  renderBatchComment,
  renderIssueBody,
  sanitiseNote,
  syncGeneReports,
  takeWithinGeneLimit,
} from '../../scripts/sync-gene-reports.mjs';

// Covers the sync logic with an in-memory report store and issue tracker.
// The Firestore adapter's query order is covered against the emulator in
// tests/integration/syncGeneReports.emulator.test.ts.

type Report = Parameters<typeof buildTally>[0][number];
type Issue = { number: number; state: 'open' | 'closed'; body: string };

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
    submittedAt: { seconds: 1_790_000_000 + seq, nanoseconds: 0 },
    ...overrides,
  };
}

const TEMPLATES = new Map([
  ['horse/26B3', { effectDominant: 'Toughness+', effectRecessive: 'None' }],
  ['horse/26B4', { effectDominant: 'None', effectRecessive: 'Virility-' }],
]);

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
    pageAfter: vi.fn(async (c: typeof cursor, limit: number) =>
      [...all]
        .sort((a, b) => {
          const [x, y] = [order(a), order(b)];
          return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
        })
        .filter((r) => !c || after(r, c))
        .slice(0, limit),
    ),
    reportsForGene: vi.fn(async (species: string, gene: string) =>
      all.filter((r) => r.species === species && r.gene === gene),
    ),
  };
}

function fakeTracker(initial: Issue[] = []) {
  const issues = new Map(initial.map((i) => [i.number, { ...i }]));
  const comments = new Map<number, string[]>();
  let next = 100;
  return {
    issues,
    comments,
    listReportIssues: vi.fn(async () => {
      const byKey = new Map<string, Issue>();
      for (const i of issues.values()) {
        const key = keyFromIssueBody(i.body);
        if (key) byKey.set(key, { ...i });
      }
      return byKey;
    }),
    createIssue: vi.fn(async (_title: string, body: string) => {
      const issue: Issue = { number: next++, state: 'open', body };
      issues.set(issue.number, issue);
      return { ...issue };
    }),
    updateIssue: vi.fn(async (number: number, patch: { body?: string; state?: 'open' }) => {
      const i = issues.get(number);
      if (i) Object.assign(i, patch);
    }),
    listCommentBodies: vi.fn(async (number: number) => comments.get(number) ?? []),
    createComment: vi.fn(async (number: number, body: string) => {
      comments.set(number, [...(comments.get(number) ?? []), body]);
    }),
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
  it('stops before the report that would add one gene too many', () => {
    const rs = [report({ gene: '01A1' }), report({ gene: '01A2' }), report({ gene: '01A1' }), report({ gene: '01A3' })];
    const genes = new Set<string>();
    const { taken, full } = takeWithinGeneLimit(rs, genes, 2);
    expect(taken.map((r) => r.gene)).toEqual(['01A1', '01A2', '01A1']);
    expect(full).toBe(true);
  });
});

describe('buildTally and renderIssueBody', () => {
  it('counts each proposal, marks one equal to the current template as applied', () => {
    const tally = buildTally(
      [
        report(),
        report(),
        report({ proposedDominant: 'Toughness+', proposedRecessive: 'None', templateBundleHash: 'd'.repeat(64) }),
      ],
      TEMPLATES.get('horse/26B3'),
    );
    expect(tally.total).toBe(3);
    expect(tally.proposals).toEqual([
      { dominant: 'Ruggedness+', recessive: 'None', count: 2, applied: false },
      { dominant: 'Toughness+', recessive: 'None', count: 1, applied: true },
    ]);

    const body = renderIssueBody('horse', '26B3', TEMPLATES.get('horse/26B3'), tally);
    expect(body.startsWith(issueMarker('horse', '26B3'))).toBe(true);
    expect(keyFromIssueBody(body)).toBe('horse/26B3');
    expect(body).toContain('| `Ruggedness+` | `None` | 2 |');
    expect(body).toContain('already applied');
    expect(body).toContain('`cccccccccccc` (2)');
  });
});

describe('renderBatchComment', () => {
  it('has a marker derived from the report IDs, independent of order', () => {
    const a = report();
    const b = report();
    const first = renderBatchComment([a, b]).split('\n')[0];
    expect(first).toBe(renderBatchComment([b, a]).split('\n')[0]);
    expect(first).toContain(batchIdFor([a.id, b.id]));
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

  it('skips empty notes', () => {
    expect(renderBatchComment([report({ note: '  ' })])).not.toContain('```');
  });
});

describe('syncGeneReports', () => {
  it('creates one issue per gene with a comment, then writes the cursor', async () => {
    const rs = [report(), report({ gene: '26B4', proposedRecessive: 'None' }), report({ note: 'bred twice' })];
    const store = fakeStore(rs);
    const tracker = fakeTracker();

    const result = await syncGeneReports({ store, tracker, templates: TEMPLATES });

    expect(result).toEqual({ genes: 2, reports: 3 });
    expect(tracker.createIssue).toHaveBeenCalledTimes(2);
    expect(tracker.createIssue.mock.calls.map((c) => c[0]).sort()).toEqual([
      'Gene report: horse 26B3',
      'Gene report: horse 26B4',
    ]);
    expect(tracker.createComment).toHaveBeenCalledTimes(2);
    expect(store.cursor).toEqual({ submittedAt: rs[2].submittedAt, docId: rs[2].id });
  });

  it('does nothing and keeps the cursor when there are no new reports', async () => {
    const store = fakeStore([]);
    const tracker = fakeTracker();
    expect(await syncGeneReports({ store, tracker, templates: TEMPLATES })).toEqual({ genes: 0, reports: 0 });
    expect(store.writeCursor).not.toHaveBeenCalled();
    expect(tracker.listReportIssues).not.toHaveBeenCalled();
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

  it('pages correctly when reports share a timestamp', async () => {
    const at = { seconds: 1_800_000_000, nanoseconds: 5 };
    const rs = ['01A1', '01A2', '01A3'].map((gene) => report({ gene, submittedAt: at }));
    const store = fakeStore(rs);
    const tracker = fakeTracker();
    await syncGeneReports({ store, tracker, templates: TEMPLATES, pageSize: 1 });
    expect(tracker.createIssue).toHaveBeenCalledTimes(3);
  });

  it('rebuilds the tally from all reports of the gene, not only the new ones', async () => {
    const store = fakeStore([report(), report()]);
    const tracker = fakeTracker();
    await syncGeneReports({ store, tracker, templates: TEMPLATES });

    store.all.push(report());
    await syncGeneReports({ store, tracker, templates: TEMPLATES });

    const [issue] = tracker.issues.values();
    expect(issue.body).toContain('| `Ruggedness+` | `None` | 3 |');
    expect(tracker.comments.get(issue.number)).toHaveLength(2);
  });

  it('does not post a batch comment twice when the cursor write failed', async () => {
    const store = fakeStore([report()]);
    store.writeCursor.mockRejectedValueOnce(new Error('cursor write failed'));
    const tracker = fakeTracker();

    await expect(syncGeneReports({ store, tracker, templates: TEMPLATES })).rejects.toThrow('cursor write failed');
    await syncGeneReports({ store, tracker, templates: TEMPLATES });

    expect(tracker.createIssue).toHaveBeenCalledTimes(1);
    expect(tracker.createComment).toHaveBeenCalledTimes(1);
    expect(tracker.updateIssue).not.toHaveBeenCalled();
  });

  it('reopens a closed issue for a proposal not yet in the templates', async () => {
    const store = fakeStore([report()]);
    const tracker = fakeTracker([{ number: 7, state: 'closed', body: issueMarker('horse', '26B3') }]);
    await syncGeneReports({ store, tracker, templates: TEMPLATES });
    expect(tracker.updateIssue).toHaveBeenCalledWith(7, expect.objectContaining({ state: 'open' }));
  });

  it('leaves a closed issue closed when the new report is already applied', async () => {
    const store = fakeStore([report({ proposedDominant: 'Toughness+', bundledDominant: 'Ruggedness+' })]);
    const tracker = fakeTracker([{ number: 7, state: 'closed', body: issueMarker('horse', '26B3') }]);
    await syncGeneReports({ store, tracker, templates: TEMPLATES });
    expect(tracker.updateIssue).toHaveBeenCalledWith(7, { body: expect.any(String) });
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
    expect(inner.createIssue).not.toHaveBeenCalled();
    expect(inner.createComment).not.toHaveBeenCalled();
    expect(inner.updateIssue).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(3);
  });
});

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
    const fetchImpl = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith('&page=1') ? page1 : page2),
      text: async () => '',
    }));
    const tracker = githubTracker('o/r', 'tok', fetchImpl as unknown as typeof fetch);

    const issues = await tracker.listReportIssues();
    expect([...issues.keys()].sort()).toEqual(['beewasp/01A1', 'horse/26B3']);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/o/r/issues?labels=gene-report&state=all&per_page=100&page=1',
    );
  });

  it('creates issues with the label and throws on an HTTP error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ number: 5, state: 'open', body: 'b' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'forbidden' });
    const tracker = githubTracker('o/r', 'tok', fetchImpl as unknown as typeof fetch);

    expect(await tracker.createIssue('t', 'b')).toEqual({ number: 5, state: 'open', body: 'b' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ title: 't', body: 'b', labels: ['gene-report'] });
    await expect(tracker.createComment(5, 'c')).rejects.toThrow(/HTTP 403/);
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
