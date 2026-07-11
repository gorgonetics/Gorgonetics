/**
 * Build CSS rules for genome grid diff filters.
 * Isolated in a .js file to avoid biome's Svelte parser choking on CSS-in-JS.
 */

const G = '.grid-container';
const FILTERED = '{ opacity: 0.15 !important; filter: grayscale(1) !important; pointer-events: none !important; }';
const HIDDEN = '{ display: none !important; }';
const INACTIVE = '{ background-color: #e8e8ec !important; border-color: #d0d0d6 !important; opacity: 0.5 !important; }';
const DIMMED = '{ opacity: 0.2 !important; }';
/** Drop the diff-cell amber tint on a filtered-out cell (the dimmed glyph would
 *  otherwise let the tint bleed through, distracting from the focus). */
const DIFF_BG_CLEARED = '{ background-color: transparent !important; }';

/**
 * Inner cell selectors (one per active clause) matching the cells to dim:
 * the single `:not()`-chained selector for a `selected` set, plus one per
 * `hidden` value. `exact` matches `[attr="v"]`; otherwise a delimited
 * substring `[attr*="·v·"]` (the both-allele `data-attrs` list).
 */
function matchSelectors(
  baseSelector: string,
  attr: string,
  selected: string[],
  hidden: string[],
  exact: boolean,
): string[] {
  const term = (v: string) => (exact ? `[${attr}="${v}"]` : `[${attr}*="${delim(v)}"]`);
  const sels: string[] = [];
  if (selected.length > 0) {
    let not = '';
    for (const v of selected) not += `:not(${term(v)})`;
    sels.push(`${baseSelector}[${attr}]${not}`);
  }
  for (const v of hidden) sels.push(`${baseSelector}${term(v)}`);
  return sels;
}

function pushInclusionRules(
  rules: string[],
  baseSelector: string,
  attr: string,
  selected: string[],
  hidden: string[],
  declaration: string,
  gridSelector: string = G,
): void {
  for (const s of matchSelectors(baseSelector, attr, selected, hidden, true)) {
    rules.push(`${gridSelector} ${s} ${declaration}`);
  }
}

/**
 * Like `pushInclusionRules`, but matches the *potential* attributes of a locus
 * carried in a delimited `data-attrs` list (`·Attr·Attr·`) rather than a single
 * exact `data-attr`. This is the gene-effect-database view of the filter: the
 * attribute set is a property of the gene (union of both alleles' effects), so
 * a cell stays lit whenever its gene could affect the attribute — independent
 * of which allele the pet actually carries. `data-attrs` must be present (even
 * empty) on every filterable cell so attribute-less loci dim under a selection.
 */
function pushPotentialInclusionRules(
  rules: string[],
  baseSelector: string,
  selected: string[],
  hidden: string[],
  declaration: string,
  gridSelector: string = G,
): void {
  for (const s of matchSelectors(baseSelector, 'data-attrs', selected, hidden, false)) {
    rules.push(`${gridSelector} ${s} ${declaration}`);
  }
}

/**
 * Attribute select/hide rules for any genome grid, parameterised by the grid
 * and cell selectors. Selected attributes dim everything else; hidden
 * attributes dim themselves. Shares the exact dimming declaration the 2-pet
 * diff grid uses so the trio grid filters identically. `cellSelector` is the
 * element selector that *carries* `data-attr` — `[data-attr]` is appended
 * internally, so pass the element only (the diff grid uses `.gene-cell`; the
 * trio grid uses `*` because its rows mix `.gene-cell` and `.dist-bar` cells).
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

/**
 * Like `attributeFilterCSS`, but matches the *potential* attributes of a locus:
 * the union of both alleles' effects, carried as a delimited `data-attrs` list
 * (`·Attr·Attr·`). A locus stays lit whenever its gene could affect the
 * attribute via either allele — even if the pet's current allele is neutral —
 * so the trio grid's focus highlights both parents and the offspring at every
 * responsible locus rather than dimming a parent whose allele happens to be
 * neutral. `data-attrs` must be present (even empty) on every filterable cell,
 * so attribute-less loci dim under an active selection. See `ATTR_DELIM`.
 */
