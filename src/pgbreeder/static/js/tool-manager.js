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
        console.log('Current edit form element:', document.getElementById('petEditForm'));
        this.currentSelectedPetId = petId;

        // Highlight selected pet
        document.querySelectorAll('.pet-item').forEach(item => {
            item.classList.remove('selected');
        });

        const selectedItem = document.querySelector(`[data-pet-id="${petId}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }

        // Load pet details and show edit form
        this.loadPetForEdit(petId);
    }

    async loadPetForEdit(petId) {
        try {
            const response = await fetch(`/api/pets/${petId}`);
            if (!response.ok) {
                throw new Error('Failed to fetch pet details');
            }

            const pet = await response.json();
            this.showEditForm(pet);
        } catch (error) {
            console.error('Error loading pet for edit:', error);
            this.showMessage('Error loading pet details', 'error');
        }
    }

    showEditForm(pet) {
        console.log('showEditForm called with pet:', pet);

        // Show the edit form in main content area
        const genesContent = document.getElementById('genesContent');
        if (!genesContent) {
            console.error('genesContent element not found!');
            return;
        }

        genesContent.innerHTML = `
            <div class="pet-edit-dashboard">
                <h2>Edit Pet: ${pet.name}</h2>
                <div class="pet-edit-form">
                    <div class="form-group">
                        <label for="editPetName">Name</label>
                        <input type="text" id="editPetName" class="form-input" placeholder="Pet name" value="${pet.name || ''}">
                    </div>
                    
                    <div class="attributes-grid">
                        <div class="form-group">
                            <label for="editIntelligence">🧠 Intelligence</label>
                            <input type="number" id="editIntelligence" class="form-input" min="0" max="100" step="0.1" value="${pet.intelligence || ''}">
                        </div>
                        
                        <div class="form-group">
                            <label for="editToughness">💪 Toughness</label>
                            <input type="number" id="editToughness" class="form-input" min="0" max="100" step="0.1" value="${pet.toughness || ''}">
                        </div>
                        
                        <div class="form-group">
                            <label for="editFriendliness">😊 Friendliness</label>
                            <input type="number" id="editFriendliness" class="form-input" min="0" max="100" step="0.1" value="${pet.friendliness || ''}">
                        </div>
                        
                        <div class="form-group">
                            <label for="editRuggedness">🏔️ Ruggedness</label>
                            <input type="number" id="editRuggedness" class="form-input" min="0" max="100" step="0.1" value="${pet.ruggedness || ''}">
                        </div>
                        
                        <div class="form-group">
                            <label for="editFerocity">🔥 Ferocity</label>
                            <input type="number" id="editFerocity" class="form-input" min="0" max="100" step="0.1" value="${pet.ferocity || ''}">
                        </div>
                        
                        <div class="form-group">
                            <label for="editEnthusiasm">✨ Enthusiasm</label>
                            <input type="number" id="editEnthusiasm" class="form-input" min="0" max="100" step="0.1" value="${pet.enthusiasm || ''}">
                        </div>
                        
                        <div class="form-group">
                            <label for="editVirility">💜 Virility</label>
                            <input type="number" id="editVirility" class="form-input" min="0" max="100" step="0.1" value="${pet.virility || ''}">
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label for="editNotes">Notes</label>
                        <textarea id="editNotes" class="form-input" rows="3" placeholder="Optional notes">${pet.notes || ''}</textarea>
                    </div>
                    
                    <div class="form-actions">
                        <button type="button" id="savePetBtn" class="btn btn-primary">Save Changes</button>
                        <button type="button" id="cancelEditBtn" class="btn btn-secondary">Cancel</button>
                    </div>
                </div>
            </div>
        `;

        console.log('Edit form should now be visible in main content');

        // Add event listeners for form actions
        this.setupEditFormEventListeners();
    } setupEditFormEventListeners() {
        // Remove existing listeners to avoid duplicates
        const savePetBtn = document.getElementById('savePetBtn');
        const cancelEditBtn = document.getElementById('cancelEditBtn');

        savePetBtn.replaceWith(savePetBtn.cloneNode(true));
        cancelEditBtn.replaceWith(cancelEditBtn.cloneNode(true));

        // Add new event listeners
        document.getElementById('savePetBtn').addEventListener('click', () => {
            this.savePetChanges();
        });

        document.getElementById('cancelEditBtn').addEventListener('click', () => {
            this.hideEditForm();
        });
    }

    async savePetChanges() {
        if (!this.currentSelectedPetId) {
            this.showMessage('No pet selected', 'error');
            return;
        }

        const petUpdate = {
            name: document.getElementById('editPetName').value.trim() || null,
            intelligence: parseFloat(document.getElementById('editIntelligence').value) || null,
            toughness: parseFloat(document.getElementById('editToughness').value) || null,
            friendliness: parseFloat(document.getElementById('editFriendliness').value) || null,
            ruggedness: parseFloat(document.getElementById('editRuggedness').value) || null,
            ferocity: parseFloat(document.getElementById('editFerocity').value) || null,
            enthusiasm: parseFloat(document.getElementById('editEnthusiasm').value) || null,
            virility: parseFloat(document.getElementById('editVirility').value) || null,
            notes: document.getElementById('editNotes').value.trim() || null
        };

        try {
            const response = await fetch(`/api/pets/${this.currentSelectedPetId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(petUpdate)
            });

            if (!response.ok) {
                throw new Error('Failed to update pet');
            }

            const result = await response.json();
            this.showMessage('Pet updated successfully!', 'success');
            this.hideEditForm();
            this.refreshPetsList();
        } catch (error) {
            console.error('Error updating pet:', error);
            this.showMessage('Error updating pet', 'error');
        }
    }

    hideEditForm() {
        this.currentSelectedPetId = null;

        // Remove selection highlight
        document.querySelectorAll('.pet-item').forEach(item => {
            item.classList.remove('selected');
        });

        // Return to pet management dashboard
        this.updateMainContent();
    }

    refreshPetsList() {
        this.loadPetsList();
        if (this.activeTab === 'pet-management') {
            this.loadPetsStats();
        }
    }

    showMessage(message, type) {
        if (type === 'success') {
            // Create success message element
            const successEl = document.createElement('div');
            successEl.className = 'success-message';
            successEl.textContent = message;
            successEl.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #10b981;
                color: white;
                padding: 12px 24px;
                border-radius: 6px;
                z-index: 1000;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            `;
            document.body.appendChild(successEl);
            setTimeout(() => successEl.remove(), 3000);
        } else if (type === 'error') {
            // Create error message element
            const errorEl = document.createElement('div');
            errorEl.className = 'error-message';
            errorEl.textContent = message;
            errorEl.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #ef4444;
                color: white;
                padding: 12px 24px;
                border-radius: 6px;
                z-index: 1000;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            `;
            document.body.appendChild(errorEl);
            setTimeout(() => errorEl.remove(), 5000);
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.toolManager = new ToolManager();
});
