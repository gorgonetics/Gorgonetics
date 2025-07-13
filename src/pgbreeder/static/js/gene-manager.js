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
            console.error('Failed to load effect options:', error);
            this.effectOptions = ['None']; // Fallback
        }
    }

    /**
     * Display genes in the UI
     */
    displayGenes(genes, animalType) {
        const container = document.getElementById('genesContent');

        if (genes.length === 0) {
            container.innerHTML = '<div class="loading">No genes found for this chromosome</div>';
            return;
        }

        // Group genes by letter prefix (e.g., 01A1, 01A2, 01A3, 01A4 -> group "01A")
        const geneGroups = {};
        genes.forEach(gene => {
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

        const grid = document.createElement('div');
        grid.className = 'genes-grid';

        // Create blocks for each gene group
        Object.keys(geneGroups).sort().forEach(prefix => {
            const block = document.createElement('div');
            block.className = 'gene-block';

            const header = document.createElement('div');
            header.className = 'gene-block-header';
            header.onclick = () => this.toggleGeneBlock(block);

            const headerText = document.createElement('span');
            headerText.textContent = `Gene Block ${prefix}`;

            const foldIcon = document.createElement('span');
            foldIcon.className = 'fold-icon';
            foldIcon.textContent = '▼';

            header.appendChild(headerText);
            header.appendChild(foldIcon);

            const row = document.createElement('div');
            row.className = 'gene-row';

            // Sort genes within the group (01A1, 01A2, 01A3, 01A4)
            geneGroups[prefix].sort((a, b) => a.gene.localeCompare(b.gene)).forEach(gene => {
                const card = this.createGeneCard(gene, animalType);
                row.appendChild(card);
            });

            block.appendChild(header);
            block.appendChild(row);
            grid.appendChild(block);
        });

        container.innerHTML = '';
        container.appendChild(grid);
    }

    /**
     * Create a gene card element
     */
    createGeneCard(gene, animalType) {
        const card = document.createElement('div');
        card.className = 'gene-card';

        // Extract just the number from the gene name (e.g., "01A1" -> "1")
        const geneNumber = gene.gene.slice(-1);

        card.innerHTML = `
            <div class="gene-number">${geneNumber}</div>
            
            <div class="gene-field horizontal">
                <label>Dom</label>
                <select data-field="effectDominant" data-gene="${gene.gene}" data-animal="${animalType}" data-original="${gene.effectDominant || ''}">
                    ${this.effectOptions.map(effect =>
            `<option value="${effect}" ${effect === gene.effectDominant ? 'selected' : ''}>${effect}</option>`
        ).join('')}
                </select>
            </div>
            
            <div class="gene-field horizontal">
                <label>Rec</label>
                <select data-field="effectRecessive" data-gene="${gene.gene}" data-animal="${animalType}" data-original="${gene.effectRecessive || ''}">
                    ${this.effectOptions.map(effect =>
            `<option value="${effect}" ${effect === gene.effectRecessive ? 'selected' : ''}>${effect}</option>`
        ).join('')}
                </select>
            </div>
            
            <div class="gene-field">
                <label>Appearance</label>
                <input type="text" data-field="appearance" data-gene="${gene.gene}" data-animal="${animalType}" 
                       value="${gene.appearance}" placeholder="Appearance" data-original="${gene.appearance || ''}">
            </div>
            
            <div class="notes-section">
                <button type="button" class="notes-toggle" onclick="window.geneManager.toggleNotes(this)">
                    + Notes
                </button>
                <div class="notes-content">
                    <input type="text" data-field="notes" data-gene="${gene.gene}" data-animal="${animalType}" 
                           value="${gene.notes}" placeholder="Notes" data-original="${gene.notes || ''}">
                </div>
            </div>
            
            <button class="save-btn" onclick="window.geneManager.saveGene('${gene.gene}', '${animalType}')" disabled>
                Save
            </button>
        `;

        // Add change listeners to all form elements
        const formElements = card.querySelectorAll('[data-field]');
        formElements.forEach(element => {
            element.addEventListener('change', () => this.checkForChanges(card));
            element.addEventListener('input', () => this.checkForChanges(card));
        });

        // Ensure Notes section starts collapsed
        const notesToggle = card.querySelector('.notes-toggle');
        const notesContent = card.querySelector('.notes-content');
        if (notesToggle && notesContent) {
            notesToggle.textContent = '+ Notes';
            notesContent.classList.remove('expanded');
        }

        return card;
    }

    /**
     * Check if any fields in the gene card have been changed
     */
    checkForChanges(card) {
        const saveBtn = card.querySelector('.save-btn');
        const formElements = card.querySelectorAll('[data-field]');
        let hasChanges = false;

        formElements.forEach(element => {
            const originalValue = element.getAttribute('data-original') || '';
            const currentValue = element.value || '';

            if (originalValue !== currentValue) {
                hasChanges = true;
            }
        });

        // Enable/disable save button and update visual state
        saveBtn.disabled = !hasChanges;
        if (hasChanges) {
            card.classList.add('has-changes');
        } else {
            card.classList.remove('has-changes');
        }
    }

    /**
     * Save gene changes
     */
    async saveGene(geneId, animalType) {
        try {
            const card = document.querySelector(`[data-gene="${geneId}"][data-animal="${animalType}"]`).closest('.gene-card');
            const fields = card.querySelectorAll('[data-field]');

            const updateData = {
                animal_type: animalType,
                gene: geneId
            };

            fields.forEach(field => {
                const fieldName = field.dataset.field;
                // Convert camelCase to snake_case for API compatibility
                const apiFieldName = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase();
                updateData[apiFieldName] = field.value;
            });

            await this.apiClient.updateGene(updateData);
            UIUtils.showSuccess(`Gene ${geneId} updated successfully!`);

            // Reset change tracking after successful save
            fields.forEach(field => {
                field.setAttribute('data-original', field.value || '');
            });

            // Disable save button and remove change indicator
            const saveBtn = card.querySelector('.save-btn');
            saveBtn.disabled = true;
            card.classList.remove('has-changes');

        } catch (error) {
            UIUtils.showError('Failed to save gene: ' + error.message);
        }
    }

    /**
     * Toggle gene block visibility
     */
    toggleGeneBlock(block) {
        block.classList.toggle('collapsed');
    }

    /**
     * Toggle notes section visibility
     */
    toggleNotes(button) {
        const notesContent = button.nextElementSibling;
        const isExpanded = notesContent.classList.contains('expanded');

        if (isExpanded) {
            notesContent.classList.remove('expanded');
            button.textContent = '+ Notes';
        } else {
            notesContent.classList.add('expanded');
            button.textContent = '📝 Notes';
            // Focus the input when expanded
            const input = notesContent.querySelector('input');
            if (input) {
                setTimeout(() => input.focus(), 100);
            }
        }
    }
}

// Export for use in other modules
window.GeneManager = GeneManager;
