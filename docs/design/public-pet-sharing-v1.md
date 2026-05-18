# Public Pet Sharing — v1 Implementation Plan

**Status:** Implemented — see `src/lib/services/shareService.ts` and `firestore.rules` for the authoritative API/schema.
**Scope source:** Scoping discussion 2026-05-09; see `Project: Gorgonetics` Logseq page section `2026-05-09: Public Pet Sharing v1 — Scope`.
**Target:** A centralised, public catalogue where users can upload their pets (genomes + tags + metadata) and others can browse and import them into their local DB. Read-only catalogue + uploads in v1; comments, ratings, and images explicitly out of scope.

> **Implementation drift from this doc** — the sections below describe the
> *original* single-doc schema. The shipped implementation splits the
> catalogue across two collections to keep the metadata-only list path
> cheap:
>
> - **`/pets/{contentHash}`** — metadata only (name, character, species,
>   gender, breed, breeder, notes, tags, schemaVersion, appVersion,
>   uploadedAt, uploaderUid). No `genomeData` field on this doc.
> - **`/genomes/{contentHash}`** — `{ genomeData: string }` only,
>   keyed by the same hash. Written atomically with the metadata via
>   `writeBatch`; rules require both halves to exist via `existsAfter()`.
>
> Consequences:
> - `listPets()` reads `/pets` only — metadata-only `SharedPet`s with
>   `genomeData === undefined`. `getSharedPet(hash)` reads both halves
>   in parallel and returns the combined record.
> - `verifySharedPet` runs on the importer side against the combined
>   record.
> - The Firestore rules in this doc (single `/pets` collection with a
>   `genomeData` field) are out of date; `firestore.rules` is the
>   source of truth.

---

## 1. Goals and constraints

**Goals**
- Centralised place to share pets, replacing the manual export/import for cross-user sharing.
- Direct from the app — no proxy, no separate backend service to maintain.
- Truly free to operate at hobby-community scale with no credit card required.
- Permalinks: a shared pet's URL is stable across shares of the same genome content (uploads are create-only; re-sharing the same genome resolves to the existing document by `content_hash`).

**Constraints**
- No images in v1 — genomes and tags only. Image sharing is deferred until storage costs become tractable (see §11).
- No user authentication in v1. Attribution is the genome's existing `Character` field (player-supplied, trust-based).
- Upload validation lives in security rules, not in app code or a server we run.
- Tauri desktop app talks to the catalogue directly; no second binary or hosted service in this codebase.

## 2. Backend choice — Firebase Firestore (Spark plan)

