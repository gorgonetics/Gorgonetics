# Gene Effect Reports — v1 Design

**Status:** Proposed.
**Target:** When a user corrects a gene effect in the Genes tab, the user can send the correction to the maintainer. Each report becomes a GitHub issue that the maintainer checks, and a confirmed correction ships in the bundled gene templates. Users do not need a GitHub account.

---

## 1. Goals and constraints

**Goals**
- Users can report gene-effect corrections from inside the app, with no account of any kind.
- Reports arrive in GitHub, grouped by gene, with a count of how many reports agree.
- No secret ships in the app binary.

**Constraints** (the same as [public pet sharing](public-pet-sharing-v1.md))
- No user authentication. Firebase App Check does not fit a desktop binary ([app-check-public-sharing-v2.md](app-check-public-sharing-v2.md)).
- Firebase Spark plan only: no Cloud Functions, no card on file.
- No token-holding proxy or other hosted service.
- Sending is opt-in. The app never sends a report without an explicit user action.

## 2. Architecture

```
GeneEditingView ──(user clicks "Report")──▶ Firestore /geneReports   (create-only, rules-validated)
                                                     │
                     GitHub Action (daily cron) ◀────┘ reads new reports with firebase-admin
                                │
                                ▼
                     one issue per gene, label `gene-report`, opened by github-actions[bot]
                                │
                                ▼
                     maintainer checks in game, edits assets/<species>/*.json in a normal PR
```

The client uses the Firestore setup that pet sharing already has (`src/lib/firebase.ts`; the CSP already allows `firestore.googleapis.com`). The Action holds the only credentials: a Firebase service-account key as a repo secret, and the built-in `GITHUB_TOKEN` with `issues: write`.

### Rejected alternatives

| Option | Why rejected |
|---|---|
| GitHub token or GitHub App key in the app | Anyone can extract it from the binary. Abuse would need revocation, which breaks every installed copy. |
| Relay server (Cloudflare Worker, Cloud Function) holding a GitHub App key | A second backend to run. Cloud Functions needs Blaze. The project already rejected token-holding proxies for pet sharing. |
| Pre-filled "new issue" URL opened in the browser | Needs a GitHub account, which most users do not have. Kept as a possible secondary link for users who do (§10). |

## 3. What a report contains

The baseline is the **bundled template value**, not the value in the local DB when the view loaded. `GeneEditingView` keeps `originalGenes` as the DB state at load time, so it is the wrong baseline: after one save, a second edit would report the user's own earlier edit as the original.

The report surface therefore compares the `genes` table with the bundled templates (`loadBundledResource`, as `refreshGeneTemplatesIfChanged` in `demoService.ts` already does). It lists every gene whose `effectDominant` or `effectRecessive` differs, including edits from earlier sessions.

Scope is effects only. Changes to `appearance` and `notes` are not reported in v1.

## 4. Data model

`/geneReports/{docId}` — one document per reported gene.

| Field | Type | Notes |
|---|---|---|
| `species` | `'horse' \| 'beewasp'` | Matches `TEMPLATE_SPECIES` and `assets/<species>/`. |
| `gene` | string | Gene ID, for example `26B3`. |
| `bundledDominant`, `bundledRecessive` | string | Template value on the reporter's install. |
| `proposedDominant`, `proposedRecessive` | string | The user's value. |
| `note` | string, 0–1000 chars | Free text. Always present; empty when the user writes nothing. |
| `templateBundleHash` | string, 64 hex chars | `genes.templateBundleHash` setting (SHA-256 of the bundle). Tells which template version the baseline came from. |
| `appVersion` | string, 1–32 chars | `__APP_VERSION__`, as in `shareService.ts`. |
| `schemaVersion` | int | `1` in v1. |
| `submittedAt` | timestamp | Must equal `request.time`. |

All eleven fields are required. No other field is allowed.

Effect strings are `None` or `<Attribute>+` / `<Attribute>-` (`configService.getEffectOptionsForSpecies`). The full string goes into the report so that a wrong attribute is visible, not only a wrong sign. The study cannot detect about half of these misattributions, so user reports cover a real gap.

