/**
 * Gene Visualization Module for Gorgonetics
 * Integrated version of the standalone gene viewer for the main app
 */

/**
 * Helper to toggle filter state for selectors (selected/hidden/neutral).
 * @param {Array} selectedArr
 * @param {Array} hiddenArr
 * @param {string} key
 * @param {'select'|'hide'|'toggle-select'|'toggle-hide'} action
 * @returns {{selected: Array, hidden: Array}}
 */
function toggleFilterState(selectedArr, hiddenArr, key, action) {
  const isSelected = selectedArr.includes(key);
  const isHidden = hiddenArr.includes(key);

  // If toggling select on a hidden item or hide on a selected item, neutralize
  if (
    (action === "select" && isHidden) ||
    (action === "hide" && isSelected) ||
    (action === "toggle-select" && isHidden) ||
    (action === "toggle-hide" && isSelected)
  ) {
    return {
      selected: selectedArr.filter((k) => k !== key),
      hidden: hiddenArr.filter((k) => k !== key),
    };
  }

  if (action === "select" || action === "toggle-select") {
    if (isSelected) {
      // Deselect
      return {
        selected: selectedArr.filter((k) => k !== key),
        hidden: hiddenArr,
      };
    } else {
      // Select (remove from hidden if present)
      return {
        selected: [...selectedArr, key],
        hidden: hiddenArr.filter((k) => k !== key),
      };
    }
  }

  if (action === "hide" || action === "toggle-hide") {
    if (isHidden) {
      // Unhide
      return {
        selected: selectedArr,
        hidden: hiddenArr.filter((k) => k !== key),
      };
    } else {
      // Hide (remove from selected if present)
      return {
        selected: selectedArr.filter((k) => k !== key),
        hidden: [...hiddenArr, key],
      };
    }
  }

  // Default: return unchanged
  return { selected: selectedArr, hidden: hiddenArr };
}

