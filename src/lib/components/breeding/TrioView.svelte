<script lang="ts">
import GenomeGridTrio from '$lib/components/comparison/GenomeGridTrio.svelte';
import type { SelectedBreedingPair } from '$lib/stores/breeding.svelte.js';
import type { Pet } from '$lib/types/index.js';

interface Props {
  pair: SelectedBreedingPair;
  offspringBreed?: string;
  /**
   * The candidate pool the pair was ranked against. Drives the Quality and
   * Pool gain contribution lenses, which are measured against the rest of
   * the stable rather than against the pairing.
   */
  pool?: readonly Pet[];
  breedLockWeight?: number;
  onClose: () => void;
}

const { pair, offspringBreed = '', pool, breedLockWeight, onClose }: Props = $props();

// Thin adapter: GenomeGridTrio owns the DetailOverlay shell (back button, the
// parent-name title, and the stat pills in the header), so this just maps the
// breeding pair to its parents. The row itself goes through as `scores` — the
// grid explains the numbers the table showed rather than recomputing them.
</script>

<GenomeGridTrio
  father={pair.male}
  mother={pair.female}
  {offspringBreed}
  {pool}
  {breedLockWeight}
  scores={pair}
  {onClose}
/>
