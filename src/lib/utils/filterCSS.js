/**
 * Build CSS rules for genome grid diff filters.
 * Isolated in a .js file to avoid biome's Svelte parser choking on CSS-in-JS.
 */

const G = '.grid-container';
const FILTERED = '{ opacity: 0.15 !important; filter: grayscale(1) !important; pointer-events: none !important; }';
const HIDDEN = '{ display: none !important; }';
const INACTIVE = '{ background-color: #e8e8ec !important; border-color: #d0d0d6 !important; opacity: 0.5 !important; }';
const DIMMED = '{ opacity: 0.2 !important; }';

/**
 * @param {object} filters
 * @param {string[]} filters.selectedAttributes
 * @param {string[]} filters.hiddenAttributes
 * @param {string} filters.breedFilter
 * @param {string[]} filters.selectedChromosomes
 * @param {string[]} filters.hiddenChromosomes
 * @param {boolean} filters.showDiffsOnly
 * @param {boolean} filters.isHorse
 * @param {Record<string, { generic: boolean; breeds: Set<string> }>} filters.chrBreedRelevance
 * @returns {string}
 */
export function buildFilterCSS(filters) {
  const {
    selectedAttributes: sa,
    hiddenAttributes: ha,
    breedFilter: bf,
    selectedChromosomes: sc,
    hiddenChromosomes: hc,
    showDiffsOnly: sd,
    isHorse: horse,
    chrBreedRelevance,
  } = filters;

  const rules = [];

  // Attribute filter
  if (sa.length > 0) {
    let not = '';
    for (const a of sa) not += `:not([data-attr="${a}"])`;
    rules.push(`${G} .gene-cell[data-attr]${not} ${FILTERED}`);
  }
  for (const a of ha) {
    rules.push(`${G} .gene-cell[data-attr="${a}"] ${FILTERED}`);
  }

  // Breed filter
  if (horse && bf) {
    rules.push(`${G} .gene-cell[data-breed]:not([data-breed=""]):not([data-breed="${bf}"]) ${INACTIVE}`);
    for (const [chr, rel] of Object.entries(chrBreedRelevance)) {
      if (!rel.generic && !rel.breeds.has(bf)) {
        rules.push(`${G} tr[data-chr="${chr}"] ${HIDDEN}`);
      }
    }
  }

  // Chromosome filters
  if (sc.length > 0) {
    const notChr = sc.map((c) => `[data-chr="${c}"]`).join('):not(');
    rules.push(`${G} tr[data-chr]:not(${notChr}) ${HIDDEN}`);
  }
  for (const c of hc) {
    rules.push(`${G} tr[data-chr="${c}"] ${HIDDEN}`);
  }

  // Diffs only
  if (sd) {
    rules.push(`${G} td[data-isdiff="false"][data-hascell="true"] ${DIMMED}`);
    rules.push(`${G} tr[data-hasdiffs="false"] ${HIDDEN}`);
  }

  return rules.join('\n');
}
