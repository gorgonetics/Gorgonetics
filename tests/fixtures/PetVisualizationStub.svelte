<script lang="ts">
// Lightweight stand-in for PetVisualization so MyPets overlay-lifecycle tests
// don't mount the real gene visualizer (2304 cells, window/document reads).
// Surfaces the pet id/name so a test can assert which pet the detail shows.
import type { Pet } from '$lib/types/index.js';

const { pet }: { pet: Pet } = $props();
</script>

<div data-testid="pet-visualization-stub" data-pet-id={pet.id}>{pet.name}</div>
