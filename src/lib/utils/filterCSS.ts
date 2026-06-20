/**
 * Build CSS rules for genome grid diff filters.
 * Isolated in a .js file to avoid biome's Svelte parser choking on CSS-in-JS.
 */

const G = '.grid-container';
const FILTERED = '{ opacity: 0.15 !important; filter: grayscale(1) !important; pointer-events: none !important; }';
const HIDDEN = '{ display: none !important; }';
const INACTIVE = '{ background-color: #e8e8ec !important; border-color: #d0d0d6 !important; opacity: 0.5 !important; }';
const DIMMED = '{ opacity: 0.2 !important; }';

function pushInclusionRules(
  rules: string[],
  baseSelector: string,
  attr: string,
  selected: string[],
  hidden: string[],
  declaration: string,
  gridSelector: string = G,
): void {
  if (selected.length > 0) {
    let not = '';
    for (const v of selected) not += `:not([${attr}="${v}"])`;
    rules.push(`${gridSelector} ${baseSelector}[${attr}]${not} ${declaration}`);
  }
  for (const v of hidden) {
    rules.push(`${gridSelector} ${baseSelector}[${attr}="${v}"] ${declaration}`);
  }
}

/**
 * Attribute select/hide rules for any genome grid, parameterised by the grid
 * and cell selectors. Selected attributes dim everything else; hidden
 * attributes dim themselves. Shares the exact dimming declaration the 2-pet
 * diff grid uses so the trio grid filters identically. `cellSelector` is the
 * element carrying `data-attr` (the diff grid uses `.gene-cell`; grids whose
 * cells aren't `.gene-cell` can pass `[data-attr]`).
 */
export function attributeFilterCSS(
  gridSelector: string,
  cellSelector: string,
  selectedAttributes: string[],
  hiddenAttributes: string[],
): string {
  const rules: string[] = [];
  pushInclusionRules(rules, cellSelector, 'data-attr', selectedAttributes, hiddenAttributes, FILTERED, gridSelector);
  return rules.join('\n');
}

/** Per-chromosome breed relevance: `generic` rows apply to all breeds. */
export interface ChrBreedRelevance {
  generic: boolean;
  breeds: Set<string>;
}

export interface FilterCSSInput {
  selectedAttributes: string[];
  hiddenAttributes: string[];
  selectedAppearances?: string[];
  hiddenAppearances?: string[];
  breedFilter: string;
  selectedChromosomes: string[];
  hiddenChromosomes: string[];
  showDiffsOnly: boolean;
  isHorse: boolean;
  currentView?: 'attribute' | 'appearance';
  chrBreedRelevance: Record<string, ChrBreedRelevance>;
}

export function buildFilterCSS(filters: FilterCSSInput): string {
  const {
    selectedAttributes: sa,
    hiddenAttributes: ha,
    selectedAppearances: sap = [],
    hiddenAppearances: hap = [],
    breedFilter: bf,
    selectedChromosomes: sc,
    hiddenChromosomes: hc,
    showDiffsOnly: sd,
    isHorse: horse,
    currentView = 'attribute',
    chrBreedRelevance,
  } = filters;

  const rules: string[] = [];

  if (currentView === 'attribute') {
    pushInclusionRules(rules, '.gene-cell', 'data-attr', sa, ha, FILTERED);
  } else if (currentView === 'appearance') {
    pushInclusionRules(rules, '.gene-cell', 'data-appearance', sap, hap, FILTERED);
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