**Document ID** = SHA-256 hex of `installId | species | gene | proposedDominant | proposedRecessive`. `installId` is a random UUID that the app creates once and stores in local settings. It is never sent as a field. Because the rules allow create only, a second send of the same correction from the same install fails, so one install counts once per proposal. The rules cannot check the hash, so this stops honest duplicates, not an attacker.

## 5. Security rules

Add to `firestore.rules`, in the style of `/pets`:

```
function effectsFor(species) {
  return {
    'horse':   ['None', 'Enthusiasm+', 'Enthusiasm-', 'Friendliness+', 'Friendliness-',
                'Intelligence+', 'Intelligence-', 'Ruggedness+', 'Ruggedness-',
                'Temperament+', 'Temperament-', 'Toughness+', 'Toughness-', 'Virility+', 'Virility-'],
    'beewasp': ['None', 'Enthusiasm+', 'Enthusiasm-', 'Ferocity+', 'Ferocity-',
                'Friendliness+', 'Friendliness-', 'Intelligence+', 'Intelligence-',
                'Ruggedness+', 'Ruggedness-', 'Toughness+', 'Toughness-', 'Virility+', 'Virility-']
  }[species];
}

function isValidGeneReport(d) {
  return d.keys().hasAll(REPORT_KEYS) && d.keys().hasOnly(REPORT_KEYS)
    && d.species in ['horse', 'beewasp']
    && d.gene is string && d.gene.matches('^[0-9]{2}[A-Z][0-9]$')
    && d.bundledDominant   is string && d.bundledDominant   in effectsFor(d.species)
    && d.bundledRecessive  is string && d.bundledRecessive  in effectsFor(d.species)
    && d.proposedDominant  is string && d.proposedDominant  in effectsFor(d.species)
    && d.proposedRecessive is string && d.proposedRecessive in effectsFor(d.species)
    && (d.proposedDominant != d.bundledDominant || d.proposedRecessive != d.bundledRecessive)
    && d.note is string && d.note.size() <= 1000
    && d.templateBundleHash is string && d.templateBundleHash.matches('^[a-f0-9]{64}$')
    && d.appVersion is string && d.appVersion.size() >= 1 && d.appVersion.size() <= 32
    && d.schemaVersion is int && d.schemaVersion == 1
    && d.submittedAt is timestamp && d.submittedAt == request.time;
}

match /geneReports/{docId} {
  allow get: if true;     // by ID only: lets a client tell a duplicate from a refusal
  allow list: if false;   // the Action reads with the Admin SDK, which bypasses rules
  allow create: if docId.matches('^[a-f0-9]{64}$') && isValidGeneReport(request.resource.data);
  allow update, delete: if false;
}
```

`REPORT_KEYS` stands for the eleven field names in §4, written out in full in the real rules. A document is then at most about 1.4 KB, so a single report cannot be padded.

Every gene ID in `assets/` is four characters and matches `^[0-9]{2}[A-Z][0-9]$` (checked 2026-10-11). The effect lists are per species, from `CORE_ATTRIBUTES` plus `SPECIES_ATTRIBUTES` in `configService.ts`: Horse has Temperament, BeeWasp has Ferocity. They match the effects that occur in `assets/<species>/`. When an attribute is added to `configService.ts`, the rules must change with it; a unit test compares the two (§11).

Clients cannot list reports. They can get one by ID, so that a client whose create was denied can check whether the report is already on the server (a duplicate) or was refused. Only the reporting install can derive an ID, because it is salted with the local install ID, so this exposes no one else's reports. The check runs only after a denial, never on the normal path.

## 6. Client

