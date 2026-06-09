/**
 * Reactive async resource keyed by a value.
 *
 * Runs `fetcher(key)` whenever `key()` changes, rejects stale in-flight
 * results (last key wins, so a superseded fetch can never overwrite the
 * current one), and exposes reactive `{ loading, value, error }`. A
 * `null`/`undefined` key clears the resource without fetching. Re-renders
 * that leave the key unchanged do NOT refetch.
 *
 * This is the shared form of the lazy-load-by-key pattern used across the
 * community UI (SharePetDialog, CommunityPetDetail) — previously each
 * component hand-rolled its own stale guard (a `cancelled` flag vs a
 * `loadedHash` token), which is easy to get subtly wrong. Call it once
 * during component initialisation (it registers a `$effect`).
 *
 * @template K, V
 * @param {() => K | null | undefined} key   reactive key accessor
 * @param {(key: K) => Promise<V>} fetcher    async loader for a key
 * @returns {{ loading: boolean, value: V | undefined, error: unknown }}
 */
export function keyedResource(key, fetcher) {
  const state = $state({ loading: false, value: undefined, error: null });
  // Plain (non-reactive) bookkeeping so writing to it never re-triggers the
  // effect. `activeKey` dedupes benign re-renders; `token` discards stale
  // resolutions.
  let activeKey;
  let token = 0;

  $effect(() => {
    const k = key();
    if (k === null || k === undefined) {
      activeKey = k;
      state.loading = false;
      state.value = undefined;
      state.error = null;
      return;
    }
    // Same key, effect re-fired for an unrelated reactive read — don't refetch.
    if (k === activeKey) return;
    activeKey = k;
    const my = ++token;
    state.loading = true;
    state.value = undefined;
    state.error = null;
    Promise.resolve(fetcher(k))
      .then((v) => {
        if (my === token) state.value = v;
      })
      .catch((e) => {
        if (my === token) state.error = e;
      })
      .finally(() => {
        if (my === token) state.loading = false;
      });
  });

  return state;
}