class GeneVisualizer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentPet = null;
    this.currentView = "attribute"; // 'attribute' or 'appearance'
    this.currentEffectFilter = [];
    this.hiddenEffectFilters = [];
    this.currentValueFilter = [];
    this.hiddenValueFilters = [];
    this.selectedAttributes = [];
    this.selectedChromosomes = [];
    this.hideNeutral = false;
    this.geneEffectsDB = null;
    this.currentStats = null;
    this.hiddenChromosomes = [];
    this.hiddenAttributes = [];

    this.init();
  }

  async init() {
    await this.loadGeneEffects();
    this.createUI();
    this.attachEventListeners();
  }

  async loadGeneEffects() {
    // Gene effects will be loaded from database on demand
    this.geneEffectsDB = null;
  }

  createUI() {
    this.container.innerHTML = `
            <div class="gene-visualizer">
                <div class="visualizer-header compact-header">
                    <h3 class="visualizer-title">🧬 Gene Visualization</h3>
                    <div class="visualizer-controls">
                        <div class="view-toggle">
                            <button class="btn-view active" data-view="attribute">Attributes</button>
                            <button class="btn-view" data-view="appearance">Appearance</button>
                        </div>
                        <div class="filter-controls">

                        </div>
                    </div>
                </div>

                <div class="visualizer-content">
                    <div class="gene-section">
                        <div class="gene-legend">
                            <div class="legend-items" id="legendItems">
                                <!-- Will be populated dynamically based on current view -->
                            </div>
                        </div>

                        <div class="gene-grid-container" id="geneGridContainer">
                            <div class="empty-state">
                                Select a pet to visualize its genes
                            </div>
                        </div>
                    </div>

                    <div class="stats-section">
                        <div class="stats-table-container">
                            <div class="table-header">
                                <h4 id="tableTitle">Gene Effects Summary</h4>
                                <div class="selection-counters">
                                    <div class="selection-counter" id="selectionCounter" style="visibility: hidden;">
                                        <span id="selectedCount">0</span> selected
                                    </div>
                                    <div class="selection-counter" id="chromosomeCounter" style="visibility: hidden;">
                                        <span id="chromosomeCount">0</span> chromosomes
                                    </div>
                                </div>
                            </div>
                            <div class="table-instructions">
                                Click attributes/chromosomes to select • Ctrl+click to add multiple
                            </div>
                            <table class="stats-table">
                                <thead id="tableHeaders">
                                    <tr>
                                        <th>Attribute</th>
                                        <th>Count</th>
                                        <th>Details</th>
                                    </tr>
                                </thead>
                                <tbody id="tableBody">
                                    <!-- Dynamic content -->
                                </tbody>
                            </table>
                            <div class="summary-info">
                                <span>Total Genes: <span id="totalGenesDisplay">0</span></span>
                                <span>No Effects: <span id="neutralGenesDisplay">0</span></span>
                            </div>
                        </div>
                    </div>
                </div>


            </div>
        `;

    // Create tooltip in document body to avoid positioning issues
    if (!document.getElementById("geneTooltip")) {
      const tooltip = document.createElement("div");
      tooltip.id = "geneTooltip";
      tooltip.className = "gene-tooltip";
      tooltip.style.display = "none";
      document.body.appendChild(tooltip);
    }
  }

  attachEventListeners() {
    // View toggle buttons
    this.container.querySelectorAll(".btn-view").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this.container
          .querySelectorAll(".btn-view")
          .forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        this.currentView = e.target.dataset.view;
        this.updateVisualization();
      });
    });
  }

  async loadPet(petId) {
    try {
      const response = await window.fetch(`/api/pet-genome/${petId}`);
      if (!response.ok) {
        throw new Error("Failed to load pet genome");
      }

      this.currentPet = await response.json();

      // Load gene effects from database for this species
      await this.loadGeneEffectsForSpecies(this.currentPet.species);

      await this.updateVisualization();
    } catch (error) {
      console.error("Error loading pet:", error);
      this.showError("Failed to load pet genome data");
    }
  }

  async loadGeneEffectsForSpecies(species) {
    try {
      const response = await window.fetch(`/api/gene-effects/${species}`);
      if (!response.ok) {
        throw new Error("Failed to load gene effects");
      }

      const data = await response.json();

      this.geneEffectsDB = { [species.toLowerCase()]: data.effects };
    } catch (error) {
      console.error("Error loading gene effects:", error);
      this.geneEffectsDB = null;
    }
  }

  async updateVisualization() {
    if (!this.currentPet) {
      return;
    }

    try {
      await this.createGeneVisualization();
      this.updateTable();
      this.updateTableSelectionState();
      this.updateChromosomeSelectionState();
      this.updateLegend();
      this.updateAppearanceLegendFeedback();
    } catch (error) {
      console.error("Error updating visualization:", error);
      this.showError("Failed to update gene visualization");
    }
  }

  async createGeneVisualization() {
    const container = document.getElementById("geneGridContainer");

    if (!this.currentPet || !this.currentPet.genes) {
      container.innerHTML =
        '<div class="empty-state">No gene data available</div>';
      return;
    }

    const pet = this.currentPet;

    // Parse genes from the string format
    const parsedGenes = this.parseGenes(pet.genes);

    // Create visualization
    container.innerHTML = "";

    // Add block headers
    this.createBlockHeaders(container, parsedGenes);

    // Create scrollable container for gene rows
    const geneRowsContainer = document.createElement("div");
    geneRowsContainer.className = "gene-rows-container";
    container.appendChild(geneRowsContainer);

    // Statistics tracking
    let totalGenes = 0;
    const allStats = this.initializeStats();

    // Create gene grid - sort chromosomes numerically
    const sortedChromosomes = Object.entries(parsedGenes).sort(([a], [b]) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      return numA - numB;
    });

    sortedChromosomes.forEach(([chromosome, chromosomeData]) => {
      const chromosomeRow = document.createElement("div");
      chromosomeRow.className = "chromosome-row";

      const chromosomeLabel = document.createElement("div");
      chromosomeLabel.className = "chromosome-label";
      chromosomeLabel.textContent = chromosome;
      chromosomeLabel.dataset.chromosome = chromosome;

      // Add click handler for chromosome selection
      chromosomeLabel.addEventListener("click", (e) => {
        this.toggleChromosomeFilter(
          chromosome,
          e.ctrlKey || e.metaKey,
          e.altKey,
        );
      });

      // Update selection state
      if (this.selectedChromosomes.includes(chromosome)) {
        chromosomeLabel.classList.add("selected");
      }

      chromosomeRow.appendChild(chromosomeLabel);

      const blocksContainer = document.createElement("div");
      blocksContainer.className = "blocks-container";

      // Create genes with block spacing
      let currentBlock = null;
      chromosomeData.allGenes.forEach((gene) => {
        // Add block spacing
        if (currentBlock !== null && currentBlock !== gene.block) {
          const spacer = document.createElement("div");
          spacer.className = "block-spacer";
          blocksContainer.appendChild(spacer);
        }
        currentBlock = gene.block;
        const geneAnalysis = this.analyzeGeneEffect(
          pet.species,
          gene.id,
          gene.type,
        );

        totalGenes++;
        this.updateStats(allStats, geneAnalysis);

        // Unified isVisible logic for all filters
        let isVisible = true;

        // Chromosome filter
        if (
          this.selectedChromosomes.length > 0 &&
          !this.selectedChromosomes.includes(chromosome)
        ) {
          isVisible = false;
        }
        // Chromosome hide/selected logic: only filter if exclusively in one, not both
        const inSelectedChromosomes =
          this.selectedChromosomes.includes(chromosome);
        const inHiddenChromosomes = this.hiddenChromosomes.includes(chromosome);
        if (
          this.selectedChromosomes.length > 0 ||
          this.hiddenChromosomes.length > 0
        ) {
          if (inSelectedChromosomes && !inHiddenChromosomes) {
            // Only selected, apply selection logic (attribute filter below)
            // do nothing here
          } else if (!inSelectedChromosomes && inHiddenChromosomes) {
            // Only hidden, filter out
            isVisible = false;
          } else if (inSelectedChromosomes && inHiddenChromosomes) {
            // Both selected and hidden: treat as neutral (do nothing)
          } else {
            // Neither selected nor hidden: treat as neutral (do nothing)
          }
        }

        // Attribute filter
        if (this.currentView === "attribute") {
          if (
            this.selectedAttributes.length > 0 &&
            !this.genePotentiallyAffectsSelectedAttributes(
              pet.species,
              gene.id,
              this.selectedAttributes,
            )
          ) {
            isVisible = false;
          }
        } else {
          if (
            this.selectedAttributes.length > 0 &&
            !this.selectedAttributes.includes(geneAnalysis.attribute)
          ) {
            isVisible = false;
          }
        }
        // Attribute hide/selected logic: only filter if exclusively in one, not both
        const inSelectedAttributes = this.selectedAttributes.includes(
          geneAnalysis.attribute,
        );
        const inHiddenAttributes = this.hiddenAttributes.includes(
          geneAnalysis.attribute,
        );
        if (
          this.selectedAttributes.length > 0 ||
          this.hiddenAttributes.length > 0
        ) {
          if (inSelectedAttributes && !inHiddenAttributes) {
            // Only selected, apply selection logic (already handled above)
            // do nothing here
          } else if (!inSelectedAttributes && inHiddenAttributes) {
            // Only hidden, filter out
            isVisible = false;
          } else if (inSelectedAttributes && inHiddenAttributes) {
            // Both selected and hidden: treat as neutral (do nothing)
          } else {
            // Neither selected nor hidden: treat as neutral (do nothing)
          }
        }

        // Effect filter (multi-select)
        let cssClass = "gene-cell ";
        if (this.currentView === "appearance") {
          cssClass += `gene-${geneAnalysis.type} `;
        } else {
          if (
            geneAnalysis.type === "neutral" &&
            this.hasAnyPotentialEffect(pet.species, gene.id)
          ) {
            const potentialType = this.analyzePotentialEffectType(
              pet.species,
              gene.id,
            );
            if (potentialType) {
              cssClass += `gene-${potentialType} `;
            } else {
              cssClass += "gene-neutral ";
            }
          } else {
            cssClass += `gene-${geneAnalysis.type} `;
          }
        }
        if (gene.type === "?") {
          cssClass = "gene-cell gene-neutral gene-unknown";
        } else if (gene.type === "D") {
          cssClass += "gene-dominant";
        } else if (gene.type === "R") {
          cssClass += "gene-recessive";
        } else if (gene.type === "x") {
          cssClass += "gene-mixed";
        } else {
          cssClass += "gene-recessive";
        }

        // Effect filter logic
        let matchesAny = true;
        if (
          Array.isArray(this.currentEffectFilter) &&
          this.currentEffectFilter.length > 0
        ) {
          matchesAny = this.currentEffectFilter.some((effect) =>
            cssClass.includes(`gene-${effect}`),
          );
        }
        let isHidden = false;
        if (
          Array.isArray(this.hiddenEffectFilters) &&
          this.hiddenEffectFilters.length > 0
        ) {
          isHidden = this.hiddenEffectFilters.some((effect) =>
            cssClass.includes(`gene-${effect}`),
          );
        }

        // Value filter logic
        let matchesValue = true;
        if (
          Array.isArray(this.currentValueFilter) &&
          this.currentValueFilter.length > 0
        ) {
          matchesValue = this.currentValueFilter.some((value) =>
            cssClass.includes(value),
          );
        }
        let isValueHidden = false;
        if (
          Array.isArray(this.hiddenValueFilters) &&
          this.hiddenValueFilters.length > 0
        ) {
          isValueHidden = this.hiddenValueFilters.some((value) =>
            cssClass.includes(value),
          );
        }

        if (!matchesAny || isHidden || !matchesValue || isValueHidden) {
          isVisible = false;
        }

        const geneCell = document.createElement("div");
        geneCell.className = cssClass;
        geneCell.dataset.chromosome = chromosome;
        geneCell.dataset.geneId = gene.id;
        geneCell.dataset.geneType = gene.type;
        geneCell.dataset.effect = geneAnalysis.effect;

        // Render question mark for unknown gene type
        if (gene.type === "?") {
          geneCell.innerHTML =
            '<span class="gene-unknown-symbol" title="Unknown gene">?</span>';
        }

        if (!isVisible) {
          geneCell.classList.add("gene-filtered-out");
        }

        geneCell.addEventListener("mouseenter", (e) => this.showTooltip(e));
        geneCell.addEventListener("mouseleave", () => this.hideTooltip());

        blocksContainer.appendChild(geneCell);
      });

      chromosomeRow.appendChild(blocksContainer);
      geneRowsContainer.appendChild(chromosomeRow);
    });

    // Store stats for table access
    this.currentStats = allStats;

    // Update statistics
    this.updateStatistics(allStats, totalGenes);
  }

  parseGenes(genesData) {
    const parsed = {};

    Object.entries(genesData).forEach(([chromosome, geneString]) => {
      const blockStrings = geneString.split(" ");
      const allGenes = [];
      const blocks = [];

      blockStrings.forEach((blockString, blockIndex) => {
        const blockLetter = this.generateBlockLetter(blockIndex);
        const blockGenes = [];

        for (let i = 0; i < blockString.length; i++) {
          const gene = {
            id: `${chromosome}${blockLetter}${i + 1}`,
            type: blockString[i],
            block: blockLetter,
            position: i + 1,
            globalPosition: allGenes.length + 1,
          };
          blockGenes.push(gene);
          allGenes.push(gene);
        }

        blocks.push({
          letter: blockLetter,
          genes: blockGenes,
        });
      });

      parsed[chromosome] = { blocks, allGenes };
    });

    return parsed;
  }

  generateBlockLetter(index) {
    if (index < 26) {
      return String.fromCharCode(65 + index); // A, B, C, ...
    } else {
      const firstLetter = Math.floor(index / 26) - 1;
      const secondLetter = index % 26;
      return (
        String.fromCharCode(65 + firstLetter) +
        String.fromCharCode(65 + secondLetter)
      ); // AA, AB, AC, ...
    }
  }

  createBlockHeaders(container, parsedGenes) {
    // Find the chromosome with the most genes to use as template
    let longestChromosome = null;
    let maxGenes = 0;

    Object.values(parsedGenes).forEach((chromosomeData) => {
      if (
        chromosomeData.allGenes &&
        chromosomeData.allGenes.length > maxGenes
      ) {
        maxGenes = chromosomeData.allGenes.length;
        longestChromosome = chromosomeData;
      }
    });

    if (!longestChromosome || !longestChromosome.blocks) {
      return;
    }

    const headerContainer = document.createElement("div");
    headerContainer.className = "block-headers";

    // Add chromosome label space
    const chromosomeLabelSpace = document.createElement("div");
    chromosomeLabelSpace.className = "chromosome-header-space";
    headerContainer.appendChild(chromosomeLabelSpace);

    // Create headers for each block based on longest chromosome structure
    let currentBlock = null;
    longestChromosome.allGenes.forEach((gene) => {
      // Add spacer for block gaps
      if (currentBlock !== null && currentBlock !== gene.block) {
        const spacer = document.createElement("div");
        spacer.className = "header-spacer";
        headerContainer.appendChild(spacer);
      }
      currentBlock = gene.block;

      const header = document.createElement("div");
      header.className = "position-header";

      // Show block letter only on the first position of each block
      if (gene.position === 1) {
        header.textContent = gene.block;
        header.classList.add("block-label");
      } else {
        header.textContent = "";
      }

      headerContainer.appendChild(header);
    });

    container.appendChild(headerContainer);
  }

  initializeStats() {
    if (this.currentView === "attribute") {
      return {
        positive: 0,
        negative: 0,
        neutral: 0,
        Intelligence: { positive: 0, negative: 0 },
        Toughness: { positive: 0, negative: 0 },
        Friendliness: { positive: 0, negative: 0 },
        Ruggedness: { positive: 0, negative: 0 },
        Ferocity: { positive: 0, negative: 0 },
        Enthusiasm: { positive: 0, negative: 0 },
        Virility: { positive: 0, negative: 0 },
      };
    } else {
      return {
        "body-color-hue": 0,
        "body-color-saturation": 0,
        "body-color-intensity": 0,
        "wing-color-hue": 0,
        "wing-color-saturation": 0,
        "wing-color-intensity": 0,
        "body-scale": 0,
        "wing-scale": 0,
        "head-scale": 0,
        "tail-scale": 0,
        "antenna-scale": 0,
        "leg-deformity": 0,
        "antenna-deformity": 0,
        particles: 0,
        "particle-location": 0,
        glow: 0,
        "appearance-neutral": 0,
      };
    }
  }

  updateStats(stats, geneAnalysis) {
    if (this.currentView === "attribute") {
      stats[geneAnalysis.type]++;
      if (geneAnalysis.attribute && stats[geneAnalysis.attribute]) {
        stats[geneAnalysis.attribute][geneAnalysis.type]++;
      }
    } else {
      if (stats[geneAnalysis.type] !== undefined) {
        stats[geneAnalysis.type]++;
      }
    }
  }

  analyzeGeneEffect(species, geneId, geneType) {
    if (this.currentView === "attribute") {
      const effect = this.getGeneEffect(species, geneId, geneType);

      if (
        effect === "No gene data found" ||
        effect === "No dominant effect" ||
        effect === "No recessive effect" ||
        effect === "Unknown gene type"
      ) {
        return {
          type: "neutral",
          attribute: null,
          effect: effect,
        };
      }

      // Robust potential/neutral/positive/negative detection
      let type = "neutral";
      let attribute = null;
      const effectStr = effect || "";

      // Attribute detection
      if (effectStr.includes("Intelligence")) attribute = "Intelligence";
      else if (effectStr.includes("Toughness")) attribute = "Toughness";
      else if (effectStr.includes("Friendliness")) attribute = "Friendliness";
      else if (effectStr.includes("Ruggedness")) attribute = "Ruggedness";
      else if (effectStr.includes("Ferocity")) attribute = "Ferocity";
      else if (effectStr.includes("Enthusiasm")) attribute = "Enthusiasm";
      else if (effectStr.includes("Virility")) attribute = "Virility";

      // Potential effect detection
      const isPotential =
        effectStr.includes("?") ||
        effectStr.toLowerCase().includes("potential");
      const hasPlus = effectStr.includes("+");
      const hasMinus = effectStr.includes("-");

      if (isPotential && hasPlus) type = "potential-positive";
      else if (isPotential && hasMinus) type = "potential-negative";
      else if (!isPotential && hasPlus) type = "positive";
      else if (!isPotential && hasMinus) type = "negative";
      // else remains "neutral"

      return {
        type,
        attribute: attribute,
        effect: effect,
      };
    } else {
      // Appearance mode
      const appearance = this.getGeneAppearance(species, geneId);
      let appearanceCategory = "appearance-neutral";

      if (appearance.includes("Body Color Hue")) {
        appearanceCategory = "body-color-hue";
      } else if (appearance.includes("Body Color Saturation")) {
        appearanceCategory = "body-color-saturation";
      } else if (appearance.includes("Body Color Intensity")) {
        appearanceCategory = "body-color-intensity";
      } else if (appearance.includes("Wing Color Hue")) {
        appearanceCategory = "wing-color-hue";
      } else if (appearance.includes("Wing Color Saturation")) {
        appearanceCategory = "wing-color-saturation";
      } else if (appearance.includes("Wing Color Intensity")) {
        appearanceCategory = "wing-color-intensity";
      } else if (appearance.includes("Body Scale")) {
        appearanceCategory = "body-scale";
      } else if (appearance.includes("Wing Scale")) {
        appearanceCategory = "wing-scale";
      } else if (appearance.includes("Head Scale")) {
        appearanceCategory = "head-scale";
      } else if (appearance.includes("Tail Scale")) {
        appearanceCategory = "tail-scale";
      } else if (appearance.includes("Antenna Scale")) {
        appearanceCategory = "antenna-scale";
      } else if (appearance.includes("Leg Deformity")) {
        appearanceCategory = "leg-deformity";
      } else if (appearance.includes("Antenna Deformity")) {
        appearanceCategory = "antenna-deformity";
      } else if (appearance.includes("Particles")) {
        appearanceCategory = "particles";
      } else if (appearance.includes("Particle Location")) {
        appearanceCategory = "particle-location";
      } else if (appearance.includes("Glow")) {
        appearanceCategory = "glow";
      }

      return {
        type: appearanceCategory,
        attribute: appearanceCategory,
        effect: appearance,
      };
    }
  }

  getGeneEffect(species, geneId, geneType) {
    if (!this.geneEffectsDB) {
      return "No gene data found";
    }

    let speciesKey = species.toLowerCase();
    if (speciesKey === "horse") {
      speciesKey = "horse";
    } else if (
      speciesKey === "beewasp" ||
      speciesKey === "bee" ||
      speciesKey === "wasp"
    ) {
      speciesKey = "beewasp";
    } else {
      speciesKey = "horse";
    }

    const geneData =
      this.geneEffectsDB[speciesKey] && this.geneEffectsDB[speciesKey][geneId];

    if (!geneData) {
      return "No gene data found";
    }

    if (geneType === "D" || geneType === "x") {
      const effect = geneData.effectDominant;
      if (
        !effect ||
        effect === "None" ||
        effect === null ||
        effect === "null"
      ) {
        return "No dominant effect";
      }
      return effect;
    } else if (geneType === "R") {
      const effect = geneData.effectRecessive;
      if (
        !effect ||
        effect === "None" ||
        effect === null ||
        effect === "null"
      ) {
        return "No recessive effect";
      }
      return effect;
    } else {
      return "Unknown gene type";
    }
  }

  getGeneAppearance(species, geneId) {
    if (!this.geneEffectsDB) return "No appearance effect";

    let speciesKey = species.toLowerCase();
    if (speciesKey === "horse") {
      speciesKey = "horse";
    } else if (
      speciesKey === "beewasp" ||
      speciesKey === "bee" ||
      speciesKey === "wasp"
    ) {
      speciesKey = "beewasp";
    } else {
      speciesKey = "horse";
    }

    const geneData =
      this.geneEffectsDB[speciesKey] && this.geneEffectsDB[speciesKey][geneId];

    if (
      !geneData ||
      !geneData.appearance ||
      geneData.appearance === "None" ||
      geneData.appearance.includes("String for me to fill")
    ) {
      return "No appearance effect";
    }

    return geneData.appearance;
  }

  hasAnyPotentialEffect(species, geneId) {
    if (this.currentView === "attribute") {
      const dominantEffect = this.getGeneEffect(species, geneId, "D");
      const recessiveEffect = this.getGeneEffect(species, geneId, "R");

      const dominantHasEffect =
        dominantEffect &&
        dominantEffect !== "No gene data found" &&
        dominantEffect !== "No dominant effect" &&
        dominantEffect !== "Unknown gene type" &&
        dominantEffect !== "None" &&
        dominantEffect !== "null" &&
        dominantEffect.trim() !== "";
      const recessiveHasEffect =
        recessiveEffect &&
        recessiveEffect !== "No gene data found" &&
        recessiveEffect !== "No recessive effect" &&
        recessiveEffect !== "Unknown gene type" &&
        recessiveEffect !== "None" &&
        recessiveEffect !== "null" &&
        recessiveEffect.trim() !== "";

      return dominantHasEffect || recessiveHasEffect;
    } else {
      const appearance = this.getGeneAppearance(species, geneId);
      return appearance !== "No appearance effect";
    }
  }

  genePotentiallyAffectsSelectedAttributes(
    species,
    geneId,
    selectedAttributes,
  ) {
    if (selectedAttributes.length === 0) {
      return true;
    }

    const dominantEffect = this.getGeneEffect(species, geneId, "D");
    const recessiveEffect = this.getGeneEffect(species, geneId, "R");

    const allPotentialAttributes = [];

    if (
      dominantEffect &&
      dominantEffect !== "No gene data found" &&
      dominantEffect !== "No dominant effect" &&
      dominantEffect !== "Unknown gene type"
    ) {
      if (dominantEffect.includes("Intelligence"))
        allPotentialAttributes.push("Intelligence");
      if (dominantEffect.includes("Toughness"))
        allPotentialAttributes.push("Toughness");
      if (dominantEffect.includes("Friendliness"))
        allPotentialAttributes.push("Friendliness");
      if (dominantEffect.includes("Ruggedness"))
        allPotentialAttributes.push("Ruggedness");
      if (dominantEffect.includes("Ferocity"))
        allPotentialAttributes.push("Ferocity");
      if (dominantEffect.includes("Enthusiasm"))
        allPotentialAttributes.push("Enthusiasm");
      if (dominantEffect.includes("Virility"))
        allPotentialAttributes.push("Virility");
    }

    if (
      recessiveEffect &&
      recessiveEffect !== "No gene data found" &&
      recessiveEffect !== "No recessive effect" &&
      recessiveEffect !== "Unknown gene type"
    ) {
      if (recessiveEffect.includes("Intelligence"))
        allPotentialAttributes.push("Intelligence");
      if (recessiveEffect.includes("Toughness"))
        allPotentialAttributes.push("Toughness");
      if (recessiveEffect.includes("Friendliness"))
        allPotentialAttributes.push("Friendliness");
      if (recessiveEffect.includes("Ruggedness"))
        allPotentialAttributes.push("Ruggedness");
      if (recessiveEffect.includes("Ferocity"))
        allPotentialAttributes.push("Ferocity");
      if (recessiveEffect.includes("Enthusiasm"))
        allPotentialAttributes.push("Enthusiasm");
      if (recessiveEffect.includes("Virility"))
        allPotentialAttributes.push("Virility");
    }

    return allPotentialAttributes.some((attr) =>
      selectedAttributes.includes(attr),
    );
  }

  analyzePotentialEffectType(species, geneId) {
    const dominantEffect = this.getGeneEffect(species, geneId, "D");
    const recessiveEffect = this.getGeneEffect(species, geneId, "R");

    let hasPositive = false;
    let hasNegative = false;

    if (
      dominantEffect &&
      dominantEffect !== "No gene data found" &&
      dominantEffect !== "No dominant effect" &&
      dominantEffect !== "Unknown gene type"
    ) {
      if (dominantEffect.includes("+")) hasPositive = true;
      if (dominantEffect.includes("-")) hasNegative = true;
    }

    if (
      recessiveEffect &&
      recessiveEffect !== "No gene data found" &&
      recessiveEffect !== "No recessive effect" &&
      recessiveEffect !== "Unknown gene type"
    ) {
      if (recessiveEffect.includes("+")) hasPositive = true;
      if (recessiveEffect.includes("-")) hasNegative = true;
    }

    if (hasPositive) return "potential-positive";
    if (hasNegative) return "potential-negative";
    return null;
  }

  updateTable() {
    const tableBody = document.getElementById("tableBody");
    const tableTitle = document.getElementById("tableTitle");

    tableBody.innerHTML = "";

    if (this.currentView === "attribute") {
      tableTitle.textContent = "Attribute Effects Summary";

      const attributes = [
        { key: "Intelligence", name: "Intelligence", icon: "🧠" },
        { key: "Toughness", name: "Toughness", icon: "💪" },
        { key: "Friendliness", name: "Friendliness", icon: "😊" },
        { key: "Ruggedness", name: "Ruggedness", icon: "🏔️" },
        { key: "Ferocity", name: "Ferocity", icon: "🔥" },
        { key: "Enthusiasm", name: "Enthusiasm", icon: "✨" },
        { key: "Virility", name: "Virility", icon: "💜" },
      ];

      let grandTotal = 0;

      attributes.forEach((attr) => {
        const positiveCount = this.currentStats[attr.key]?.positive || 0;
        const negativeCount = this.currentStats[attr.key]?.negative || 0;
        const totalCount = positiveCount + negativeCount;
        grandTotal += totalCount;

        const row = document.createElement("tr");
        row.dataset.attribute = attr.key;
        row.className = "attribute-row";
        row.style.cursor = "pointer";

        const colorClass =
          positiveCount > negativeCount
            ? "positive"
            : negativeCount > positiveCount
              ? "negative"
              : "neutral";

        row.innerHTML = `
          <td><span class="color-indicator ${colorClass}"></span>${attr.icon} ${attr.name}</td>
          <td>${totalCount}</td>
          <td style="font-size: 0.8em; color: #666;">
            <span style="color: #4CAF50;">+${positiveCount}</span> /
            <span style="color: #f44336;">-${negativeCount}</span>
          </td>
        `;

        // Add click handler for filtering
        row.addEventListener("click", (e) => {
          this.toggleAttributeFilter(
            attr.key,
            e.ctrlKey || e.metaKey,
            e.altKey,
          );
        });

        // Update selection state
        if (this.selectedAttributes.includes(attr.key)) {
          row.classList.add("selected");
        }

        tableBody.appendChild(row);
      });

      // Add totals row
      const totalsRow = document.createElement("tr");
      totalsRow.className = "totals-row";
      totalsRow.innerHTML = `
        <td><strong>Total</strong></td>
        <td><strong>${grandTotal}</strong></td>
        <td><em>All attributes</em></td>
      `;
      tableBody.appendChild(totalsRow);
    } else {
      tableTitle.textContent = "Appearance Effects Summary";

      const appearanceTypes = [
        {
          key: "body-color-hue",
          name: "Body Color Hue",
          examples: "Color tone",
        },
        {
          key: "body-color-saturation",
          name: "Body Color Saturation",
          examples: "Color intensity",
        },
        {
          key: "body-color-intensity",
          name: "Body Color Intensity",
          examples: "Color brightness",
        },
        {
          key: "wing-color-hue",
          name: "Wing Color Hue",
          examples: "Wing tone",
        },
        {
          key: "wing-color-saturation",
          name: "Wing Color Saturation",
          examples: "Wing intensity",
        },
        {
          key: "wing-color-intensity",
          name: "Wing Color Intensity",
          examples: "Wing brightness",
        },
        { key: "body-scale", name: "Body Scale", examples: "Body size" },
        { key: "wing-scale", name: "Wing Scale", examples: "Wing size" },
        { key: "head-scale", name: "Head Scale", examples: "Head size" },
        { key: "tail-scale", name: "Tail Scale", examples: "Tail size" },
        {
          key: "antenna-scale",
          name: "Antenna Scale",
          examples: "Antenna size",
        },
        { key: "leg-deformity", name: "Leg Deformity", examples: "Leg shape" },
        {
          key: "antenna-deformity",
          name: "Antenna Deformity",
          examples: "Antenna shape",
        },
        { key: "particles", name: "Particles", examples: "Visual effects" },
        {
          key: "particle-location",
          name: "Particle Location",
          examples: "Effect position",
        },
        { key: "glow", name: "Glow", examples: "Lighting effects" },
      ];

      let grandTotal = 0;

      appearanceTypes.forEach((type) => {
        const count = this.currentStats[type.key] || 0;
        grandTotal += count;

        const row = document.createElement("tr");
        row.dataset.attribute = type.key;
        row.className = "appearance-row";
        row.style.cursor = "pointer";

        row.innerHTML = `
          <td><span class="color-indicator ${type.key}"></span>${type.name}</td>
          <td>${count}</td>
          <td style="font-size: 0.8em; color: #aaa;">${type.examples}</td>
        `;

        // Add click handler for filtering
        row.addEventListener("click", (e) => {
          this.toggleAttributeFilter(
            type.key,
            e.ctrlKey || e.metaKey,
            e.altKey,
          );
        });

        // Update selection state
        if (this.selectedAttributes.includes(type.key)) {
          row.classList.add("selected");
        }

        tableBody.appendChild(row);
      });

      // Add totals row
      const totalsRow = document.createElement("tr");
      totalsRow.className = "totals-row";
      totalsRow.innerHTML = `
        <td><strong>Total</strong></td>
        <td><strong>${grandTotal}</strong></td>
        <td><em>All appearance effects</em></td>
      `;
      tableBody.appendChild(totalsRow);
    }
  }

  toggleAttributeFilter(attribute, isCtrlClick = false, isAltClick = false) {
    let result;
    if (isAltClick) {
      result = toggleFilterState(
        this.selectedAttributes,
        this.hiddenAttributes,
        attribute,
        "toggle-hide",
      );
    } else if (isCtrlClick) {
      result = toggleFilterState(
        this.selectedAttributes,
        this.hiddenAttributes,
        attribute,
        "toggle-select",
      );
    } else {
      // Regular click: replace selection, but neutralize if hidden
      if (this.hiddenAttributes.includes(attribute)) {
        result = toggleFilterState(
          this.selectedAttributes,
          this.hiddenAttributes,
          attribute,
          "toggle-select",
        );
      } else if (
        this.selectedAttributes.length === 1 &&
        this.selectedAttributes[0] === attribute
      ) {
        result = {
          selected: [],
          hidden: this.hiddenAttributes.filter((a) => a !== attribute),
        };
      } else {
        result = {
          selected: [attribute],
          hidden: this.hiddenAttributes.filter((a) => a !== attribute),
        };
      }
    }
    this.selectedAttributes = result.selected;
    this.hiddenAttributes = result.hidden;
    this.updateTableSelectionState();
    this.updateVisualization();
  }

  toggleChromosomeFilter(chromosome, isCtrlClick = false, isAltClick = false) {
    let result;
    if (isAltClick) {
      result = toggleFilterState(
        this.selectedChromosomes,
        this.hiddenChromosomes,
        chromosome,
        "toggle-hide",
      );
    } else if (isCtrlClick) {
      result = toggleFilterState(
        this.selectedChromosomes,
        this.hiddenChromosomes,
        chromosome,
        "toggle-select",
      );
    } else {
      // Regular click: replace selection, but neutralize if hidden
      if (this.hiddenChromosomes.includes(chromosome)) {
        result = toggleFilterState(
          this.selectedChromosomes,
          this.hiddenChromosomes,
          chromosome,
          "toggle-select",
        );
      } else if (
        this.selectedChromosomes.length === 1 &&
        this.selectedChromosomes[0] === chromosome
      ) {
        result = {
          selected: [],
          hidden: this.hiddenChromosomes.filter((c) => c !== chromosome),
        };
      } else {
        result = {
          selected: [chromosome],
          hidden: this.hiddenChromosomes.filter((c) => c !== chromosome),
        };
      }
    }
    this.selectedChromosomes = result.selected;
    this.hiddenChromosomes = result.hidden;
    this.updateChromosomeSelectionState();
    this.updateVisualization();
  }

  updateTableSelectionState() {
    document
      .querySelectorAll(".attribute-row, .appearance-row")
      .forEach((row) => {
        // Only apply selected if not hidden
        if (
          this.selectedAttributes.includes(row.dataset.attribute) &&
          !this.hiddenAttributes.includes(row.dataset.attribute)
        ) {
          row.classList.add("selected");
        } else {
          row.classList.remove("selected");
        }
        // Only apply hidden if not selected
        if (
          this.hiddenAttributes.includes(row.dataset.attribute) &&
          !this.selectedAttributes.includes(row.dataset.attribute)
        ) {
          row.classList.add("hidden-attribute");
        } else {
          row.classList.remove("hidden-attribute");
        }
      });

    // Update selection counter
    this.updateSelectionCounter();
    this.updateChromosomeCounter();
  }

  updateChromosomeSelectionState() {
    document.querySelectorAll(".chromosome-label").forEach((label) => {
      // Only apply selected if not hidden
      if (
        this.selectedChromosomes.includes(label.dataset.chromosome) &&
        !this.hiddenChromosomes.includes(label.dataset.chromosome)
      ) {
        label.classList.add("selected");
      } else {
        label.classList.remove("selected");
      }
      // Only apply hidden if not selected
      if (
        this.hiddenChromosomes.includes(label.dataset.chromosome) &&
        !this.selectedChromosomes.includes(label.dataset.chromosome)
      ) {
        label.classList.add("hidden-chromosome");
      } else {
        label.classList.remove("hidden-chromosome");
      }
    });
  }

  updateSelectionCounter() {
    const counter = document.getElementById("selectionCounter");
    const countDisplay = document.getElementById("selectedCount");

    if (this.selectedAttributes.length > 0) {
      countDisplay.textContent = this.selectedAttributes.length;
      counter.style.visibility = "visible";
    } else {
      counter.style.visibility = "hidden";
    }
  }

  updateChromosomeCounter() {
    const counter = document.getElementById("chromosomeCounter");
    const countDisplay = document.getElementById("chromosomeCount");

    if (this.selectedChromosomes.length > 0) {
      countDisplay.textContent = this.selectedChromosomes.length;
      counter.style.visibility = "visible";
    } else {
      counter.style.visibility = "hidden";
    }
  }

  updateStatistics(stats, totalGenes) {
    document.getElementById("totalGenesDisplay").textContent = totalGenes;

    if (this.currentView === "attribute") {
      document.getElementById("neutralGenesDisplay").textContent =
        stats.neutral;
    } else {
      document.getElementById("neutralGenesDisplay").textContent =
        stats["appearance-neutral"];
    }
  }

  showTooltip(event) {
    const tooltip = document.getElementById("geneTooltip");
    const cell = event.target;

    const geneId = cell.dataset.geneId;
    const geneType = cell.dataset.geneType;

    let typeDescription = "";
    switch (geneType) {
      case "R":
        typeDescription = "Recessive";
        break;
      case "D":
        typeDescription = "Dominant";
        break;
      case "x":
        typeDescription = "Mixed (treated as dominant)";
        break;
      case "?":
        typeDescription = "Unknown";
        break;
    }

    const effectInfo = cell.dataset.effect;

    // Get potential effects
    let potentialEffectsHtml = "";
    if (this.currentPet) {
      const dominantEffect = this.getGeneEffect(
        this.currentPet.species,
        geneId,
        "D",
      );
      const recessiveEffect = this.getGeneEffect(
        this.currentPet.species,
        geneId,
        "R",
      );

      let showPotential = false;
      let potentialLines = [];

      if (
        geneType !== "D" &&
        dominantEffect &&
        dominantEffect !== "No dominant effect" &&
        dominantEffect !== "No gene data found" &&
        dominantEffect !== "Unknown gene type"
      ) {
        const isPositive = dominantEffect.includes("+");
        const isNegative = dominantEffect.includes("-");
        const color = isPositive ? "#4CAF50" : isNegative ? "#f44336" : "#666";
        potentialLines.push(
          `If Dominant: <span style="color: ${color}">${dominantEffect}</span>`,
        );
        showPotential = true;
      }

      if (
        geneType !== "R" &&
        recessiveEffect &&
        recessiveEffect !== "No recessive effect" &&
        recessiveEffect !== "No gene data found" &&
        recessiveEffect !== "Unknown gene type"
      ) {
        const isPositive = recessiveEffect.includes("+");
        const isNegative = recessiveEffect.includes("-");
        const color = isPositive ? "#4CAF50" : isNegative ? "#f44336" : "#666";
        potentialLines.push(
          `If Recessive: <span style="color: ${color}">${recessiveEffect}</span>`,
        );
        showPotential = true;
      }

      if (showPotential) {
        potentialEffectsHtml = `<br><br><strong>Potential Effects:</strong><br>${potentialLines.join("<br>")}`;
      }
    }

    tooltip.innerHTML = `
            <strong>Gene ${geneId}</strong><br>
            Type: ${typeDescription}<br>
            <strong>Current Effect: ${effectInfo}</strong>
            ${potentialEffectsHtml}
        `;

    tooltip.style.display = "block";

    // Get precise position using getBoundingClientRect
    const rect = cell.getBoundingClientRect();

    tooltip.style.left = rect.right + 5 + "px";
    tooltip.style.top = rect.top - 5 + "px";
  }

  hideTooltip() {
    document.getElementById("geneTooltip").style.display = "none";
  }

  showError(message) {
    const container = document.getElementById("geneGridContainer");
    container.innerHTML = `<div class="error-state">Error: ${message}</div>`;
  }

  updateLegend() {
    const legendItems = document.getElementById("legendItems");
    let legendRow;

    if (this.currentView === "attribute") {
      // Add a data-effect attribute to each effect legend item for click handling
      legendItems.innerHTML = `
        <div class="legend-row">
          <span class="legend-label legend-label-effect">Effect:</span>
          <span class="legend-item effect-legend-item" data-effect="positive">
            <span class="legend-color gene-positive gene-dominant"></span>
            <span>Positive</span>
          </span>
          <span class="legend-item effect-legend-item" data-effect="potential-positive">
            <span class="legend-color gene-potential-positive gene-dominant"></span>
            <span>Potential Positive</span>
          </span>
          <span class="legend-item effect-legend-item" data-effect="neutral">
            <span class="legend-color gene-neutral gene-dominant"></span>
            <span>Neutral</span>
          </span>
          <span class="legend-item effect-legend-item" data-effect="potential-negative">
            <span class="legend-color gene-potential-negative gene-dominant"></span>
            <span>Potential Negative</span>
          </span>
          <span class="legend-item effect-legend-item" data-effect="negative">
            <span class="legend-color gene-negative gene-dominant"></span>
            <span>Negative</span>
          </span>
          <span class="legend-label legend-label-value">Value:</span>
          <span class="legend-item value-legend-item" data-value="dominant">
            <span class="gene-cell gene-neutral gene-dominant"></span>
            <span>Dominant</span>
          </span>
          <span class="legend-item value-legend-item" data-value="recessive">
            <span class="gene-cell gene-neutral gene-recessive"></span>
            <span>Recessive</span>
          </span>
          <span class="legend-item value-legend-item" data-value="mixed">
            <span class="gene-cell gene-neutral gene-mixed"></span>
            <span>Mixed</span>
          </span>
          <span class="legend-item value-legend-item" data-value="unknown">
            <span class="gene-cell gene-neutral gene-unknown"><span class="gene-unknown-symbol" title="Unknown gene">?</span></span>
            <span>Unknown</span>
          </span>
        </div>
      `;

      // Add click handlers for effect legend items (multi-select with ctrl/cmd)
      const effectMap = {
        positive: "positive",
        "potential-positive": "potential-positive",
        neutral: "neutral",
        "potential-negative": "potential-negative",
        negative: "negative",
      };
      legendRow = legendItems.querySelector(".legend-row");
      legendRow.querySelectorAll(".effect-legend-item").forEach((item) => {
        item.style.cursor = "pointer";
        item.addEventListener("click", (e) => {
          const effectType = effectMap[item.dataset.effect];
          let newFilter = Array.isArray(this.currentEffectFilter)
            ? [...this.currentEffectFilter]
            : [];
          let newHidden = Array.isArray(this.hiddenEffectFilters)
            ? [...this.hiddenEffectFilters]
            : [];
          let result;
          if (e.altKey) {
            result = toggleFilterState(
              newFilter,
              newHidden,
              effectType,
              "toggle-hide",
            );
          } else if (e.ctrlKey || e.metaKey) {
            result = toggleFilterState(
              newFilter,
              newHidden,
              effectType,
              "toggle-select",
            );
          } else {
            // Plain click: single-select (replace), but neutralize if hidden
            if (newHidden.includes(effectType)) {
              result = toggleFilterState(
                [],
                newHidden,
                effectType,
                "toggle-select",
              );
            } else if (newFilter.length === 1 && newFilter[0] === effectType) {
              result = {
                selected: [],
                hidden: newHidden.filter((t) => t !== effectType),
              };
            } else {
              result = {
                selected: [effectType],
                hidden: newHidden.filter((t) => t !== effectType),
              };
            }
          }
          this.currentEffectFilter = result.selected;
          this.hiddenEffectFilters = result.hidden;
          this.updateVisualization();
          // Update selected/hidden style
          legendRow.querySelectorAll(".effect-legend-item").forEach((i) => {
            i.classList.remove("selected");
            i.classList.remove("hidden-effect");
          });
          this.currentEffectFilter.forEach((type) => {
            if (!this.hiddenEffectFilters.includes(type)) {
              const selected = legendRow.querySelector(
                `.effect-legend-item[data-effect="${type}"]`,
              );
              if (selected) selected.classList.add("selected");
            }
          });
          this.hiddenEffectFilters.forEach((type) => {
            if (!this.currentEffectFilter.includes(type)) {
              const hidden = legendRow.querySelector(
                `.effect-legend-item[data-effect="${type}"]`,
              );
              if (hidden) hidden.classList.add("hidden-effect");
            }
          });
        });
      });
      // Highlight the selected and hidden effects if any
      if (
        Array.isArray(this.currentEffectFilter) &&
        this.currentEffectFilter.length > 0
      ) {
        this.currentEffectFilter.forEach((type) => {
          const selected = legendRow.querySelector(
            `.effect-legend-item[data-effect="${type}"]`,
          );
          if (selected) selected.classList.add("selected");
        });
      }
      if (
        Array.isArray(this.hiddenEffectFilters) &&
        this.hiddenEffectFilters.length > 0
      ) {
        this.hiddenEffectFilters.forEach((type) => {
          const hidden = legendRow.querySelector(
            `.effect-legend-item[data-effect="${type}"]`,
          );
          if (hidden) hidden.classList.add("hidden-effect");
        });
      }

      // Add click handlers for value legend items (multi-select with ctrl/cmd, alt to hide)
      const valueMap = {
        dominant: "gene-dominant",
        recessive: "gene-recessive",
        mixed: "gene-mixed",
        unknown: "gene-unknown",
      };
      legendRow = legendItems.querySelector(".legend-row");
      if (legendRow) {
        legendRow.querySelectorAll(".value-legend-item").forEach((item) => {
          item.style.cursor = "pointer";
          item.addEventListener("click", (e) => {
            const valueType = valueMap[item.dataset.value];
            let newValueFilter = Array.isArray(this.currentValueFilter)
              ? [...this.currentValueFilter]
              : [];
            let newHiddenValueFilters = Array.isArray(this.hiddenValueFilters)
              ? [...this.hiddenValueFilters]
              : [];

            let result;
            if (e.altKey) {
              result = toggleFilterState(
                newValueFilter,
                newHiddenValueFilters,
                valueType,
                "toggle-hide",
              );
            } else if (e.ctrlKey || e.metaKey) {
              result = toggleFilterState(
                newValueFilter,
                newHiddenValueFilters,
                valueType,
                "toggle-select",
              );
            } else {
              // Plain click: single-select (replace), but neutralize if hidden
              if (newHiddenValueFilters.includes(valueType)) {
                result = toggleFilterState(
                  [],
                  newHiddenValueFilters,
                  valueType,
                  "toggle-select",
                );
              } else if (
                newValueFilter.length === 1 &&
                newValueFilter[0] === valueType
              ) {
                result = {
                  selected: [],
                  hidden: newHiddenValueFilters.filter((t) => t !== valueType),
                };
              } else {
                result = {
                  selected: [valueType],
                  hidden: newHiddenValueFilters.filter((t) => t !== valueType),
                };
              }
            }
            this.currentValueFilter = result.selected;
            this.hiddenValueFilters = result.hidden;
            this.updateVisualization();
            // Update selected/hidden style
            legendRow.querySelectorAll(".value-legend-item").forEach((i) => {
              i.classList.remove("selected");
              i.classList.remove("hidden-effect");
            });
            this.currentValueFilter.forEach((type) => {
              if (!this.hiddenValueFilters.includes(type)) {
                const selected = legendRow.querySelector(
                  `.value-legend-item[data-value="${Object.keys(valueMap).find((key) => valueMap[key] === type)}"]`,
                );
                if (selected) selected.classList.add("selected");
              }
            });
            this.hiddenValueFilters.forEach((type) => {
              if (!this.currentValueFilter.includes(type)) {
                const hidden = legendRow.querySelector(
                  `.value-legend-item[data-value="${Object.keys(valueMap).find((key) => valueMap[key] === type)}"]`,
                );
                if (hidden) hidden.classList.add("hidden-effect");
              }
            });
          });
        });
      }
      // Highlight the selected and hidden values if any
      if (
        Array.isArray(this.currentValueFilter) &&
        this.currentValueFilter.length > 0
      ) {
        this.currentValueFilter.forEach((type) => {
          const selected = legendRow.querySelector(
            `.value-legend-item[data-value="${Object.keys(valueMap).find((key) => valueMap[key] === type)}"]`,
          );
          if (selected) selected.classList.add("selected");
        });
      }
      if (
        Array.isArray(this.hiddenValueFilters) &&
        this.hiddenValueFilters.length > 0
      ) {
        this.hiddenValueFilters.forEach((type) => {
          const hidden = legendRow.querySelector(
            `.value-legend-item[data-value="${Object.keys(valueMap).find((key) => valueMap[key] === type)}"]`,
          );
          if (hidden) hidden.classList.add("hidden-effect");
        });
      }
    } else {
      legendItems.innerHTML = `
        <div class="legend-row">
          <span class="legend-label legend-label-effect">Appearance:</span>
          <span class="legend-item appearance-legend-item" data-appearance="body-color">
            <span class="legend-color gene-body-color-hue gene-dominant"></span>
            <span>Body Color</span>
          </span>
          <span class="legend-item appearance-legend-item" data-appearance="wing-color">
            <span class="legend-color gene-wing-color-hue gene-dominant"></span>
            <span>Wing Color</span>
          </span>
          <span class="legend-item appearance-legend-item" data-appearance="body-scale">
            <span class="legend-color gene-body-scale gene-dominant"></span>
            <span>Body Scale</span>
          </span>
          <span class="legend-item appearance-legend-item" data-appearance="deformities">
            <span class="legend-color gene-leg-deformity gene-dominant"></span>
            <span>Deformities</span>
          </span>
          <span class="legend-item appearance-legend-item" data-appearance="particles">
            <span class="legend-color gene-particles gene-dominant"></span>
            <span>Particles</span>
          </span>
          <span class="legend-item appearance-legend-item" data-appearance="glow">
            <span class="legend-color gene-glow gene-dominant"></span>
            <span>Glow</span>
          </span>
          <span class="legend-item appearance-legend-item" data-appearance="no-effect">
            <span class="legend-color gene-appearance-neutral gene-dominant"></span>
            <span>No Effect</span>
          </span>
        </div>
      `;

      // Add click handlers for appearance legend items (multi-select with ctrl/cmd)
      // Map legend selectors to all related gene effect types (families)
      const appearanceFamilyMap = {
        "body-color": [
          "body-color-hue",
          "body-color-saturation",
          "body-color-intensity",
        ],
        "wing-color": [
          "wing-color-hue",
          "wing-color-saturation",
          "wing-color-intensity",
        ],
        "body-scale": [
          "body-scale",
          "wing-scale",
          "head-scale",
          "tail-scale",
          "antenna-scale",
        ],
        deformities: ["leg-deformity", "antenna-deformity"],
        particles: ["particles", "particle-location"],
        glow: ["glow"],
        "no-effect": ["appearance-neutral"],
      };
      legendRow = legendItems.querySelector(".legend-row");
      legendRow.querySelectorAll(".appearance-legend-item").forEach((item) => {
        item.style.cursor = "pointer";
        item.addEventListener("click", (e) => {
          const family = appearanceFamilyMap[item.dataset.appearance] || [];
          let newFilter = Array.isArray(this.currentEffectFilter)
            ? [...this.currentEffectFilter]
            : [];
          let newHidden = Array.isArray(this.hiddenEffectFilters)
            ? [...this.hiddenEffectFilters]
            : [];
          let result;
          if (e.altKey) {
            // Hide/unhide all family types
            family.forEach((type) => {
              result = toggleFilterState(
                newFilter,
                newHidden,
                type,
                "toggle-hide",
              );
              newFilter = result.selected;
              newHidden = result.hidden;
            });
          } else if (e.ctrlKey || e.metaKey) {
            // Multi-select all family types
            family.forEach((type) => {
              result = toggleFilterState(
                newFilter,
                newHidden,
                type,
                "toggle-select",
              );
              newFilter = result.selected;
              newHidden = result.hidden;
            });
          } else {
            // Plain click: single-select (replace), but neutralize if hidden
            // If any family type is hidden, neutralize all
            const anyHidden = family.some((type) => newHidden.includes(type));
            if (anyHidden) {
              family.forEach((type) => {
                result = toggleFilterState(
                  [],
                  newHidden,
                  type,
                  "toggle-select",
                );
                newFilter = result.selected;
                newHidden = result.hidden;
              });
            } else if (
              family.every(
                (type) =>
                  newFilter.length === family.length &&
                  newFilter.includes(type),
              )
            ) {
              // All already selected: deselect all
              family.forEach((type) => {
                newFilter = newFilter.filter((t) => t !== type);
                newHidden = newHidden.filter((t) => t !== type);
              });
              result = { selected: newFilter, hidden: newHidden };
            } else {
              // Select all family types, remove from hidden
              newFilter = family.slice();
              newHidden = newHidden.filter((t) => !family.includes(t));
              result = { selected: newFilter, hidden: newHidden };
            }
          }
          this.currentEffectFilter = result.selected;
          this.hiddenEffectFilters = result.hidden;
          this.updateVisualization();
          // Visual feedback will be applied after updateLegend() via updateAppearanceLegendFeedback()
        });
      });
      // Highlight the selected and hidden appearance types if any
      if (
        Array.isArray(this.currentEffectFilter) &&
        this.currentEffectFilter.length > 0
      ) {
        // (handled above in the new Object.entries loop)
      }

      // Apply appearance legend visual feedback after HTML is recreated
      this.updateAppearanceLegendFeedback();
    }
  }

  updateAppearanceLegendFeedback() {
    if (this.currentView !== "appearance") return;

    const legendItems = document.getElementById("legendItems");
    const legendRow = legendItems.querySelector(".legend-row");
    if (!legendRow) return;

    // Map legend selectors to all related gene effect types (families)
    const appearanceFamilyMap = {
      "body-color": [
        "body-color-hue",
        "body-color-saturation",
        "body-color-intensity",
      ],
      "wing-color": [
        "wing-color-hue",
        "wing-color-saturation",
        "wing-color-intensity",
      ],
      "body-scale": [
        "body-scale",
        "wing-scale",
        "head-scale",
        "tail-scale",
        "antenna-scale",
      ],
      deformities: ["leg-deformity", "antenna-deformity"],
      particles: ["particles", "particle-location"],
      glow: ["glow"],
      "no-effect": ["appearance-neutral"],
    };

    // Clear existing visual feedback
    legendRow.querySelectorAll(".appearance-legend-item").forEach((i) => {
      i.classList.remove("selected");
      i.classList.remove("hidden-effect");
    });

    // Apply visual feedback based on current filters
    Object.entries(appearanceFamilyMap).forEach(([key, types]) => {
      const selected = types.some(
        (type) =>
          this.currentEffectFilter.includes(type) &&
          !this.hiddenEffectFilters.includes(type),
      );
      const hidden = types.some(
        (type) =>
          this.hiddenEffectFilters.includes(type) &&
          !this.currentEffectFilter.includes(type),
      );
      const el = legendRow.querySelector(
        `.appearance-legend-item[data-appearance="${key}"]`,
      );
      if (el) {
        if (selected) {
          el.classList.add("selected");
        }
        if (hidden) {
          el.classList.add("hidden-effect");
        }
      }
    });
  }

  clear() {
    this.currentPet = null;
    this.selectedAttributes = [];
    this.selectedChromosomes = [];
    this.currentStats = null;

    const container = document.getElementById("geneGridContainer");
    container.innerHTML =
      '<div class="empty-state">Select a pet to visualize its genes</div>';

    document.getElementById("totalGenesDisplay").textContent = "0";
    document.getElementById("neutralGenesDisplay").textContent = "0";
    document.getElementById("tableBody").innerHTML = "";
    this.updateLegend();
  }
}

// Export for use in other modules
window.GeneVisualizer = GeneVisualizer;
