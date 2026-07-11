export interface KeyedResource<V> {
  loading: boolean;
  value: V | undefined;
  error: unknown;
}

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
 * community UI (SharePetDialog, CommunityPetVisualization) — previously each
 * component hand-rolled its own stale guard (a `cancelled` flag vs a
 * `loadedHash` token), which is easy to get subtly wrong. Call it once
 * during component initialisation (it registers a `$effect`).
 */
export function keyedResource<K, V>(
  key: () => K | null | undefined,
  fetcher: (key: K) => Promise<V>,
): KeyedResource<V> {
  const state = $state<KeyedResource<V>>({ loading: false, value: undefined, error: null });
  // Plain (non-reactive) bookkeeping so writing to it never re-triggers the
  // effect. `activeKey` dedupes benign re-renders; `token` discards stale
  // resolutions.
  let activeKey: K | null | undefined;
  let token = 0;

  $effect(() => {
    const k = key();
    if (k === null || k === undefined) {
      activeKey = k;
      // Invalidate any in-flight fetch for the previous key — otherwise a
      // late resolution would repopulate the state we're about to clear.
      token++;
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