| Constraint | Why Firestore Spark fits |
|---|---|
| No credit card | Spark plan explicitly requires no payment method (verified against [firebase.google.com/pricing](https://firebase.google.com/pricing) on 2026-05-09). |
| Direct from client | Firebase JS SDK + Security Rules — the client app holds a public config object; security comes from rules, not secret-keeping. |
| No proxy | Rules engine does the validation server-side. |
| Capacity for genomes-and-tags | 1 GiB total / 1 MiB per doc / 50k reads/day / 20k writes/day on Spark. Pet docs are 800 B–2.8 KB (see §8). |
| Vendor risk accepted | Project has decided Google vendor lock is acceptable. |

**Rejected alternatives** (recorded for posterity):
- Cloudflare R2 + D1 + Workers — requires credit card on file, even on free tier.
- Supabase Storage — requires no card, but free projects pause after 7 days of inactivity. Mitigable with a keepalive cron, but adds an external dependency we do not want.
- GitHub Releases as storage — truly free, but requires a token-holding proxy somewhere; user explicitly rejected the proxy hop.
- Firebase Cloud Storage — moved to Blaze-only (paid) on the current pricing page; not available on Spark.
- Firebase Data Connect — 3-month trial then requires Blaze.

## 3. Data model

**Single Firestore collection.** Document ID is `content_hash` of the genome (already computed locally; ensures dedup and stable permalinks).

```
/pets/{content_hash}
  {
    // Identity & display
    name: string,             // pet name from genome [Overview] Entity= line
    character: string,        // attribution from [Overview] Character= line
    species: string,          // 'Horse' | 'BeeWasp' | future
    gender: 'Male' | 'Female',
    breed: string,
    breeder: string,
    notes: string,

    // Categorisation
    tags: string[],           // user tags, capped at 30

    // Schema/version stamps
    schemaVersion: number,    // matches local DB schema_version
    appVersion: string,       // app version that uploaded

    // The genome itself
    genomeData: string,       // raw [Overview]/[Genes] text, identical to local genome_data column

    // Provenance
    uploadedAt: Timestamp,    // serverTimestamp() at write
    uploaderUid: string|null  // null in v1; populated in v2 when anon auth lands
  }
```

**Why store the raw text rather than a parsed `Genome` object?**
- Round-trippability: import path is byte-identical to what was uploaded.
- `content_hash` is computed from this text; storing the text makes verification trivial on import.
- Schema-version-independent: the *parsed* shape (`Genome` interface) can evolve without breaking the catalogue. Only the text format and `schema_version` matter.
- Smaller — no JSON wrapping overhead.

**Why no images?** Cloud Storage is not on Spark. The only no-card option for blobs would require either a proxy (rejected) or base64-into-Firestore (1 MiB doc cap is too small for typical PNG portraits, and would balloon storage usage). Deferred to v2 when an image strategy is actually scoped.

## 4. Security rules

These are the entire backend. One file: `firestore.rules`.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /pets/{contentHash} {
      // Public catalogue — anyone can read.
      allow read: if true;

      // Create-only in v1. content_hash matches doc id is enforced via rule.
      allow create: if request.resource.data.keys().hasOnly([
                        'name', 'character', 'species', 'gender',
                        'breed', 'breeder', 'notes', 'tags',
                        'schemaVersion', 'appVersion', 'genomeData',
                        'uploadedAt', 'uploaderUid'
                      ])
                 && request.resource.data.name is string
                 && request.resource.data.name.size() <= 100
                 && request.resource.data.character is string
                 && request.resource.data.character.size() <= 100
                 && request.resource.data.species in ['Horse', 'BeeWasp']
                 && request.resource.data.tags.size() <= 30
                 && request.resource.data.genomeData is string
                 && request.resource.data.genomeData.size() <= 65536
                 && request.resource.data.schemaVersion is int
                 && contentHash.matches('[a-f0-9]{16,128}')
                 && request.resource.data.uploaderUid == null;

      // Mutations and deletions — handled out-of-band via Firebase console
      // for v1 takedowns. v2 will add uploader-scoped delete.
      allow update, delete: if false;
    }
  }
}
```

**Validation gaps (acknowledged):**
- Rules cannot enforce that `hash(genomeData) == contentHash`. Client must verify on import and reject mismatched docs.
- Rules cannot parse `genomeData` to verify `name`/`character`/`species` match the embedded `[Overview]` block. A malicious client could lie. v1 accepts this — the worst case is mislabelled rows in the catalogue, which can be cleaned up via console takedown.
- 30 tags / 100-char strings / 64 KB genome are generous caps to prevent doc-size abuse, not exact correctness checks.

## 5. Client surface

### `src/lib/firebase.ts` (new, ~20 LOC)
Initialises the SDK with the public Firebase config. Config object checked into the repo — it is not a secret.

```ts
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: '...',           // public, safe to commit
  authDomain: 'gorgonetics.firebaseapp.com',
  projectId: 'gorgonetics',
  // storageBucket and messagingSenderId omitted — not used in v1
};

export const app = initializeApp(firebaseConfig);
export const firestore = getFirestore(app);
```

### `src/lib/services/shareService.ts` (new)

```ts
export interface SharedPet {
  contentHash: string;
  name: string;
  character: string;
  species: string;
  gender: 'Male' | 'Female';
  breed: string;
  breeder: string;
  notes: string;
  tags: string[];
  schemaVersion: number;
  appVersion: string;
  genomeData: string;
  uploadedAt: Date;
  uploaderUid: string | null;
}

export interface ListPetsOpts {
  limit?: number;          // default 50
  after?: SharedPet;       // cursor for pagination
}

/** Upload a local pet to the public catalogue. Idempotent on content_hash. */
export async function uploadPet(pet: Pet): Promise<void>;

/** Page through the catalogue, newest first. */
export async function listPets(opts?: ListPetsOpts): Promise<SharedPet[]>;

/** Fetch one shared pet by content hash. */
export async function getSharedPet(contentHash: string): Promise<SharedPet | null>;

/**
 * Verify a fetched pet's genomeData hashes to its contentHash.
 * Throws if mismatched. Called by import flow.
 */
export function verifySharedPet(pet: SharedPet): void;
```

`uploadPet` uses `setDoc(..., { merge: false })` with the rules' `create`-only path; if the doc already exists (same content_hash), the second upload errors out — that's fine, it means "already shared." Surface as a non-error info toast.

### Local DB integration

Import path reuses existing `petService` insertion logic. The Logseq-flagged dedup behaviour (by `content_hash`) handles the case where a user imports a pet they already have locally. New imports get tagged `community` (or similar — see §13) so they're distinguishable from locally-bred pets.

## 6. UI surface

### Share button on local pets
Add a single action in the existing pet detail/edit view. Opens a small dialog: shows name, character, species, tags as they will appear in the catalogue, plus a confirmation. Calls `uploadPet`, surfaces success/already-shared/error.

Components touched:
- `src/lib/components/GeneEditingView.svelte` (or wherever the per-pet action menu lives — confirm during PR 2).

### Community browser tab
A new top-level tab analogous to the Stable / Compare / Breeding tabs.

```
src/lib/components/community/
  CommunityTab.svelte             # top-level layout
  CommunityPetTable.svelte        # paginated list
  CommunityPetRow.svelte          # one row + Import button
  CommunityPetDetail.svelte       # selected pet detail panel
