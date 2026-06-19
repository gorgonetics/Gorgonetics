# Hardening Public Sharing — App Check Scoping (v2)

**Status:** Scoping / decision record. No production code in this doc — it
records why App Check does not fit the v1 constraints and what to do instead.
**Issue:** #280 — "Harden public sharing with Firebase App Check (v2)".
**Source of truth for the live backend:** `firestore.rules`, `src/lib/firebase.ts`.
**Builds on:** `docs/design/public-pet-sharing-v1.md` (§1 constraints, §11 v2 bucket).
**Facts verified:** 2026-06-19 against the sources cited in §7.

---

## 1. The question

The public catalogue is protected only by `firestore.rules`. The web config in
`src/lib/firebase.ts` (`apiKey`, `projectId`, `appId`, …) is a project
identifier, not a secret — extractable from any shipped Tauri binary and
authorizing nothing on its own. Anyone can point their own client at our
Firestore with it.

The rules constrain the **shape** of writes (immutable docs, schema-locked
fields, size/enum caps, content-hash IDs, `existsAfter()` pair-binding) but not
the **volume**. The real exposure on Spark is **quota exhaustion**: a stranger
with the config can spam well-formed `create`s to burn the 20k writes/day or
1 GiB storage cap and take the catalogue offline. Content-hash-as-ID makes
re-uploading the *same* pet idempotent, but distinct junk-but-valid pets still
accumulate.

#280 proposed Firebase App Check as the volume gate: have Firestore honor only
requests that attest they originate from our genuine app build. This doc
evaluates whether that is achievable under the v1 constraints. **It is not** —
and the reasons are structural, not a matter of effort.

## 2. How App Check actually works

App Check attaches an attestation token to each Firestore request. The token is
issued by an **attestation provider**:

- First-party providers tie the token to a platform signal the app cannot
  forge: Play Integrity (Android), App Attest / DeviceCheck (Apple), reCAPTCHA
  Enterprise (web, bound to a registered origin).
- A **custom provider** is for platforms with no first-party signal. The app
  collects some "proof of authenticity," sends it to a **server you run**, and
  that server — running the Firebase Admin SDK — decides whether the proof is
  good and, if so, **mints** the App Check token via
  `appCheck().createToken(appId)`. The minted token is returned to the client,
  which then attaches it to Firestore calls.

Two facts from the official docs (verified 2026-06-19, §7):

1. **Only a trusted server can mint a token.** "Implementing a custom provider
   requires a secure backend environment that can run the Node.js Firebase Admin
   SDK." Clients cannot mint their own tokens — that is the whole point; a
   client-mintable token attests nothing.
2. The server's job is to evaluate a **proof of authenticity** that is
   "[a third-party provider's] or … of your own invention." App Check provides
   no proof signal for desktop — you must invent one.

## 3. Why it does not fit Project Gorgon

### 3a. Desktop (Tauri) has no first-party attestation provider

There is no Play Integrity / App Attest / reCAPTCHA equivalent for a downloaded
desktop executable. So App Check here **must** be a custom provider — exactly as
#280 anticipated.

### 3b. A custom provider needs a server we cannot have on Spark

The minting endpoint must run the Admin SDK. The hosting options Firebase names
are Cloud Functions, Cloud Run, or "your own server."

- **Cloud Functions / Cloud Run are not on Spark.** The official pricing page
  lists Cloud Functions invocations as "Not applicable" on Spark; they require
  the **Blaze** plan, which requires a credit card on file. (§7)
- **"Your own server"** is the proxy hop that `public-pet-sharing-v1.md` §1 and
  §2 explicitly rejected ("no proxy, no separate backend service to maintain";
  GitHub-Releases-as-storage was rejected for the same reason).

So a working custom provider violates either *no card* or *no proxy* — both are
hard v1 constraints, not preferences.

### 3c. Even with a server, a distributed binary cannot prove authenticity

This is the deeper problem, and it would remain even if we accepted Blaze. The
custom-provider model is only as strong as the "proof of authenticity" the
minting server checks. For a **freely distributed, unsigned-secret desktop
binary**, the only proof the app can present is something baked into the binary
(a shared secret, an embedded key, a hard-coded request signature). That
artifact is extractable from the shipped binary by exactly the same reverse
engineering that extracts the public config today.

Once extracted, an abuser replays it against the minting endpoint and obtains
unlimited valid App Check tokens — the gate is open again. App Check's strength
on mobile comes from the OS attesting the app *without* a shipped secret; strip
that away and a custom provider for a public desktop download reduces to
"the client knows a secret that ships in the download." That is the threat model
#280 is trying to escape, not a solution to it.

