/**
 * Main Application Controller for PGBreeder web application.
 * Coordinates all modules and handles the application lifecycle.
 */

class AppController {
    constructor() {
        this.apiClient = new ApiClient();
        this.geneManager = new GeneManager(this.apiClient);
        this.exportManager = new ExportManager(this.apiClient);

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
            this.setupEventListeners();
        } catch (error) {
            UIUtils.showError('Failed to initialize application: ' + error.message);
        }
    }

    /**
     * Load available animal types
     */
    async loadAnimalTypes() {
        try {
            const animalTypes = await this.apiClient.getAnimalTypes();
            UIUtils.populateSelect('animalType', animalTypes, null, null, 'Select animal type...');
        } catch (error) {
            UIUtils.showError('Failed to load animal types: ' + error.message);
        }
    }

    /**
     * Load chromosomes for selected animal
     */
    async loadChromosomes(animalType) {
        try {
            const chromosomes = await this.apiClient.getChromosomes(animalType);
            UIUtils.populateSelect('chromosome', chromosomes.map(chr => ({
                value: chr,
                text: `Chromosome ${chr}`
            })), 'value', 'text', 'Select chromosome...');

            UIUtils.updateButtonStates(animalType, null);
        } catch (error) {
            UIUtils.showError('Failed to load chromosomes: ' + error.message);
        }
    }

    /**
     * Load genes for selected chromosome
     */
    async loadGenes(animalType, chromosome) {
        try {
            UIUtils.showLoading('Loading genes...');
            const genes = await this.apiClient.getGenes(animalType, chromosome);
            this.geneManager.displayGenes(genes, animalType);
        } catch (error) {
            UIUtils.showError('Failed to load genes: ' + error.message);
        }
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        // Animal type selection
        document.getElementById('animalType').addEventListener('change', (e) => {
            const animalType = e.target.value;
            if (animalType) {
                this.loadChromosomes(animalType);
                UIUtils.updateButtonStates(animalType, null);
            } else {
                UIUtils.updateButtonStates(null, null);
                UIUtils.populateSelect('chromosome', [], null, null, 'Select chromosome...');
            }
            // Clear gene display when animal type changes
            UIUtils.clearGeneDisplay();
        });

        // Chromosome selection
        document.getElementById('chromosome').addEventListener('change', (e) => {
            const chromosome = e.target.value;
            const animalType = document.getElementById('animalType').value;
            UIUtils.updateButtonStates(animalType, chromosome);
            // Clear gene display when chromosome changes (user needs to click Load Genes)
            UIUtils.clearGeneDisplay();
        });

        // Load genes button
        document.getElementById('loadGenes').addEventListener('click', () => {
            const animalType = document.getElementById('animalType').value;
            const chromosome = document.getElementById('chromosome').value;

            if (animalType && chromosome) {
                this.loadGenes(animalType, chromosome);
            }
        });

        // Export buttons
        document.getElementById('exportChromosome').addEventListener('click', () => {
            this.exportManager.exportChromosome();
        });

        document.getElementById('exportAll').addEventListener('click', () => {
            this.exportManager.exportAllChromosomes();
        });
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new AppController();
    app.initialize();
});
