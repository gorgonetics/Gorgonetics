/**
 * Gene Management for PGBreeder web application.
 * Handles gene display, editing, and saving operations.
 */

class GeneManager {
  constructor(apiClient) {
    this.apiClient = apiClient;
    this.effectOptions = [];
  }

  /**
   * Initialize the gene manager
   */
  async initialize() {
    try {
      this.effectOptions = await this.apiClient.getEffectOptions();
    } catch (error) {
      console.error("Failed to load effect options:", error);
      this.effectOptions = ["None"]; // Fallback
    }
  }

  /**
   * Display genes in the UI
   */
  displayGenes(genes, animalType) {
    const container = document.getElementById("genesContent");

    if (genes.length === 0) {
      container.innerHTML =
        '<div class="loading">No genes found for this chromosome</div>';
      // Hide the legend when no genes are displayed
      const legend = document.getElementById("effectLegend");
      if (legend) {
        legend.style.display = "none";
      }
      return;
    }

    // Group genes by letter prefix (e.g., 01A1, 01A2, 01A3, 01A4 -> group "01A")
    const geneGroups = {};
    genes.forEach((gene) => {
      // Extract letter prefix from gene name (e.g., "01A1" -> "01A")
      const match = gene.gene.match(/^(\d+[A-Z])/);
      if (match) {
        const prefix = match[1];
        if (!geneGroups[prefix]) {
          geneGroups[prefix] = [];
        }
        geneGroups[prefix].push(gene);
      }
    });

    const grid = document.createElement("div");
    grid.className = "genes-grid";

    // Create blocks for each gene group
    Object.keys(geneGroups)
      .sort()
      .forEach((prefix) => {
        const block = document.createElement("div");
        block.className = "gene-block";

        const header = document.createElement("div");
        header.className = "gene-block-header";
        header.onclick = () => this.toggleGeneBlock(block);

        const headerText = document.createElement("span");
        headerText.textContent = `Gene Block ${prefix}`;

        const foldIcon = document.createElement("span");
        foldIcon.className = "fold-icon";
        foldIcon.textContent = "▼";

        header.appendChild(headerText);
        header.appendChild(foldIcon);

        const row = document.createElement("div");
        row.className = "gene-row";

        // Sort genes within the group (01A1, 01A2, 01A3, 01A4)
        geneGroups[prefix]
          .sort((a, b) => a.gene.localeCompare(b.gene))
          .forEach((gene) => {
            const card = this.createGeneCard(gene, animalType);
            row.appendChild(card);
          });

        block.appendChild(header);
        block.appendChild(row);
        grid.appendChild(block);
      });

    container.innerHTML = "";
    container.appendChild(grid);

    // Show the effect legend when genes are displayed
    const legend = document.getElementById("effectLegend");
    if (legend) {
      legend.style.display = "block";
    }
  }