**Conclusion:** App Check would add cost (Blaze) and a moving part (the minting
service) while delivering friction, not a real volume ceiling. It is the wrong
tool for an anonymous, freely-distributed desktop client.

## 4. What actually limits volume under the v1 constraints

Ranked by effort/value. None is App Check.

### Option A — Do nothing yet; monitor (recommended default)

This is #280's own stance ("No action needed unless abuse actually shows up").
The existing defenses already bound the *shape* of abuse:

- Immutable, schema-locked, create-only rules — junk must still be well-formed.
- Content-hash IDs — re-uploading the same pet is idempotent (one doc, not N).
- `existsAfter()` pair-binding — no orphan half-writes.
- `scripts/monitor-spark-usage.mjs` (`pnpm monitor:spark`) — storage watch.

What's missing is a **write-rate / write-count signal**. Concrete, free step:
add daily writes and reads to the monitor output (or a console budget alert) so
quota-burn abuse is *noticed* early. The escape valve if it ever triggers is the
v1-documented Blaze upgrade — data and rules port unchanged.

### Option B — Firebase Anonymous Auth as a partial gate

Anonymous Auth is free on Spark (no card). On app launch the client signs in
anonymously, getting a stable per-install UID. Rules then require
`request.auth != null` (and can stamp `uploaderUid`).

- **Buys:** the v2 identity layer in `public-pet-sharing-v1.md` §11 — populated
  `uploaderUid`, per-uploader `delete` (`request.auth.uid ==
  resource.data.uploaderUid`), a "My uploads" view. This is the genuinely useful
  half and is independently worth doing.
- **Does NOT buy meaningful volume control:** anonymous sign-ins are unlimited
  and free to mint programmatically, so an abuser scripts fresh UIDs at will. It
  raises the bar marginally (one extra token-exchange call) but is not a quota
  ceiling. Per-UID rate limiting in rules is not feasible without
  `count()`-style aggregates the rules engine can't do cheaply per write.

Recommendation: pursue Anonymous Auth **for the identity/delete features**, not
as the answer to #280's abuse concern. Track it as its own v2 item, not as
"App Check done."

### Option C — Blaze + custom provider + minting Cloud Function

The "real" App Check path. Requires: enable Blaze (card + budget alert), write
and deploy a Cloud Function that mints tokens, invent a client proof-of-
authenticity, register App Check, enable Firestore enforcement. Per §3c the
proof is spoofable for a public desktop binary, so this is **high effort, real
recurring exposure to billing, and limited security gain**. Reserve for a future
where abuse is real *and* the maintainer accepts billing — and even then weigh
it against simply turning on Blaze budget caps and rate-limiting via a thin
Function without the App Check ceremony.

## 5. Recommendation

1. **Close #280 as "won't implement as specified."** App Check cannot harden a
   Spark-hosted, no-proxy, freely-distributed desktop client; the structural
   reasons are in §3.
2. **Adopt Option A now:** extend `monitor-spark-usage.mjs` to report
   writes/reads against the daily caps so quota-burn is *detected*. Cheap,
   no-card, no new moving parts. (Separate small issue.)
3. **Re-file the useful half of the v2 identity bucket as its own issue:**
   Anonymous Auth → `uploaderUid` + per-uploader delete + "My uploads"
   (Option B). Scope it for the delete/ownership features, explicitly *not* as
   abuse mitigation.
4. **Document the Blaze escape valve** (Option C) as the break-glass path if
   abuse materializes and billing becomes acceptable — do not build it
   speculatively.

## 6. What this does NOT change

The rules stay as the access-control layer regardless of which option lands.
GCP-console API-key restrictions (HTTP referrer / API allowlists) remain a
non-substitute — they gate which Google APIs the key may call and are weak for a
desktop client with no origin to pin; they do not gate Firestore document access.

## 7. Sources (verified 2026-06-19)

- App Check custom provider — backend/Admin-SDK requirement, token minting,
  proof-of-authenticity model:
  <https://firebase.google.com/docs/app-check/custom-provider>
- App Check overview (provider types, platform attestation):
  <https://firebase.google.com/docs/app-check>
- Firebase pricing — Cloud Functions / Cloud Run "Not applicable" on Spark,
  Blaze required: <https://firebase.google.com/pricing>
- Anonymous Auth (free on Spark; per-install UID):
  <https://firebase.google.com/docs/auth/web/anonymous-auth>