- **`src/lib/services/geneReportService.ts`** (new): `findReportableChanges(species, chromosome)` gives the diff against the bundle. `submitGeneReports(changes, note)` writes one document per gene as independent creates, not one batch: a batch fails as a whole, so one duplicate would block the new reports with it. After a rules denial, the client gets the doc by ID: the report counts as a duplicate (and is recorded as sent) only if the doc exists. A missing doc or a failed check is a refusal, and the change stays reportable. It writes at most 50 genes per submission (one chromosome is the normal case).
- **Local record:** store the doc IDs that were sent in settings, so that the UI shows "Reported" and does not offer the same correction again.
- **UI in `GeneEditingView`:** a "Report changes upstream" button. It is shown when the current chromosome has genes that differ from the bundle. It opens a dialog that shows every field that will be sent: species, gene, bundled → proposed effects, note, template version (`templateBundleHash`), app version and schema version, plus "submission time: set by the server". It also says that the data goes to a public-project database. Sending needs a second click.
- **Size limits in the client:** the note field has `maxlength="1000"`, and `submitGeneReports` checks every field against the §5 limits before any network call and refuses to send if one fails. This gives honest users an early error. It is not the security control: a modified client can skip it, so the rules (§5) are what reject an oversized report.
- **Offline / failure:** each write has a 20 s timeout, because offline Firestore queues a write and never rejects it. Show the error and keep the changes reportable. A timed-out write may still go out later; the next send of it is then a duplicate, which the get-by-ID check detects. No retry queue in v1.

## 7. GitHub Action

`.github/workflows/gene-reports.yml`: runs on `schedule` (daily) and `workflow_dispatch`, with `permissions: issues: write, contents: read`. It runs `scripts/sync-gene-reports.mjs` (`firebase-admin` is already a dev dependency).

Firestore holds the reports and the cursor. Each issue body is written once and then only its count line is refreshed; comments carry the per-run detail.

