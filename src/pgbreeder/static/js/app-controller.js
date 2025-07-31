/**
 * Main Application Controller for PGBreeder web application.
 * Coordinates all modules and handles the application lifecycle.
 */

class AppController {
  constructor() {
    this.apiClient = new ApiClient();
    this.geneManager = new GeneManager(this.apiClient);
    this.exportManager = new ExportManager(this.apiClient);
    this.geneVisualizer = null;
    this.currentMode = "pet-management"; // 'gene-editing' or 'pet-management'

    // Make instances available globally for onclick handlers
    window.geneManager = this.geneManager;
    window.exportManager = this.exportManager;
    window.appController = this;
  }

  /**
   * Initialize the application
   */
  async initialize() {
    try {
      await this.geneManager.initialize();
      await this.loadAnimalTypes();
      this.initializeGeneVisualizer();
      this.setupEventListeners();
      this.setupTabSwitching();
      this.loadPets();

      // Show pets dashboard in main window if Pet Manager is default tab
      const petTab = document.querySelector('.tab[data-tab="pet-management"]');
      if (petTab && petTab.getAttribute("aria-selected") === "true") {
        const genesContent = document.getElementById("genesContent");
        if (genesContent) {
          genesContent.innerHTML = `
            <div class="pets-dashboard">
                <h2>Pet Collection Dashboard</h2>
                <p>Manage your pet collection here. Upload new pets using the sidebar or select a pet to view details.</p>
                <div class="pets-stats" id="petsStats">
                    <div class="loading">Loading statistics...</div>
                </div>
            </div>
          `;
        }
      }
    } catch (error) {
      UIUtils.showError("Failed to initialize application: " + error.message);
    }
  }

