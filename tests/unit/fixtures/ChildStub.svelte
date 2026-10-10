<script lang="ts">
// Inert stand-in for heavy child components (GeneVisualizer / GeneStatsTable)
// in unit tests. Accepts and ignores any props; exposes the ref methods the
// parent may call so `bind:this` wiring doesn't throw. The last view handed
// over is rendered as `data-view`, so a test can see what the grid was told.
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
let view = $state('attribute');
export function handleViewChange(next?: string) {
  if (next) view = next;
}
export function handleAttributeFilter() {}
export function setBreedFilter() {}
</script>

<div data-testid="child-stub" data-view={view}></div>