export function attributePotentialFilterCSS(
  gridSelector: string,
  cellSelector: string,
  selectedAttributes: string[],
  hiddenAttributes: string[],
): string {
  const rules: string[] = [];
  pushPotentialInclusionRules(rules, cellSelector, selectedAttributes, hiddenAttributes, FILTERED, gridSelector);
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

  // Attribute filter keys off the gene effect DB (both alleles), carried as the
  // delimited `data-attrs` list — not the pet's resolved per-allele `data-attr`.
  // Both pet rows at a locus share the same gene, so the same selector decides
  // both; a pet whose current allele is neutral stays lit when its gene could
  // affect the attribute via the other allele. Appearance is a single per-gene
  // category (`data-appearance`), matched exactly.
  const focusSelectors =
    currentView === 'attribute'
      ? matchSelectors('.gene-cell', 'data-attrs', sa, ha, false)
      : currentView === 'appearance'
        ? matchSelectors('.gene-cell', 'data-appearance', sap, hap, true)
        : [];
  for (const s of focusSelectors) {
    rules.push(`${G} ${s} ${FILTERED}`);
    // Clear the amber diff tint on the containing cell too, so a dimmed glyph
    // doesn't let it bleed through and fight the focus.
    rules.push(`${G} .gene-cell-container.diff-cell:has(> ${s}) ${DIFF_BG_CLEARED}`);
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

// --- GeneVisualizer (single-pet / community grid) ----------------------------
//
// The single-pet grid (`GeneVisualizer`) carries a richer filter set than the
// diff grid: effect-type, zygosity (value), multi-attribute (either allele) and
// a contextual recolor. All of it is now driven by this injected stylesheet
// instead of a per-click rebuild + `.gene-filtered-out` class pass — the CSS is
// a byte-for-byte translation of the old `isGeneVisible` predicate.
//
// Dimming uses opacity 0.25 (pinned by the My Pets e2e "preserves fill" test)
// and, like the trio grid, only fades/desaturates — it never touches
// background/border, so a recessive (hollow) or mixed (half-gradient) cell keeps
// its shape.

/** GeneVisualizer grid container selector. */
const VG = '.gene-grid-container';
/** 0.25 dim — pinned by tests/e2e/redesign-mypets.spec.ts. Fade only, never fill. */
const DIMMED_25 = '{ opacity: 0.25 !important; filter: grayscale(1) !important; pointer-events: none !important; }';
/**
 * Delimiter wrapping each entry in the multi-valued `data-attrs` / `data-ctxpos`
 * / `data-ctxneg` lists. `~=` can't be used because attribute names may contain
 * spaces; a delimited substring (`*="·Speed·"`) is space-safe.
 */
export const ATTR_DELIM = '·';

/** Wrap a single value for a delimited-substring `*=` match. */
function delim(value: string): string {
  return `${ATTR_DELIM}${value}${ATTR_DELIM}`;
}

/** `gene-dominant` → `dominant` (the value carried by `data-zygosity`). */
function zygosityValue(v: string): string {
  return v.replace(/^gene-/, '');
}

export interface VisualizerFilterInput {
  selectedChromosomes: string[];
  hiddenChromosomes: string[];
  selectedAttributes: string[];
  hiddenAttributes: string[];
  currentEffectFilter: string[];
  hiddenEffectFilters: string[];
  /** Zygosity values as `gene-dominant` / `gene-recessive` / `gene-mixed` / `gene-unknown`. */
  currentValueFilter: string[];
  hiddenValueFilters: string[];
  currentView: 'attribute' | 'appearance';
  breedFilter: string;
  isHorse: boolean;
  chrBreedRelevance: Record<string, ChrBreedRelevance>;
}

/**
 * Build the injected stylesheet for `GeneVisualizer`. Every clause dims the
 * cells the old `isGeneVisible` returned `false` for; the breed filter hides
 * whole chromosome rows (matching the removed `chromosomeHasBreed` `{#if}`); and
 * a single selected attribute recolors latent-effect cells (the old
 * `getContextualAnalysis` recolor), scoped so it beats the base color rules by
 * specificity.
 */
export function buildVisualizerFilterCSS(input: VisualizerFilterInput): string {
  const {
    selectedChromosomes: sc,
    hiddenChromosomes: hc,
    selectedAttributes: sa,
    hiddenAttributes: ha,
    currentEffectFilter: ef,
    hiddenEffectFilters: hef,
    currentValueFilter: vf,
    hiddenValueFilters: hvf,
    currentView: view,
    breedFilter: bf,
    isHorse,
    chrBreedRelevance,
  } = input;

  const rules: string[] = [];

  // Chromosome filter — dims cells on non-matching rows (does not hide them, so
  // the sticky chromosome label stays put).
  if (sc.length > 0) {
    const not = sc.map((c) => `:not([data-chromosome="${c}"])`).join('');
    rules.push(`${VG} tr[data-chromosome]${not} .gene-cell ${DIMMED_25}`);
  }
  for (const c of hc) {
    rules.push(`${VG} tr[data-chromosome="${c}"] .gene-cell ${DIMMED_25}`);
  }

  // Attribute filter — attribute view matches either allele's potential
  // attributes (`data-attrs`); appearance view matches the single category.
  if (view === 'attribute') {
    if (sa.length > 0) {
      const not = sa.map((a) => `:not([data-attrs*="${delim(a)}"])`).join('');
      rules.push(`${VG} .gene-cell[data-attrs]${not} ${DIMMED_25}`);
    }
    for (const h of ha) {
      rules.push(`${VG} .gene-cell[data-attr="${h}"] ${DIMMED_25}`);
    }
  } else {
    if (sa.length > 0) {
      const not = sa.map((a) => `:not([data-appearance="${a}"])`).join('');
      rules.push(`${VG} .gene-cell[data-appearance]${not} ${DIMMED_25}`);
    }
    for (const h of ha) {
      rules.push(`${VG} .gene-cell[data-appearance="${h}"] ${DIMMED_25}`);
    }
  }

  // Effect filter — attribute view only. `data-effecttype` carries the
  // attribute-view (resolved/promoted) effect type; the effect legend that sets
  // this filter exists only in the attribute view.
  if (view === 'attribute') {
    if (ef.length > 0) {
      const not = ef.map((e) => `:not([data-effecttype="${e}"])`).join('');
      rules.push(`${VG} .gene-cell[data-effecttype]${not} ${DIMMED_25}`);
    }
    for (const e of hef) {
      rules.push(`${VG} .gene-cell[data-effecttype="${e}"] ${DIMMED_25}`);
    }
  }

  // Value (zygosity) filter.
  if (vf.length > 0) {
    const not = vf.map((v) => `:not([data-zygosity="${zygosityValue(v)}"])`).join('');
    rules.push(`${VG} .gene-cell[data-zygosity]${not} ${DIMMED_25}`);
  }
  for (const v of hvf) {
    rules.push(`${VG} .gene-cell[data-zygosity="${zygosityValue(v)}"] ${DIMMED_25}`);
  }

  // Breed filter — hides whole chromosome rows with no gene relevant to the
  // selected breed (generic rows always stay).
  if (isHorse && bf) {
    for (const [chr, rel] of Object.entries(chrBreedRelevance)) {
      if (!rel.generic && !rel.breeds.has(bf)) {
        rules.push(`${VG} tr[data-chromosome="${chr}"] ${HIDDEN}`);
      }
    }
  }

  // Contextual recolor — a single selected attribute repaints cells whose other
  // allele could affect it as potential-positive/negative. These out-specify the
  // base `.gene-*` color rules (three class/attr tokens vs two).
  if (view === 'attribute' && sa.length === 1) {
    const a = sa[0];
    const pos = `${VG} .gene-cell[data-ctxpos*="${delim(a)}"]`;
    const neg = `${VG} .gene-cell[data-ctxneg*="${delim(a)}"]`;
    rules.push(
      `${pos}.gene-dominant { background-color: var(--gene-potential-positive); border-color: var(--gene-potential-positive); }`,
    );
    rules.push(
      `${pos}.gene-recessive { background-color: color-mix(in srgb, var(--gene-potential-positive) 15%, transparent); border-color: var(--gene-potential-positive); border-width: 4px; }`,
    );
    rules.push(
      `${pos}.gene-mixed { background: linear-gradient(135deg, transparent 50%, var(--gene-potential-positive) 50%); border-color: var(--gene-potential-positive); }`,
    );
    rules.push(
      `${neg}.gene-dominant { background-color: var(--gene-potential-negative); border-color: var(--gene-potential-negative); }`,
    );
    rules.push(
      `${neg}.gene-recessive { background-color: color-mix(in srgb, var(--gene-potential-negative) 15%, transparent); border-color: var(--gene-potential-negative); border-width: 4px; }`,
    );
    rules.push(
      `${neg}.gene-mixed { background: linear-gradient(135deg, transparent 50%, var(--gene-potential-negative) 50%); border-color: var(--gene-potential-negative); }`,
    );
  }

  return rules.join('\n');
}
