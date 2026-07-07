<script lang="ts">
// Inert stand-in for heavy child components (GeneVisualizer / GeneStatsTable)
// in unit tests. Accepts and ignores any props; exposes the ref methods the
// parent may call so `bind:this` wiring doesn't throw.
export function getStatsData() {
  return {
    currentStats: null,
    currentView: 'attribute',
    selectedAttributes: [],
    hiddenAttributes: [],
    totalGenes: 0,
    neutralGenes: 0,
    petSpecies: undefined,
  };
}
export function handleViewChange() {}
export function handleAttributeFilter() {}
export function setBreedFilter() {}
</script>

<div data-testid="child-stub"></div>