  /**
   * Create a gene card element
   */
  createGeneCard(gene, animalType) {
    const card = document.createElement("div");
    card.className = "gene-card";

    // Extract just the number from the gene name (e.g., "01A1" -> "1")
    const geneNumber = gene.gene.slice(-1);

    // Get emojis for current effects
    const dominantEmoji = this.getAttributeEmoji(gene.effectDominant);
    const recessiveEmoji = this.getAttributeEmoji(gene.effectRecessive);
    const dominantDisplay =
      gene.effectDominant && dominantEmoji
        ? `${dominantEmoji} ${gene.effectDominant}`
        : gene.effectDominant || "None";
    const recessiveDisplay =
      gene.effectRecessive && recessiveEmoji
        ? `${recessiveEmoji} ${gene.effectRecessive}`
        : gene.effectRecessive || "None";

    card.innerHTML = `
            <div class="gene-number">${geneNumber}</div>
            
            <div class="gene-field horizontal">
                <label>Dom</label>
                <div class="custom-select-wrapper" data-field="effectDominant" data-gene="${gene.gene}" data-animal="${animalType}" data-original="${gene.effectDominant || ""}">
                    <div class="custom-select-selected">${dominantDisplay}</div>
                    <div class="custom-select-options" style="display:none;">
                        ${this.getFilteredEffectOptions("dominant")
                          .map((effect) => {
                            const emoji = this.getAttributeEmoji(effect);
                            const displayText =
                              effect !== "None" && emoji
                                ? `${emoji} ${effect}`
                                : effect;
                            return `<div class="custom-option" data-value="${effect}" ${effect === gene.effectDominant ? "selected" : ""}>${displayText}</div>`;
                          })
                          .join("")}
                    </div>
                </div>
            </div>
            
            <div class="gene-field horizontal">
                <label>Rec</label>
                <div class="custom-select-wrapper" data-field="effectRecessive" data-gene="${gene.gene}" data-animal="${animalType}" data-original="${gene.effectRecessive || ""}">
                    <div class="custom-select-selected">${recessiveDisplay}</div>
                    <div class="custom-select-options" style="display:none;">
                        ${this.getFilteredEffectOptions("recessive")
                          .map((effect) => {
                            const emoji = this.getAttributeEmoji(effect);
                            const displayText =
                              effect !== "None" && emoji
                                ? `${emoji} ${effect}`
                                : effect;
                            return `<div class="custom-option" data-value="${effect}" ${effect === gene.effectRecessive ? "selected" : ""}>${displayText}</div>`;
                          })
                          .join("")}
                    </div>
                </div>
            </div>
            
            <div class="gene-field">
                <label>Appearance</label>
                <input type="text" data-field="appearance" data-gene="${gene.gene}" data-animal="${animalType}" 
                       value="${gene.appearance}" placeholder="Appearance" data-original="${gene.appearance || ""}">
            </div>
            
            <div class="notes-section">
                <button type="button" class="notes-toggle" onclick="window.geneManager.toggleNotes(this)">
                    + Notes
                </button>
                <div class="notes-content">
                    <input type="text" data-field="notes" data-gene="${gene.gene}" data-animal="${animalType}" 
                           value="${gene.notes}" placeholder="Notes" data-original="${gene.notes || ""}">
                </div>
            </div>
            
            <button class="save-btn" onclick="window.geneManager.saveGene('${gene.gene}', '${animalType}')" disabled>
                Save
            </button>
        `;

    // Add change listeners to all form elements
    const formElements = card.querySelectorAll("[data-field]");
    formElements.forEach((element) => {
      if (element.classList.contains("custom-select-wrapper")) {
        // Setup custom dropdown functionality
        this.setupCustomDropdown(element);
      }

      element.addEventListener("change", () => {
        this.checkForChanges(card);
        // Update styling when effect values change
        if (
          element.dataset.field === "effectDominant" ||
          element.dataset.field === "effectRecessive"
        ) {
          this.updateGeneCardState(card);
        }
      });
      element.addEventListener("input", () => this.checkForChanges(card));
    });

    // Ensure Notes section starts collapsed
    const notesToggle = card.querySelector(".notes-toggle");
    const notesContent = card.querySelector(".notes-content");
    if (notesToggle && notesContent) {
      notesToggle.textContent = "+ Notes";
      notesContent.classList.remove("expanded");
    }

    // Apply initial effect styling to custom dropdowns
    this.applyInitialDropdownStyling(card);

    return card;
  }

  /**
   * Check if any fields in the gene card have been changed
   */
  checkForChanges(card) {
    const saveBtn = card.querySelector(".save-btn");
    const formElements = card.querySelectorAll("[data-field]");
    let hasChanges = false;

    formElements.forEach((element) => {
      const originalValue = element.getAttribute("data-original") || "";
      const currentValue = element.value || "";

      if (originalValue !== currentValue) {
        hasChanges = true;
      }
    });

    // Enable/disable save button and update visual state
    saveBtn.disabled = !hasChanges;
    if (hasChanges) {
      card.classList.add("has-changes");
    } else {
      card.classList.remove("has-changes");
    }
  }

  /**
   * Save gene changes
   */
  async saveGene(geneId, animalType) {
    try {
      const card = document
        .querySelector(`[data-gene="${geneId}"][data-animal="${animalType}"]`)
        .closest(".gene-card");
      const fields = card.querySelectorAll("[data-field]");

      const updateData = {
        animal_type: animalType,
        gene: geneId,
      };

      fields.forEach((field) => {
        const fieldName = field.dataset.field;
        // Convert camelCase to snake_case for API compatibility
        const apiFieldName = fieldName.replace(/([A-Z])/g, "_$1").toLowerCase();
        updateData[apiFieldName] = field.value;
      });

      await this.apiClient.updateGene(updateData);
      UIUtils.showSuccess(`Gene ${geneId} updated successfully!`);

      // Reset change tracking after successful save
      fields.forEach((field) => {
        field.setAttribute("data-original", field.value || "");
      });

      // Disable save button and remove change indicator
      const saveBtn = card.querySelector(".save-btn");
      saveBtn.disabled = true;
      card.classList.remove("has-changes");
    } catch (error) {
      UIUtils.showError("Failed to save gene: " + error.message);
    }
  }