```

- Tab union extension: `'community'` added to `Tab` in `src/lib/stores/pets.ts`.
- TopBar entry between Compare and Breeding.
- `src/lib/stores/community.svelte.ts` — holds page cursor, tag filter (slice 3), selected pet.

Initial layout: simple paginated table, newest first, columns `Name | Character | Species | Tags | Uploaded`. Click a row → detail panel shows full genome preview + Import button.

## 7. Sync model

**Pull-on-demand only.** No background sync, no full mirror.

- Catalogue list: lazily loaded when the Community tab is first opened. Page size 50, paginated via Firestore cursor.
- Pet import: only when user explicitly clicks Import on a row. Single doc fetch, hash-verify, insert into local DB.

This keeps egress comfortably under the 10 GiB/month Firestore egress cap (see §8) and avoids the "every install pulls everything on launch" pattern that would burn through limits.

## 8. Capacity analysis (against verified Spark limits, 2026-05-09)

Real genome sizes from `data/Genes_*.txt`:

| Sample | Species | Raw size |
|---|---|---|
| Genes_SampleFaeBee.txt | BeeWasp | 496 B |
| Genes_BabyFaeBee178.txt | BeeWasp | 498 B |
| Genes_SampleHorse.txt | Horse | 2.5 KB |
| Genes_Roach.txt | Horse | 2.5 KB |

Doc size with envelope (~300 B for fields above): **~800 B BeeWasp / ~2.8 KB Horse.**

| Spark limit | Per-pet cost | Realistic ceiling |
|---|---|---|
| 1 MiB per doc | ~3 KB | ~370× headroom on the largest pet |
| 1 GiB total storage | ~3 KB worst-case | ~380,000 Horse pets / ~1,300,000 BeeWasp pets |
| 50k reads/day | 1 read per pet listed | Browsing 50 pets at a time = 1000 distinct browser-sessions/day |
| 20k writes/day | 1 write per upload | 20,000 uploads/day |
| 10 GiB/month egress | ~3 KB per fetch | ~3,500,000 pet fetches/month |

For a hobby community these are not tight bounds. The first plausible cap to hit is reads/day if the catalogue ever gets popular — mitigated by Firestore's per-doc fetch model and on-demand sync.

**Escape valve:** if the catalogue outgrows Spark, the upgrade is to Blaze (paid, requires card). All data and rules port over without changes — only billing setup. Explicitly accepted as a future-self problem, not a v1 concern.

## 9. Tauri-specific changes

**CSP additions** in `src-tauri/tauri.conf.json`:

- `connect-src`: append `https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com` (the latter two for v2 auth; harmless to add now).

No `assetProtocol` changes needed — there are no remote images in v1, so the existing local-asset path is untouched.

**No Rust changes.** Firebase is JS-side only.

## 10. Tests

### Unit
- `tests/unit/shareService.test.js` — mock `firebase/firestore` calls; verify the upload payload shape, listPets cursor passing, hash verification rejects tampered docs.

### Integration (against Firestore Emulator)
- `tests/integration/shareService.emulator.test.js` — start `firebase emulators:start --only firestore`, exercise upload → list → import round-trip end-to-end. Validates the rules file is correctly enforcing the schema (each rule violation gets a negative test).

### E2E
- `tests/e2e/community.spec.js` — open Community tab, see the seeded pet, click Import, verify it appears in Stable.

The emulator is the right level for rules testing — running them against the live Spark project would consume real quota.

## 11. Out of scope (v1 → v2 / v3)

**v2 candidates** (anonymous identity layer):
- Firebase Anonymous Auth on app launch → stable per-install UID.
- `uploaderUid` populated; rules permit `delete` only when `request.auth.uid == resource.data.uploaderUid`.
- "My uploads" view; per-user delete UI.

**v3 candidates** (catalogue UX):
- Tag-based filtering with composite indexes.
- Search by character / breeder.
- Catalogue-wide aggregate stats (gene frequency, breed distribution) — Firestore can do this without Data Connect at this doc shape and scale; see §8.

**Deferred indefinitely:**
- Pet images / portraits / galleries — needs a blob storage decision that is currently blocked by "no card" + "no proxy" requirements.
- Comments and ratings — not asked for; would balloon abuse-control work.
- Cross-user breeding study tools (community-wide breeding suggestions) — interesting, but downstream of v3.

## 12. PR breakdown

Five PRs, each independently reviewable. Earlier PRs land behind no UI surface so they cannot break user flows on their own.

### PR 1 — Firebase project + rules + types
**Files**
- `firebase.json`, `.firebaserc` — Firebase CLI config (project alias, points at rules file).
- `firestore.rules` — the rules in §4.
- `firestore.indexes.json` — empty for v1; populated in v3.
- `src/lib/firebase.ts` — SDK init.
- `src/lib/types/index.ts` — add `SharedPet`, `ListPetsOpts`.
- `package.json` — add `firebase` dependency.

**Out-of-repo:**
- Create the `gorgonetics` Firebase project on Spark plan.
- Run `firebase deploy --only firestore:rules`.

**Reviewer focus:** rules correctness against the hostile-input list in §4; that the public Firebase config is genuinely free of secrets; CSP changes don't break local dev.

**Size:** ~150 LOC + rules. No service code, no UI.

---

### PR 2 — `shareService` + emulator tests
**Files**
- `src/lib/services/shareService.ts` — `uploadPet`, `listPets`, `getSharedPet`, `verifySharedPet`.
- `tests/unit/shareService.test.js` — mocked SDK; payload shape, hash verification.
- `tests/integration/shareService.emulator.test.js` — round-trip via Firestore Emulator; one negative test per rule predicate.
- `package.json` scripts: `test:firestore` to spin up the emulator.

**Depends on:** PR 1.

**Reviewer focus:** payload shape exactly matches the rules; emulator tests cover both happy path and each rule rejection; no leak of `firebase/auth` (not used in v1).

**Size:** ~250 LOC + tests. No UI.

---

### PR 3 — Share button (write path UI)
**Files**
- `src/lib/components/GeneEditingView.svelte` — new "Share to community" action with confirmation dialog.
- `src/lib/components/community/SharePetDialog.svelte` — confirmation modal showing what will be uploaded.
- `tests/e2e/community.spec.js` (new file, partial) — share-flow happy path.

**Depends on:** PR 2.

**Reviewer focus:** confirmation dialog shows attribution truthfully (whatever's in the genome's Character field); idempotent re-share gives a friendly "already shared" message; failure modes (network error, validation error) surface clearly.

**Size:** ~200 LOC + test. UI only.

---

### PR 4 — Community browser tab (read path UI)
**Files**
- `src/lib/stores/pets.ts` — extend `Tab` union with `'community'`.
- `src/lib/stores/community.svelte.ts` — new store.
- `src/lib/components/layout/TopBar.svelte` — new tab button.
- `src/lib/components/community/CommunityTab.svelte`, `CommunityPetTable.svelte`, `CommunityPetRow.svelte`, `CommunityPetDetail.svelte`.
- `src/lib/services/petService.ts` — wire community-import path through existing dedup-by-content_hash insertion; tag imported pets `community`.
- `tests/e2e/community.spec.js` — extend with browse → import → verify-in-stable flow.

**Depends on:** PR 1, 2.

**Reviewer focus:** pagination is genuinely lazy; import path uses the existing dedup logic without bypassing it; tab plumbing matches existing tabs (Stable / Compare / Breeding) per the Logseq-noted conventions.

**Size:** ~450 LOC + tests. The biggest PR — most of the user-visible surface.

---

### PR 5 — Soft-cap monitoring (optional)
**Files**
- A small admin-only utility (CLI script under `scripts/`) that reads bucket size + write counts via the Firebase Admin SDK and prints usage vs. Spark limits. Run manually; no in-app surface.

**Depends on:** PR 1.

**Reviewer focus:** does not run in production; uses a separate service-account key not committed to repo; output format readable.

**Size:** ~80 LOC. Tiny. Skippable for v1.

**Decision point:** can be skipped if Firebase's own dashboard suffices. Listed last so v1 ships without it.

---

## 13. Open questions deferred to implementation time

- **Local tag for community-imported pets.** Auto-apply tag `community` (lean), or leave tags exactly as uploaded? Auto-tag is friendlier for filtering but pollutes user tag space.
- **Confirmation dialog scope.** Should re-sharing an already-shared pet succeed silently, or always show "already shared, nothing to do"? Lean toward visible confirmation — first-time UX is rare and worth being explicit about.
- **Notes field privacy.** `notes` is currently a free-text local field that some users may treat as private (per Logseq notes, no convention exists). Default to including in upload, with a "include notes" checkbox in the share dialog defaulting to off? Lean: include with checkbox; users can edit notes before sharing.
- **Pet name uniqueness.** Two users sharing pets with identical names is fine — `content_hash` is the identity. The browser must show character/breeder alongside name to disambiguate.
- **Network error handling.** Single retry on transient failures? Or fail loudly and let the user retry manually? Lean: no automatic retry — the action is rare and user-initiated, surfacing failures is more honest.