  /**
   * Initialize the gene visualizer
   */
  initializeGeneVisualizer() {
    this.geneVisualizer = new GeneVisualizer("geneVisualizationContainer");
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Sidebar toggle
    const sidebarToggle = document.getElementById("sidebarToggle");

    if (sidebarToggle) {
      sidebarToggle.addEventListener("click", (e) => {
        e.preventDefault();
        this.toggleSidebar();
      });
    }

    // Logo box toggle
    const logoBox = document.querySelector(".logo-box");
    console.log("Logo box found:", logoBox);
    if (logoBox) {
      logoBox.addEventListener("click", (e) => {
        console.log("Logo box clicked!");
        e.preventDefault();
        e.stopPropagation();
        this.toggleSidebar();
      });
      logoBox.style.cursor = "pointer";
      logoBox.style.userSelect = "none";
      logoBox.title = "Click to toggle sidebar";
    } else {
      console.error("Logo box not found!");
    }

    // Keyboard shortcut for sidebar toggle (Ctrl/Cmd + B)
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        this.toggleSidebar();
      }
    });

    // Restore sidebar state on load
    this.restoreSidebarState();

    // Animal type selection
    document.getElementById("animalType").addEventListener("change", (e) => {
      const animalType = e.target.value;
      if (animalType) {
        this.loadChromosomes(animalType);
        UIUtils.updateButtonStates(animalType, null);
      } else {
        UIUtils.updateButtonStates(null, null);
        UIUtils.populateSelect(
          "chromosome",
          [],
          null,
          null,
          "Select chromosome...",
        );
      }
      // Clear gene display when animal type changes
      UIUtils.clearGeneDisplay();
    });

    // Chromosome selection
    document.getElementById("chromosome").addEventListener("change", (e) => {
      const chromosome = e.target.value;
      const animalType = document.getElementById("animalType").value;
      UIUtils.updateButtonStates(animalType, chromosome);
      // Clear gene display when chromosome changes (user needs to click Load Genes)
      UIUtils.clearGeneDisplay();
    });

    // Load genes button
    document.getElementById("loadGenes").addEventListener("click", () => {
      const animalType = document.getElementById("animalType").value;
      const chromosome = document.getElementById("chromosome").value;

      if (animalType && chromosome) {
        this.loadGenes(animalType, chromosome);
      }
    });

    // Export buttons
    document
      .getElementById("exportChromosome")
      .addEventListener("click", () => {
        this.exportManager.exportChromosome();
      });

    document.getElementById("exportAll").addEventListener("click", () => {
      this.exportManager.exportAllChromosomes();
    });

    // Pet upload handling
    this.setupPetUpload();
  }

  /**
   * Toggle sidebar collapse/expand
   */
  toggleSidebar() {
    const sidebar = document.querySelector(".sidebar");
    const mainContent = document.querySelector(".main-content");
    const toggleBtn = document.getElementById("sidebarToggle");
    const body = document.body;

    if (!sidebar || !mainContent || !toggleBtn) {
      return;
    }

    sidebar.classList.toggle("collapsed");
    mainContent.classList.toggle("sidebar-collapsed");
    body.classList.toggle("sidebar-collapsed");

    // Update toggle button state
    if (sidebar.classList.contains("collapsed")) {
      toggleBtn.title = "Expand sidebar";
      localStorage.setItem("sidebarCollapsed", "true");
    } else {
      toggleBtn.title = "Collapse sidebar";
      localStorage.setItem("sidebarCollapsed", "false");
    }
  }

  /**
   * Restore sidebar state from localStorage
   */
  restoreSidebarState() {
    const isCollapsed = localStorage.getItem("sidebarCollapsed") === "true";
    if (isCollapsed) {
      // Apply collapsed state without animation first
      const sidebar = document.querySelector(".sidebar");
      const mainContent = document.querySelector(".main-content");
      const toggleBtn = document.getElementById("sidebarToggle");
      const body = document.body;

      sidebar.classList.add("collapsed");
      mainContent.classList.add("sidebar-collapsed");
      body.classList.add("sidebar-collapsed");

      if (toggleBtn) {
        toggleBtn.title = "Expand sidebar";
      }
    }
  }

  /**
   * Setup tab switching functionality
   */
  setupTabSwitching() {
    const tabs = document.querySelectorAll(".tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", (e) => {
        // Auto-expand sidebar if collapsed when switching tabs
        const sidebar = document.querySelector(".sidebar");
        if (sidebar && sidebar.classList.contains("collapsed")) {
          this.toggleSidebar();
        }

        // Handle clicks on tab children (icon/text)
        const tabElement = e.target.closest(".tab");
        const tabId = tabElement
          ? tabElement.dataset.tab
          : e.target.dataset.tab;
        if (tabId) {
          this.switchTab(tabId);
        }
      });
    });

    // No default tab selection here; handled by user click or HTML default
  }

  /**
   * Switch between tabs
   */
  switchTab(tabId) {
    try {
      console.log("Switching to tab:", tabId);

      // Update tab states
      document.querySelectorAll(".tab").forEach((tab) => {
        tab.setAttribute("aria-selected", "false");
      });

      const targetTab = document.querySelector(`[data-tab="${tabId}"]`);
      if (!targetTab) {
        console.error("Tab not found:", tabId);
        return;
      }
      targetTab.setAttribute("aria-selected", "true");

      // Update panel visibility
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.style.display = "none";
      });

      const targetPanel = document.getElementById(tabId);
      if (!targetPanel) {
        console.error("Tab panel not found:", tabId);
        return;
      }
      targetPanel.style.display = "block";

      // Update main content
      if (tabId === "gene-editing") {
        const genesContent = document.getElementById("genesContent");
        const vizContainer = document.getElementById(
          "geneVisualizationContainer",
        );

        if (genesContent) genesContent.style.display = "block";
        if (vizContainer) vizContainer.style.display = "none";

        this.currentMode = "gene-editing";
        console.log("Switched to gene editing mode");
      } else if (tabId === "pet-management") {
        const genesContent = document.getElementById("genesContent");
        const vizContainer = document.getElementById(
          "geneVisualizationContainer",
        );

        if (genesContent) genesContent.style.display = "none";
        if (vizContainer) vizContainer.style.display = "block";

        this.currentMode = "pet-management";

        // Always reinitialize gene visualizer for pet management
        console.log("Initializing gene visualizer for pet management");
        this.initializeGeneVisualizer();
        this.loadPets();

        console.log("Switched to pet management mode");
      }
    } catch (error) {
      console.error("Error switching tabs:", error);
    }
  }

  /**
   * Load pets for the pet management tab
   */
  async loadPets() {
    try {
      const pets = await this.apiClient.getPets();
      this.displayPets(pets);
    } catch (error) {
      console.error("Failed to load pets:", error);
    }
  }

  /**
   * Display pets in the pet management section
   */
  displayPets(pets) {
    const petsList = document.getElementById("petsList");

    if (pets.length === 0) {
      petsList.innerHTML =
        '<div class="empty-state">No pets uploaded yet</div>';
      return;
    }

    petsList.innerHTML = pets
      .map(
        (pet) => `
            <div class="pet-item" data-pet-id="${pet.id}" onclick="appController.selectPet(${pet.id})">
                <div class="pet-info">
                    <div class="pet-name">${pet.name}</div>
                    <div class="pet-details">
                        <span class="pet-species">${pet.species}</span>
                        <span class="pet-owner">${pet.breeder || "Unknown"}</span>
                    </div>
                </div>
                <div class="pet-actions">
                    <button onclick="event.stopPropagation(); appController.deletePet(${pet.id})"
                            class="delete-btn" title="Delete pet">🗑️</button>
                </div>
            </div>
        `,
      )
      .join("");
  }

  /**
   * Select a pet for visualization
   */
  async selectPet(petId) {
    try {
      // Update visual selection
      document.querySelectorAll(".pet-item").forEach((item) => {
        item.classList.remove("selected");
      });
      document
        .querySelector(`[data-pet-id="${petId}"]`)
        .classList.add("selected");

      // Load pet into visualizer
      await this.geneVisualizer.loadPet(petId);
    } catch (error) {
      UIUtils.showError(
        "Failed to load pet for visualization: " + error.message,
      );
    }
  }

  /**
   * Delete a pet
   */
  async deletePet(petId) {
    if (!confirm("Are you sure you want to delete this pet?")) {
      return;
    }

    try {
      await this.apiClient.deletePet(petId);
      this.loadPets(); // Refresh the list
      this.geneVisualizer.clear(); // Clear visualization
      UIUtils.showSuccess("Pet deleted successfully");
    } catch (error) {
      UIUtils.showError("Failed to delete pet: " + error.message);
    }
  }

  /**
   * Load available animal types
   */
  async loadAnimalTypes() {
    try {
      const animalTypes = await this.apiClient.getAnimalTypes();
      UIUtils.populateSelect(
        "animalType",
        animalTypes,
        null,
        null,
        "Select animal type...",
      );
    } catch (error) {
      UIUtils.showError("Failed to load animal types: " + error.message);
    }
  }

  /**
   * Load chromosomes for selected animal
   */
  async loadChromosomes(animalType) {
    try {
      const chromosomes = await this.apiClient.getChromosomes(animalType);
      UIUtils.populateSelect(
        "chromosome",
        chromosomes.map((chr) => ({
          value: chr,
          text: `Chromosome ${chr}`,
        })),
        "value",
        "text",
        "Select chromosome...",
      );

      UIUtils.updateButtonStates(animalType, null);
    } catch (error) {
      UIUtils.showError("Failed to load chromosomes: " + error.message);
    }
  }

  /**
   * Load genes for selected chromosome
   */
  async loadGenes(animalType, chromosome) {
    try {
      UIUtils.showLoading("Loading genes...");
      const genes = await this.apiClient.getGenes(animalType, chromosome);
      this.geneManager.displayGenes(genes, animalType);
    } catch (error) {
      UIUtils.showError("Failed to load genes: " + error.message);
    }
  }

  /**
   * Setup pet upload functionality
   */
  setupPetUpload() {
    const dropZone = document.getElementById("dropZone");
    const fileInput = document.getElementById("fileInput");

    // Click to browse
    dropZone.addEventListener("click", () => {
      fileInput.click();
    });

    // File selection
    fileInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        this.handlePetUpload(e.target.files[0]);
      }
    });

    // Drag and drop
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("dragover");
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");

      if (e.dataTransfer.files.length > 0) {
        this.handlePetUpload(e.dataTransfer.files[0]);
      }
    });
  }

  /**
   * Handle pet file upload
   */
  async handlePetUpload(file) {
    try {
      UIUtils.showLoading("Uploading pet...");

      const formData = new FormData();
      formData.append("file", file);

      const petName = document.getElementById("petName").value;
      if (petName) {
        formData.append("name", petName);
      }

      const response = await fetch("/api/pets/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Upload failed");
      }

      const result = await response.json();
      UIUtils.showSuccess(`Pet "${result.name}" uploaded successfully!`);

      // Clear the input
      document.getElementById("petName").value = "";
      document.getElementById("fileInput").value = "";

      // Refresh pets list
      this.loadPets();
    } catch (error) {
      UIUtils.showError("Failed to upload pet: " + error.message);
    }
  }
}

// Initialize the application when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  const app = new AppController();
  app.initialize();
});