1. **Find new reports.** Read the cursor `(submittedAt, docId)` from `/meta/geneReportSync` (an Admin-only document; clients cannot read it because no rule matches it). Query `geneReports` ordered by `submittedAt`, then document ID, starting after the cursor, in pages of 200. The two-part order makes paging deterministic when timestamps are equal. Only reports more than 5 minutes old are taken, so the cursor cannot pass a report that becomes visible after a later-stamped one.
2. **Bound the run.** Take reports in order until 5,000 reports or 20 distinct genes. The last report taken is the new cursor; the rest wait for the next run. Reports for a gene that is not in the current templates on `main` (a made-up ID that passes the rules' format check) are skipped: they move the cursor but use no gene slot and create no issue, so they cannot block real reports.
3. **Count.** For each picked gene, count all its reports with a Firestore aggregation query (equality filters on `species` and `gene`, no composite index). The count runs on the server, at about one read per 1,000 reports, so a flood on one gene loads nothing into memory.
4. **Write the issue.** Find the issue with label `gene-report` and hidden body marker `<!-- gene-report:horse/26B3 -->`. If none has the label, search for the exact title (`Gene report: horse 26B3`) and put the label back, so that a removed label does not cause a duplicate. Otherwise create the issue. A new issue body holds the gene, its template on `main`, the first report's proposal and a "Reports so far: N" line. Later runs replace only that line, so maintainer edits elsewhere in the body stay.
5. **Comment once per report.** One comment per gene per run, for its new reports: each proposal with its count, and the notes. Each comment carries `<!-- gene-report-upto:<submittedAt>:<docId> -->`, the position of the last report it covers. Before posting, drop the new reports at or before the highest marker on the issue, so a retry after a failed cursor write posts only reports no comment covers yet. Only markers in comments by the workflow's own identity (`github-actions[bot]`) count: anyone can comment on a public issue, and a forged far-future marker would otherwise stop all later comments.
6. **Reopen.** If the issue is closed and a new report proposes a value that is not the current template, reopen it.
7. **Write the cursor last**, after every picked gene is done, so that a failed run repeats rather than skips.

**Untrusted text and size limits.** `note` is user input. Put it in the issue only inside a fenced code block. Remove backticks from it, and remove `@` and `#` before word characters, so that a note cannot mention users or link issues. GitHub limits an issue body or comment to 65,536 characters, so:
- The issue body has a fixed size: one gene, one proposal, one count.
- A comment lists at most 15 × 15 distinct proposals (the per-species effect lists) and at most the 20 newest non-empty notes, sorted newest first by full position, with at most 30,000 characters of note text. It says how many notes it left out. All notes stay in Firestore.

The limits of 20 genes and 5,000 reports per run bound each run's reads, runtime and GitHub writes. A flood shows as large counts on a few issues, not as hundreds of issues; a backlog drains over later runs.

## 8. Abuse and quota

Without authentication, the rate of writes cannot be limited per sender. This is the same exposure that `/pets` has now.

- Strict field rules and size limits stop junk content. They do not stop junk volume.
- The same applies to reads. The get-by-ID that duplicate detection needs is unauthenticated, so a flood of gets could use up the daily read quota. This is not a new exposure: `/pets` and `/genomes` already allow unlimited reads. The client only issues the get after a denied create.
- **Oversized payloads.** A report with a huge note fails the rules and stores nothing, so it cannot fill storage. The `/geneReports` rules call no `get()` or `exists()`, so a denied write causes no rule reads, and denied requests do not count toward network bandwidth ([Firestore pricing](https://firebase.google.com/docs/firestore/pricing)). **Unverified:** whether a denied write counts toward the 20k writes/day quota. The docs do not say. Check this in the emulator or the console usage graphs before implementation. Either way, the quota risk is the number of requests, not their size.
- Spark allows 20k writes/day for the whole project (figure from [public-pet-sharing-v1.md](public-pet-sharing-v1.md) §2, verified 2026-05-09). A flood of reports could use up the day's quota and block pet sharing until the quota resets. On Spark this costs no money.
- If this happens, the fix is a second Spark project only for reports, which isolates its quota. Not done in v1 because it adds a second Firebase config to the client.
- Extend `scripts/monitor-spark-usage.mjs` to count `geneReports`.

## 9. Gotcha: template refresh erases user effect edits

`refreshGeneTemplatesIfChanged` keeps only `notes` when a new template bundle arrives. Effect edits are overwritten without a warning. A user who edits an effect, does not report it, and then installs an update loses the correction, and the report surface has nothing to show. This feature does not fix that. It does make reporting before an update more useful. Preserving or warning about effect edits on refresh is a separate issue.

## 10. Out of scope (v1)

- Automatic PRs that change `assets/`. A possible v2: a `confirmed` label on the issue triggers a PR from the winning proposal.
- Reports for `appearance` or `notes`.
- Showing other users' reports in the app.
- A pre-filled GitHub issue link for users who have an account.
- Contact details or in-game names in reports.

## 11. Tests

- **Rules** (`pnpm test:firestore`, emulator): valid create passes for each species. Each of these fails: a missing field, an extra field, each field with the wrong type, a bad species, a gene ID that does not match, an effect of the other species (`Ferocity+` for horse, `Temperament+` for beewasp), a proposal equal to bundled, a note over 1000 chars, a `templateBundleHash` that is not 64 hex chars, an `appVersion` of 0 or 33 chars, `schemaVersion` other than 1, `submittedAt` not server time, a doc ID that is not 64 hex chars, a collection query, update, delete, and a second create with the same ID. A get by ID succeeds for an existing doc and finds nothing for an unknown ID.
- **Unit:** `findReportableChanges` against a fixture bundle. Doc-ID hashing is stable. The per-species effect lists in `firestore.rules` equal `configService.getEffectOptionsForSpecies`. Sync script: paging with equal timestamps, the 20-gene stop and its cursor, tally rebuilt from all reports of a gene, "already applied", the batch marker preventing a second comment on retry, note sanitising, and note truncation.
- **E2E:** edit an effect, save, open the report dialog and check the preview. E2E blocks Firestore, so the send path and the "Reported" state are in a component test with the service mocked (`tests/unit/geneReportDialog.test.ts`).

## 12. PR breakdown

1. Rules, types and emulator tests.
2. `geneReportService`, the dialog and E2E tests.
3. Sync script, workflow, the repo secret and the `gene-report` label. Document the secret setup in `docs/firebase-setup.md`.

## 13. Open questions

- Should the report button also appear after a save, or only in the chromosome toolbar?
- Is one count per install per proposal the right weight, or should the issue show proposals only and leave weighting to the maintainer?
- Daily cron, or more often? Daily keeps Action minutes and Firestore reads low.
