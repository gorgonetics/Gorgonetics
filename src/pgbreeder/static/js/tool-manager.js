// Simple Tab Manager
class ToolManager {
    constructor() {
        this.activeTab = null;
        this.init();
    }

    init() {
        // Initialize tabs
        this.tabs = document.querySelectorAll('.tab');
        this.panels = document.querySelectorAll('.tab-panel');

        // Add click listeners
        this.tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabId = e.target.dataset.tab;
                this.showTab(tabId);
            });
        });

        // Show gene-editing tab by default
        this.showTab('gene-editing');
        this.loadPetsList();
    }

    showTab(tabId) {
        // Update tab states
        this.tabs.forEach(tab => {
            const isActive = tab.dataset.tab === tabId;
            tab.setAttribute('aria-selected', isActive);
        });

        // Update panel visibility
        this.panels.forEach(panel => {
            if (panel.id === tabId) {
                panel.style.display = 'block';
            } else {
                panel.style.display = 'none';
            }
        });

        this.activeTab = tabId;
        this.updateMainContent();

        // Reinitialize pet upload if needed
        if (tabId === 'pet-management' && window.petUploadManager) {
            window.petUploadManager.setupEventListeners();
        }
    }

    showWelcomeMessage() {
        const genesContent = document.getElementById('genesContent');
        genesContent.innerHTML = `
            <div class="welcome-message">
                <div class="welcome-icon">🧬</div>
                <h2>Welcome to PGBreeder</h2>
                <p>Your genetic analysis platform for breeding optimization</p>
                <div class="welcome-tools">
                    <div class="welcome-tool">
                        <span class="welcome-tool-icon">🧬</span>
                        <div class="welcome-tool-content">
                            <strong>Gene Editor</strong>
                            <span>Analyze and edit genetic data from chromosome files</span>
                        </div>
                    </div>
                    <div class="welcome-tool">
                        <span class="welcome-tool-icon">🐾</span>
                        <div class="welcome-tool-content">
                            <strong>Pet Manager</strong>
                            <span>Upload genome files and manage your pet collection</span>
                        </div>
                    </div>
                </div>
                <p class="welcome-hint">Select a tool from the navigation tabs above to get started</p>
            </div>
        `;
    }

    updateMainContent() {
        const genesContent = document.getElementById('genesContent');
        const legend = document.getElementById('effectLegend');

        if (this.activeTab === 'pet-management') {
            // Hide the effect legend for Pet Manager
            if (legend) {
                legend.style.display = 'none';
            }
            
            genesContent.innerHTML = `
                <div class="pets-dashboard">
                    <h2>Pet Collection Dashboard</h2>
                    <p>Manage your pet collection here. Upload new pets using the sidebar or select a pet to view details.</p>
                    <div class="pets-stats" id="petsStats">
                        <div class="loading">Loading statistics...</div>
                    </div>
                </div>
            `;
            this.loadPetsStats();
        } else if (this.activeTab === 'gene-editing') {
            // Only clear content if there are no genes currently displayed
            if (!genesContent.querySelector('.genes-grid')) {
                // Hide legend when no genes are loaded
                if (legend) {
                    legend.style.display = 'none';
                }
                
                genesContent.innerHTML = `
                    <div class="gene-editing-dashboard">
                        <h2>Gene Editing Tool</h2>
                        <p>Select an animal type and chromosome from the sidebar to begin editing genes.</p>
                        <div class="loading">
                            Ready to load genetic data...
                        </div>
                    </div>
                `;
            }
            // If genes are already displayed, the legend visibility is managed by GeneManager
        }
    } async loadPetsList() {
        const petsList = document.getElementById('petsList');
        if (!petsList) return;

        try {
            const response = await fetch('/api/pets');
            if (!response.ok) throw new Error('Failed to load pets');

            const pets = await response.json();
            this.renderPetsList(pets);
        } catch (error) {
            console.error('Error loading pets:', error);
            petsList.innerHTML = '<div class="error">Failed to load pets</div>';
        }
    }

    renderPetsList(pets) {
        const petsList = document.getElementById('petsList');
        if (!petsList) return;

        if (pets.length === 0) {
            petsList.innerHTML = '<div class="empty-state">No pets in collection</div>';
            return;
        }

        const petsHtml = pets.map(pet => `
            <div class="pet-item" data-pet-id="${pet.id}">
                <div class="pet-name">${pet.name}</div>
                <div class="pet-info">
                    <span class="pet-species">${pet.species}</span> • 
                    ${pet.total_genes || 0} genes
                </div>
            </div>
        `).join('');

        petsList.innerHTML = petsHtml;

        // Add click handlers for pet items
        petsList.querySelectorAll('.pet-item').forEach(item => {
            item.addEventListener('click', () => this.selectPet(item.dataset.petId));
        });
    }

    async loadPetsStats() {
        try {
            const response = await fetch('/api/pets');
            if (!response.ok) throw new Error('Failed to load pets');

            const pets = await response.json();
            const statsHtml = this.renderPetsStats(pets);
            const statsElement = document.getElementById('petsStats');
            if (statsElement) {
                statsElement.innerHTML = statsHtml;
            }
        } catch (error) {
            console.error('Error loading pets stats:', error);
            const statsElement = document.getElementById('petsStats');
            if (statsElement) {
                statsElement.innerHTML = '<div class="error">Failed to load statistics</div>';
            }
        }
    }

    renderPetsStats(pets) {
        const species = {};
        pets.forEach(pet => {
            species[pet.species] = (species[pet.species] || 0) + 1;
        });

        const speciesStats = Object.entries(species)
            .map(([name, count]) => `<div class="stat-item"><strong>${count}</strong> ${name}</div>`)
            .join('');

        return `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-number">${pets.length}</div>
                    <div class="stat-label">Total Pets</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${Object.keys(species).length}</div>
                    <div class="stat-label">Species</div>
                </div>
            </div>
            <div class="species-breakdown">
                <h4>Species Breakdown:</h4>
                ${speciesStats || '<div>No pets yet</div>'}
            </div>
        `;
    }

    selectPet(petId) {
        console.log('Selected pet:', petId);
    }

    refreshPetsList() {
        this.loadPetsList();
        if (this.activeTab === 'pet-management') {
            this.loadPetsStats();
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.toolManager = new ToolManager();
});
