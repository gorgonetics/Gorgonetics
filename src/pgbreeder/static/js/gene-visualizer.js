/**
 * Gene Visualization Module for PGBreeder
 * Integrated version of the standalone gene viewer for the main app
 */

class GeneVisualizer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentPet = null;
    this.currentView = "attribute"; // 'attribute' or 'appearance'
    this.currentEffectFilter = "all";
    this.selectedAttributes = [];
    this.selectedChromosomes = [];
    this.hideNeutral = false;
    this.geneEffectsDB = null;
    this.currentStats = null;

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
                <div class="visualizer-header">
                    <h3>🧬 Gene Visualization</h3>
                    <div class="visualizer-controls">
                        <div class="view-toggle">
                            <button class="btn-view active" data-view="attribute">Attributes</button>
                            <button class="btn-view" data-view="appearance">Appearance</button>
                        </div>
                        <div class="filter-controls">
                            <select id="effectFilter" class="filter-select">
                                <option value="all">All Effects</option>
                                <option value="positive">Positive Effects</option>
                                <option value="negative">Negative Effects</option>
                                <option value="neutral">No Effects</option>
                            </select>
                            <label class="checkbox-label">
                                <input type="checkbox" id="hideNeutral" />
                                Hide genes with no effects
                            </label>
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

    // Effect filter
    document.getElementById("effectFilter").addEventListener("change", (e) => {
      this.currentEffectFilter = e.target.value;
      this.updateVisualization();
    });

    // Hide neutral checkbox
    document.getElementById("hideNeutral").addEventListener("change", (e) => {
      this.hideNeutral = e.target.checked;
      this.updateVisualization();
    });
  }

  async loadPet(petId) {
    try {
      const response = await fetch(`/api/pet-genome/${petId}`);
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
      const response = await fetch(`/api/gene-effects/${species}`);
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
        this.toggleChromosomeFilter(chromosome, e.ctrlKey || e.metaKey);
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
      chromosomeData.allGenes.forEach((gene, index) => {
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

        // Determine visibility
        let isVisible = true;

        // Check chromosome filter
        if (
          this.selectedChromosomes.length > 0 &&
          !this.selectedChromosomes.includes(chromosome)
        ) {
          isVisible = false;
        }

        if (
          this.currentEffectFilter !== "all" &&
          geneAnalysis.type !== this.currentEffectFilter
        ) {
          isVisible = false;
        }

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

        const geneCell = document.createElement("div");

        let cssClass = "gene-cell ";
        if (!isVisible) {
          cssClass += "gene-invisible";
        } else if (
          this.hideNeutral &&
          ((this.currentView === "attribute" &&
            geneAnalysis.type === "neutral" &&
            !this.hasAnyPotentialEffect(pet.species, gene.id)) ||
            (this.currentView === "appearance" &&
              geneAnalysis.type === "appearance-neutral"))
        ) {
          cssClass += "gene-hidden";
        } else {
          // In appearance mode, always use the appearance category for styling
          if (this.currentView === "appearance") {
            cssClass += `gene-${geneAnalysis.type} `;
          } else {
            // In attribute mode, handle potential effects
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
        }

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

        if (isVisible) {
          geneCell.addEventListener("mouseenter", (e) => this.showTooltip(e));
          geneCell.addEventListener("mouseleave", () => this.hideTooltip());
        }

        blocksContainer.appendChild(geneCell);
      });

      chromosomeRow.appendChild(blocksContainer);
      container.appendChild(chromosomeRow);
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
    headerContainer.style.display = "flex";

    // Add chromosome label space
    const chromosomeLabelSpace = document.createElement("div");
    chromosomeLabelSpace.className = "chromosome-header-space";
    chromosomeLabelSpace.style.width = "40px";
    headerContainer.appendChild(chromosomeLabelSpace);

    // Create headers for each block based on longest chromosome structure
    let currentBlock = null;
    longestChromosome.allGenes.forEach((gene, index) => {
      // Add spacer for block gaps
      if (currentBlock !== null && currentBlock !== gene.block) {
        const spacer = document.createElement("div");
        spacer.className = "header-spacer";
        spacer.style.width = "8px";
        headerContainer.appendChild(spacer);
      }
      currentBlock = gene.block;

      const header = document.createElement("div");
      header.className = "position-header";
      header.style.width = "24px";
      header.style.textAlign = "center";
      header.style.fontSize = "10px";
      header.style.padding = "4px 0";

      // Show block letter only on the first position of each block
      if (gene.position === 1) {
        header.textContent = gene.block;
        header.style.fontWeight = "bold";
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

      const isPositive = effect.includes("+");
      const isNegative = effect.includes("-");

      let attribute = null;
      if (effect.includes("Intelligence")) attribute = "Intelligence";
      else if (effect.includes("Toughness")) attribute = "Toughness";
      else if (effect.includes("Friendliness")) attribute = "Friendliness";
      else if (effect.includes("Ruggedness")) attribute = "Ruggedness";
      else if (effect.includes("Ferocity")) attribute = "Ferocity";
      else if (effect.includes("Enthusiasm")) attribute = "Enthusiasm";
      else if (effect.includes("Virility")) attribute = "Virility";

      return {
        type: isPositive ? "positive" : isNegative ? "negative" : "neutral",
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
          this.toggleAttributeFilter(attr.key, e.ctrlKey || e.metaKey);
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
          this.toggleAttributeFilter(type.key, e.ctrlKey || e.metaKey);
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

  toggleAttributeFilter(attribute, isCtrlClick = false) {
    if (isCtrlClick) {
      // Ctrl+click: Add/remove from selection
      const index = this.selectedAttributes.indexOf(attribute);
      if (index > -1) {
        this.selectedAttributes.splice(index, 1);
      } else {
        this.selectedAttributes.push(attribute);
      }
    } else {
      // Regular click: Replace selection
      if (
        this.selectedAttributes.length === 1 &&
        this.selectedAttributes[0] === attribute
      ) {
        // If clicking the same single selected item, deselect it
        this.selectedAttributes = [];
      } else {
        // Replace selection with this attribute
        this.selectedAttributes = [attribute];
      }
    }

    // Update visual selection immediately
    this.updateTableSelectionState();

    this.updateVisualization();
  }

  toggleChromosomeFilter(chromosome, isCtrlClick = false) {
    if (isCtrlClick) {
      // Ctrl+click: Add/remove from selection
      const index = this.selectedChromosomes.indexOf(chromosome);
      if (index > -1) {
        this.selectedChromosomes.splice(index, 1);
      } else {
        this.selectedChromosomes.push(chromosome);
      }
    } else {
      // Regular click: Replace selection
      if (
        this.selectedChromosomes.length === 1 &&
        this.selectedChromosomes[0] === chromosome
      ) {
        // If clicking the same single selected item, deselect it
        this.selectedChromosomes = [];
      } else {
        // Replace selection with this chromosome
        this.selectedChromosomes = [chromosome];
      }
    }

    // Update visual selection immediately
    this.updateChromosomeSelectionState();

    this.updateVisualization();
  }

  updateTableSelectionState() {
    document
      .querySelectorAll(".attribute-row, .appearance-row")
      .forEach((row) => {
        if (this.selectedAttributes.includes(row.dataset.attribute)) {
          row.classList.add("selected");
        } else {
          row.classList.remove("selected");
        }
      });

    // Update selection counter
    this.updateSelectionCounter();
    this.updateChromosomeCounter();
  }

  updateChromosomeSelectionState() {
    document.querySelectorAll(".chromosome-label").forEach((label) => {
      if (this.selectedChromosomes.includes(label.dataset.chromosome)) {
        label.classList.add("selected");
      } else {
        label.classList.remove("selected");
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

    if (this.currentView === "attribute") {
      legendItems.innerHTML = `
        <div class="legend-row" style="display: flex; align-items: center; flex-wrap: wrap; gap: 2.5em;">
          <span class="legend-label" style="font-weight:600;margin-right:1em;">Effect:</span>
          <span class="legend-item" style="display:flex;align-items:center;gap:0.4em;">
            <span class="legend-color gene-positive gene-dominant"></span>
            <span>Positive</span>
          </span>
          <span class="legend-item" style="display:flex;align-items:center;gap:0.4em;">
            <span class="legend-color gene-potential-positive gene-dominant"></span>
            <span>Potential Positive</span>
          </span>
          <span class="legend-item" style="display:flex;align-items:center;gap:0.4em;">
            <span class="legend-color gene-neutral gene-dominant"></span>
            <span>Neutral</span>
          </span>
          <span class="legend-item" style="display:flex;align-items:center;gap:0.4em;">
            <span class="legend-color gene-potential-negative gene-dominant"></span>
            <span>Potential Negative</span>
          </span>
          <span class="legend-item" style="display:flex;align-items:center;gap:0.4em;">
            <span class="legend-color gene-negative gene-dominant"></span>
            <span>Negative</span>
          </span>
          <span class="legend-label" style="font-weight:600;margin-left:2em;margin-right:1em;">Value:</span>
          <span class="legend-item" style="display:flex;align-items:center;gap:0.4em;">
            <span class="gene-cell gene-neutral gene-dominant"></span>
            <span>Dominant</span>
          </span>
          <span class="legend-item" style="display:flex;align-items:center;gap:0.4em;">
            <span class="gene-cell gene-neutral gene-recessive"></span>
            <span>Recessive</span>
          </span>
          <span class="legend-item" style="display:flex;align-items:center;gap:0.4em;">
            <span class="gene-cell gene-neutral gene-mixed"></span>
            <span>Mixed</span>
          </span>
          <span class="legend-item" style="display:flex;align-items:center;gap:0.4em;">
           <span class="gene-cell gene-neutral gene-unknown"><span class="gene-unknown-symbol" title="Unknown gene">?</span></span>
           <span>Unknown</span>
          </span>
        </div>
      `;
    } else {
      legendItems.innerHTML = `
        <div class="legend-item">
          <div class="legend-color gene-body-color-hue gene-dominant"></div>
          <span>Body Color</span>
        </div>
        <div class="legend-item">
          <div class="legend-color gene-wing-color-hue gene-dominant"></div>
          <span>Wing Color</span>
        </div>
        <div class="legend-item">
          <div class="legend-color gene-body-scale gene-dominant"></div>
          <span>Body Scale</span>
        </div>
        <div class="legend-item">
          <div class="legend-color gene-leg-deformity gene-dominant"></div>
          <span>Deformities</span>
        </div>
        <div class="legend-item">
          <div class="legend-color gene-particles gene-dominant"></div>
          <span>Particles</span>
        </div>
        <div class="legend-item">
          <div class="legend-color gene-glow gene-dominant"></div>
          <span>Glow</span>
        </div>
        <div class="legend-item">
          <div class="legend-color gene-appearance-neutral gene-dominant"></div>
          <span>No Effect</span>
        </div>
      `;
    }
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
