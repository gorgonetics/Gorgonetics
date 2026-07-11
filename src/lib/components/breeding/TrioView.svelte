<script lang="ts">
import GenomeGridTrio from '$lib/components/comparison/GenomeGridTrio.svelte';
import type { SelectedBreedingPair } from '$lib/stores/breeding.svelte.js';

interface Props {
  pair: SelectedBreedingPair;
  offspringBreed?: string;
  onClose: () => void;
}

const { pair, offspringBreed = '', onClose }: Props = $props();

// Thin adapter: GenomeGridTrio owns the DetailOverlay shell (back button, the
// parent-name title, and the stat pills in the header), so this just maps the
// breeding pair to its parents.
</script>

<GenomeGridTrio father={pair.male} mother={pair.female} {offspringBreed} {onClose} />
