# Firebase setup — public pet sharing

This file documents the **out-of-repo** steps required to bring the public
pet sharing catalogue online. The in-repo scaffolding (rules, types, SDK
init) lives alongside this file; everything below has to be done **once**
by a maintainer with access to a Google account.

See `docs/design/public-pet-sharing-v1.md` for the design rationale.

## One-time project creation

1. Visit <https://console.firebase.google.com> and create a new project.
   The **project ID** must be **`gorgonetics`** (not just the display
   name) — `.firebaserc` and the SDK config both pin that exact ID, so a
   mismatched ID leaves the CLI target and config out of sync. Firebase
   may suffix the ID if `gorgonetics` is taken; if so, use the resulting
   ID consistently in `.firebaserc` and `src/lib/firebase.ts`. Stay on
   the default **Spark** plan (no card required).
2. In the project, open **Build → Firestore Database → Create database**.
   - Mode: **Production** (rules deny by default).
   - Location: any region close to the user base — e.g. `eur3` for
     multi-region Europe.
3. In **Build → Authentication**, leave all providers disabled for v1.
   (v2 will enable Anonymous Auth.)
4. In **Project settings → Your apps**, register a new **Web app**
   (no hosting needed). Copy the printed config object.

## Wire the public config into the repo

Replace the placeholder block in `src/lib/firebase.ts` with the real
values from step 4 above:

```ts
const firebaseConfig = {
  apiKey: '…',
  authDomain: 'gorgonetics.firebaseapp.com',
  projectId: 'gorgonetics',
  storageBucket: 'gorgonetics.firebasestorage.app',
  messagingSenderId: '…',
  appId: '…',
};
```

These values are **public** — they identify the project, they do not
authorise writes. Security comes from `firestore.rules`, not from hiding
this config. Commit it.

## Deploy rules

`firebase-tools` is checked in as a `devDependency`, so any pnpm-managed
workspace already has it available. Use `pnpm exec firebase` (or install
it globally with `npm i -g firebase-tools` if you prefer).

```bash
pnpm exec firebase login
pnpm exec firebase use gorgonetics
pnpm exec firebase deploy --only firestore:rules
pnpm exec firebase deploy --only firestore:indexes   # empty in v1
```

Both files are checked in at the repo root:

- `firebase.json` — points the CLI at `firestore.rules` + indexes.
- `.firebaserc` — pins the `default` project alias to `gorgonetics`.
- `firestore.rules` — the entire backend (see design §4).
- `firestore.indexes.json` — empty for v1; populated when filtering lands.

## Integration tests against the Firestore Emulator

`pnpm test:firestore` runs the integration suite in
`tests/integration/shareService.emulator.test.js`. Under the hood it
wraps `vitest` in `firebase emulators:exec --only firestore`, so the
emulator is spun up before tests and torn down after.

**Prerequisite:** the Firestore Emulator is a JVM application. Install
any Java 17+ runtime (e.g. `brew install --cask temurin`). If `java`
isn't on `PATH`, point at it explicitly:

```bash
JAVA_HOME="$(/usr/libexec/java_home -v 17)" PATH="$JAVA_HOME/bin:$PATH" pnpm test:firestore
```

CI installs Temurin 21 via `actions/setup-java`, so the
`firestore-emulator` job in `.github/workflows/integration.yml` works out
of the box. To run the emulator interactively for ad-hoc debugging:

```bash
pnpm exec firebase emulators:start --only firestore --project demo-gorgonetics
```

It binds to `localhost:8080` (Firestore) + `localhost:4000` (emulator
UI) per `firebase.json`. The `demo-` project ID prefix tells the SDK to
skip Google-side config validation, so the local emulator works even
when `src/lib/firebase.ts` still has its placeholder `apiKey`.

## Takedowns (v1)

There is no in-app delete in v1. To remove an offending pet:

1. Open the Firebase console → Firestore → `pets/{contentHash}`.
2. Delete the document.

v2 will add anonymous-auth-scoped self-delete and a "My uploads" view.

## Spark soft-cap monitoring

`scripts/monitor-spark-usage.mjs` reads every doc in `/pets` and
`/genomes` via the Firebase Admin SDK and prints estimated storage
usage against Spark's 1 GiB Firestore cap. Reads/writes/egress
quotas stay on the Firebase console dashboard (the script only
covers storage).

### One-time setup

1. Firebase console → Project settings → **Service accounts** →
   **Generate new private key**. Save the JSON file OUTSIDE this
   repo — `~/.config/gorgonetics/firebase-admin-key.json` is a
   reasonable default. The `.gitignore` blocks
   `*service-account*.json` and `firebase-admin-key*.json` at the
   repo root as a defensive net.

2. Keep the key local; do NOT share it via chat/email. It carries
   project-wide admin privileges that bypass the security rules.

### Running

```bash
FIREBASE_SERVICE_ACCOUNT_PATH=~/.config/gorgonetics/firebase-admin-key.json \
  pnpm monitor:spark
```

Output:

```
Spark plan — Firestore storage snapshot
───────────────────────────────────────
Project:                gorgonetics
/pets docs:             1,247  (3.1 MiB)
/genomes docs:          1,247  (62.8 MiB)
Total estimated:        65.9 MiB of 1.00 GiB (6.4%)  [OK]

Reads/writes/egress quotas are tracked on the Firebase console
dashboard — this script only covers the storage cap.
```

Exit code: `0` for OK/WARN (≥75%), `2` for OVER (≥100%). The
non-zero exit at OVER means the script can be wired into a cron/CI
alert later without parsing stdout.