  /**
   * Toggle gene block visibility
   */
  toggleGeneBlock(block) {
    block.classList.toggle("collapsed");
  }

  /**
   * Toggle notes section visibility
   */
  toggleNotes(button) {
    const notesContent = button.nextElementSibling;
    const isExpanded = notesContent.classList.contains("expanded");

    if (isExpanded) {
      notesContent.classList.remove("expanded");
      button.textContent = "+ Notes";
    } else {
      notesContent.classList.add("expanded");
      button.textContent = "📝 Notes";
      // Focus the input when expanded
      const input = notesContent.querySelector("input");
      if (input) {
        setTimeout(() => input.focus(), 100);
      }
    }
  }

  /**
   * Create a custom styled dropdown for effects
   */
  createStyledDropdown(fieldName, currentValue, gene, animalType) {
    const dropdown = document.createElement("div");
    dropdown.className = "custom-select-wrapper";
    dropdown.dataset.field = fieldName;
    dropdown.dataset.gene = gene;
    dropdown.dataset.animal = animalType;
    dropdown.dataset.original = currentValue || "";

    const selected = document.createElement("div");
    selected.className = "custom-select-selected";
    const initialEmoji = this.getAttributeEmoji(currentValue);
    selected.textContent =
      currentValue && currentValue !== "None" && initialEmoji
        ? `${initialEmoji} ${currentValue}`
        : currentValue || "None";

    const optionsContainer = document.createElement("div");
    optionsContainer.className = "custom-select-options";
    optionsContainer.style.display = "none";

    // Get filtered options based on field type
    const filterType =
      fieldName === "effectDominant" ? "dominant" : "recessive";
    const filteredOptions = this.getFilteredEffectOptions(filterType);

    // Add filtered effect options
    filteredOptions.forEach((effect) => {
      const option = document.createElement("div");
      option.className = "custom-option";
      option.dataset.value = effect;

      // Add emoji to effect text
      const emoji = this.getAttributeEmoji(effect);
      option.textContent = emoji ? `${emoji} ${effect}` : effect;

      // Apply styling classes based on effect
      this.applyOptionStyling(option, effect);

      if (effect === currentValue) {
        option.classList.add("selected");
        this.applyOptionStyling(selected, effect); // Use original effect value, not display text
        // Update selected display with emoji
        const selectedEmoji = this.getAttributeEmoji(currentValue);
        selected.textContent = selectedEmoji
          ? `${selectedEmoji} ${currentValue}`
          : currentValue;
      }

      option.addEventListener("click", () => {
        // Update selected value with emoji
        const clickedEmoji = this.getAttributeEmoji(effect);
        selected.textContent = clickedEmoji
          ? `${clickedEmoji} ${effect}`
          : effect;
        selected.dataset.value = effect;

        // Remove selected class from all options
        optionsContainer.querySelectorAll(".custom-option").forEach((opt) => {
          opt.classList.remove("selected");
        });

        // Add selected class to clicked option
        option.classList.add("selected");

        // Apply styling to selected display using original effect value
        selected.className = "custom-select-selected";
        this.applyOptionStyling(selected, effect); // Use original effect value

        // Hide options
        optionsContainer.style.display = "none";
        dropdown.classList.remove("open");

        // Trigger change event for gene card update
        const changeEvent = new Event("change", { bubbles: true });
        dropdown.dispatchEvent(changeEvent);
      });

      optionsContainer.appendChild(option);
    });

    // Toggle dropdown on selected click
    selected.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = optionsContainer.style.display === "block";

      // Close all other dropdowns
      document.querySelectorAll(".custom-select-options").forEach((opts) => {
        opts.style.display = "none";
      });
      document.querySelectorAll(".custom-select-wrapper").forEach((wrapper) => {
        wrapper.classList.remove("open");
      });

      if (!isOpen) {
        optionsContainer.style.display = "block";
        dropdown.classList.add("open");

        // Apply styling to all options
        const options = dropdown.querySelectorAll(".custom-option");
        options.forEach((option) => {
          this.applyOptionStyling(option, option.dataset.value);
        });
      }
    });

    dropdown.appendChild(selected);
    dropdown.appendChild(optionsContainer);

    // Close dropdown when clicking outside
    document.addEventListener("click", () => {
      optionsContainer.style.display = "none";
      dropdown.classList.remove("open");
    });

    return dropdown;
  }

  /**
   * Setup custom dropdown functionality
   */
  setupCustomDropdown(dropdown) {
    const selected = dropdown.querySelector(".custom-select-selected");
    const optionsContainer = dropdown.querySelector(".custom-select-options");
    const options = optionsContainer.querySelectorAll(".custom-option");

    // Add value property to dropdown wrapper for compatibility
    Object.defineProperty(dropdown, "value", {
      get: function () {
        return (
          selected.dataset.value || selected.textContent.replace(/^[^\s]+ /, "")
        ); // Remove emoji from textContent
      },
      set: function (value) {
        const emoji = this.getAttributeEmoji
          ? this.getAttributeEmoji(value)
          : "";
        selected.textContent =
          emoji && value !== "None" ? `${emoji} ${value}` : value;
        selected.dataset.value = value;
      },
    });

    // Toggle dropdown on selected click
    selected.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = optionsContainer.style.display === "block";

      // Close all other dropdowns
      document.querySelectorAll(".custom-select-options").forEach((opts) => {
        opts.style.display = "none";
      });
      document.querySelectorAll(".custom-select-wrapper").forEach((wrapper) => {
        wrapper.classList.remove("open");
      });

      if (!isOpen) {
        optionsContainer.style.display = "block";
        dropdown.classList.add("open");

        // Apply styling to all options
        options.forEach((option) => {
          this.applyOptionStyling(option, option.dataset.value);
        });
      }
    });

    // Handle option clicks
    options.forEach((option) => {
      option.addEventListener("click", (e) => {
        e.stopPropagation();
        const value = option.dataset.value;

        // Update selected value
        selected.textContent = value;
        selected.dataset.value = value;

        // Remove selected class from all options
        options.forEach((opt) => opt.classList.remove("selected"));

        // Add selected class to clicked option
        option.classList.add("selected");

        // Apply styling to selected display
        this.applyOptionStyling(selected, value);

        // Hide options
        optionsContainer.style.display = "none";
        dropdown.classList.remove("open");

        // Trigger change event
        const changeEvent = new Event("change", { bubbles: true });
        dropdown.dispatchEvent(changeEvent);
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", () => {
      optionsContainer.style.display = "none";
      dropdown.classList.remove("open");
    });
  }

  /**
   * Apply initial styling to all dropdowns in a card
   */
  applyInitialDropdownStyling(card) {
    const dropdowns = card.querySelectorAll(".custom-select-wrapper");
    dropdowns.forEach((dropdown) => {
      const selected = dropdown.querySelector(".custom-select-selected");
      const value =
        selected.dataset.value ||
        selected.textContent.replace(/^[^\s]+ /, "") ||
        selected.textContent;
      this.applyOptionStyling(selected, value);

      // Apply styling to all options
      const options = dropdown.querySelectorAll(".custom-option");
      options.forEach((option) => {
        this.applyOptionStyling(option, option.dataset.value);
      });
    });
  }

  /**
   * Apply styling classes to dropdown options
   */
  applyOptionStyling(element, value) {
    // Remove all existing effect classes
    element.classList.remove(
      "option-positive",
      "option-negative",
      "option-none",
      "option-intelligence",
      "option-toughness",
      "option-speed",
      "option-friendliness",
      "option-ruggedness",
      "option-ferocity",
      "option-enthusiasm",
      "option-virility",
    );

    if (!value || value === "None") {
      element.classList.add("option-none");
      return;
    }

    // Extract just the attribute name and +/- from the original value (not display text)
    let effectValue = value;

    // If this is display text with emoji, extract the actual effect value
    if (typeof value === "string" && value.includes(" ")) {
      // Extract effect from "🧠 Intelligence+" format
      const parts = value.split(" ");
      if (parts.length >= 2) {
        effectValue = parts[parts.length - 1]; // Get the last part (e.g., "Intelligence+")
      }
    }

    // Add positive/negative class
    if (effectValue.endsWith("+")) {
      element.classList.add("option-positive");
    } else if (effectValue.endsWith("-")) {
      element.classList.add("option-negative");
    }

    // Add attribute-specific class
    const attribute = effectValue.replace(/[+-]$/, "").toLowerCase();
    if (attribute && attribute !== "none") {
      element.classList.add(`option-${attribute}`);
    }
  }

  /**
   * Apply visual styling to effect select elements based on their values
   */
  applyEffectStyling(selectElement) {
    const value = selectElement.value;

    // Remove all existing effect classes
    selectElement.classList.remove(
      "effect-positive",
      "effect-negative",
      "effect-none",
      "effect-intelligence",
      "effect-toughness",
      "effect-speed",
      "effect-friendliness",
      "effect-ruggedness",
      "effect-ferocity",
      "effect-enthusiasm",
      "effect-virility",
    );

    if (!value || value === "None") {
      selectElement.classList.add("effect-none");
      return;
    }

    // Add positive/negative class
    if (value.endsWith("+")) {
      selectElement.classList.add("effect-positive");
    } else if (value.endsWith("-")) {
      selectElement.classList.add("effect-negative");
    }

    // Add attribute-specific class
    const attribute = value.replace(/[+-]$/, "").toLowerCase();
    if (attribute) {
      selectElement.classList.add(`effect-${attribute}`);
    }
  }

  /**
   * Update gene card visual state based on effects
   */
  updateGeneCardState(card) {
    const dominantDropdown = card.querySelector(
      '[data-field="effectDominant"]',
    );
    const recessiveDropdown = card.querySelector(
      '[data-field="effectRecessive"]',
    );

    // Apply styling to custom dropdowns
    if (dominantDropdown) {
      const dominantSelected = dominantDropdown.querySelector(
        ".custom-select-selected",
      );
      const dominantValue =
        dominantSelected.dataset.value ||
        dominantSelected.textContent.replace(/^[^\s]+ /, "") ||
        dominantSelected.textContent;
      this.applyOptionStyling(dominantSelected, dominantValue);
    }
    if (recessiveDropdown) {
      const recessiveSelected = recessiveDropdown.querySelector(
        ".custom-select-selected",
      );
      const recessiveValue =
        recessiveSelected.dataset.value ||
        recessiveSelected.textContent.replace(/^[^\s]+ /, "") ||
        recessiveSelected.textContent;
      this.applyOptionStyling(recessiveSelected, recessiveValue);
    }

    // Add has-effects class if any effects are present
    const hasEffects =
      (dominantDropdown &&
        dominantDropdown.value &&
        dominantDropdown.value !== "None") ||
      (recessiveDropdown &&
        recessiveDropdown.value &&
        recessiveDropdown.value !== "None");

    if (hasEffects) {
      card.classList.add("has-effects");
    } else {
      card.classList.remove("has-effects");
    }
  }

  /**
   * Get filtered effect options based on type (dominant or recessive)
   * Dominant effects are always negative (ending with -)
   * Recessive effects are always positive (ending with +)
   */
  getFilteredEffectOptions(type) {
    let filteredOptions;

    if (type === "dominant") {
      // Show only negative effects (ending with -) and None
      filteredOptions = this.effectOptions.filter(
        (effect) => effect === "None" || effect.endsWith("-"),
      );
    } else if (type === "recessive") {
      // Show only positive effects (ending with +) and None
      filteredOptions = this.effectOptions.filter(
        (effect) => effect === "None" || effect.endsWith("+"),
      );
    } else {
      // Fallback to all options if type not recognized
      filteredOptions = this.effectOptions;
    }

    // Sort with "None" first, then alphabetically
    return filteredOptions.sort((a, b) => {
      if (a === "None") return -1;
      if (b === "None") return 1;
      return a.localeCompare(b);
    });
  }

  /**
   * Get emoji for each attribute type
   */
  getAttributeEmoji(effect) {
    if (!effect || effect === "None") return "";

    const attribute = effect.replace(/[+-]$/, ""); // Remove +/- suffix
    const emojiMap = {
      Intelligence: "🧠",
      Toughness: "💪",
      Speed: "⚡",
      Friendliness: "😊",
      Ruggedness: "🏔️",
      Ferocity: "🔥",
      Enthusiasm: "✨",
      Virility: "💜",
    };

    return emojiMap[attribute] || "";
  }
}

// Export for use in other modules
window.GeneManager = GeneManager;
