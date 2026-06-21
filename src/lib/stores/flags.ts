/**
 * Build-time / dev feature flags. The redesign (Library + Workspace) is built
 * in parallel behind `redesignEnabled` so the existing tabs keep working until
 * the single cutover PR. Enable for review via `?redesign=1` in the URL or
 * `localStorage['gorgonetics:redesign'] = '1'`; the URL form persists it.
 * See docs/design/redesign-library-workspace-v1.md (§7 Adoption plan).
 */

const STORAGE_KEY = 'gorgonetics:redesign';

function readRedesignFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('redesign') === '1') {
      window.localStorage.setItem(STORAGE_KEY, '1');
      return true;
    }
    if (params.get('redesign') === '0') {
      window.localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Read once at module load; stable for the session. */
export const redesignEnabled: boolean = readRedesignFlag();
