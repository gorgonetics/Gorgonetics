<script>
    import { pets, appState } from "../stores/appState.js";
    import { FALLBACK_ATTRIBUTE_LIST } from "../utils/apiUtils.js";

    /**
     * @typedef {Object} Props
     * @property {any} pet - The pet to edit
     * @property {Function} onClose - Callback when editor is closed
     * @property {Function} onSave - Callback when pet is saved
     */

    /** @type {Props} */
    const { pet, onClose, onSave } = $props();

    // Breed options by species - easy to modify later
    const BREED_OPTIONS = {
        'BeeWasp': ['Bee', 'Wasp'],
        'Horse': ['Standardbred', 'Kurbone', 'Ilmarian', 'Plateau Pony', 'Satincoat', 'Statehelm', 'Blanketed', 'Leopard', 'Paint', 'Calico'],
        'default': ['Mixed']
    };

    const getBreedOptions = (species) => {
        return BREED_OPTIONS[species] || BREED_OPTIONS.default;
    };

    const breedOptions = getBreedOptions(pet.species);

    // Create editable copies of pet data
    let editName = $state(pet.name || "");
    let editGender = $state(pet.gender || "Male");
    // Initialize breed with valid option for this species
    let editBreed = $state(breedOptions.includes(pet.breed) ? pet.breed : breedOptions[0]);
    // Initialize attributes from direct pet properties  
    let editAttributes = $state({});
    // Populate edit attributes from pet's direct properties
    for (const attr of FALLBACK_ATTRIBUTE_LIST) {
        const attrKey = attr.key.toLowerCase();
        editAttributes[attrKey] = pet[attrKey] ?? 50;
    }

    // Get species-specific attributes
    const getAvailableAttributes = (species) => {
        const coreAttributes = ['intelligence', 'toughness', 'friendliness', 'ruggedness', 'enthusiasm', 'virility'];
        
        if (species === 'BeeWasp') {
            return [...coreAttributes, 'ferocity'];
        } else if (species === 'Horse') {
            return [...coreAttributes, 'temperament'];
        } else {
            return coreAttributes;
        }
    };

    const availableAttributes = getAvailableAttributes(pet.species);
    const filteredAttributeList = FALLBACK_ATTRIBUTE_LIST.filter(attr => 
        availableAttributes.includes(attr.key.toLowerCase())
    );

    async function handleSave() {
        try {
            const updateData = {};
            
            // Check what changed
            if (editName.trim() !== pet.name) {
                updateData.name = editName.trim();
            }
            if (editGender !== pet.gender) {
                updateData.gender = editGender;
            }
            if (editBreed.trim() !== (pet.breed || "Mixed")) {
                updateData.breed = editBreed.trim();
            }
            
            // Check if any attributes changed
            const attributeChanges = {};
            for (const [key, value] of Object.entries(editAttributes)) {
                // Compare against direct pet properties (not nested attributes)
                if (pet[key] !== value) {
                    attributeChanges[key] = value;
                }
            }
            if (Object.keys(attributeChanges).length > 0) {
                updateData.attributes = attributeChanges;
            }
            
            // Only update if there are changes
            if (Object.keys(updateData).length > 0) {
                await appState.updatePet(pet.id, updateData);
                await appState.loadPets();
                onSave?.(pet.id);
            }
            
            onClose?.();
        } catch (err) {
            console.error("Failed to update pet:", err);
        }
    }

    function handleCancel() {
        onClose?.();
    }

    function updateAttribute(attrKey, value) {
        editAttributes[attrKey] = parseInt(value, 10) || 0;
    }
</script>

<div class="pet-editor-overlay" onclick={handleCancel}>
    <div class="pet-editor-modal" onclick={(e) => e.stopPropagation()}>
        <div class="pet-editor-header">
            <h2>Edit Pet</h2>
            <button class="close-btn" onclick={handleCancel} title="Close">×</button>
        </div>
        
        <div class="pet-editor-content">
            <div class="form-section">
                <h3>Basic Information</h3>
                <!-- Pet Name - Full Width -->
                <div class="form-group single-column">
                    <label for="petName">Pet Name</label>
                    <input 
                        type="text" 
                        id="petName"
                        bind:value={editName} 
                        placeholder="Enter pet name"
                        class="form-input"
                    />
                </div>
                
                <!-- Other Basic Info - Two Columns -->
                <div class="basic-info-grid">
                    <div class="form-group">
                        <label for="petSpecies">Species</label>
                        <input 
                            type="text" 
                            id="petSpecies"
                            value={pet.species || "Unknown"}
                            class="form-input"
                            disabled
                            title="Species cannot be edited (loaded from genome)"
                        />
                    </div>
                    
                    <div class="form-group">
                        <label for="petBreeder">Breeder</label>
                        <input 
                            type="text" 
                            id="petBreeder"
                            value={pet.breeder || "Unknown"}
                            class="form-input"
                            disabled
                            title="Breeder cannot be edited (loaded from genome)"
                        />
                    </div>
                    
                    <div class="form-group">
                        <label for="petGender">Gender</label>
                        <select 
                            id="petGender"
                            bind:value={editGender}
                            class="form-select"
                        >
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="petBreed">Breed</label>
                        <select 
                            id="petBreed"
                            bind:value={editBreed}
                            class="form-select"
                        >
                            {#each breedOptions as breedOption}
                                <option value={breedOption}>{breedOption}</option>
                            {/each}
                        </select>
                    </div>
                </div>
            </div>
            
            <div class="form-section">
                <h3>Attributes ({pet.species})</h3>
                <div class="attributes-grid">
                    {#each filteredAttributeList as attr}
                        <div class="attribute-group">
                            <label for="attr-{attr.key}">{attr.name}</label>
                            <input 
                                type="number" 
                                id="attr-{attr.key}"
                                min="0" 
                                max="100" 
                                value={editAttributes[attr.key.toLowerCase()] ?? 50}
                                oninput={(e) => updateAttribute(attr.key.toLowerCase(), e.target.value)}
                                class="form-input attribute-input"
                            />
                        </div>
                    {/each}
                </div>
            </div>
        </div>
        
        <div class="pet-editor-footer">
            <button class="btn btn-secondary" onclick={handleCancel}>Cancel</button>
            <button class="btn btn-primary" onclick={handleSave}>Save Changes</button>
        </div>
    </div>
</div>

<style>
    .pet-editor-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        backdrop-filter: blur(4px);
    }

    .pet-editor-modal {
        background: white;
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        width: 90%;
        max-width: 600px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .pet-editor-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1.5rem;
        border-bottom: 1px solid #e5e7eb;
        background: #f8fafc;
    }

    .pet-editor-header h2 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #111827;
    }

    .close-btn {
        width: 2rem;
        height: 2rem;
        border: none;
        background: none;
        font-size: 1.5rem;
        color: #6b7280;
        cursor: pointer;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
    }

    .close-btn:hover {
        background: #e5e7eb;
        color: #374151;
    }

    .pet-editor-content {
        flex: 1;
        padding: 1.5rem;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .form-section {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .form-section h3 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 600;
        color: #111827;
        border-bottom: 2px solid #e5e7eb;
        padding-bottom: 0.5rem;
    }

    .basic-info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.75rem;
    }

    .form-group {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0;
    }

    .form-group label {
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
        min-width: 80px;
        flex-shrink: 0;
        text-align: right;
    }

    .form-input,
    .form-select {
        padding: 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 0.875rem;
        background: white;
        transition: border-color 0.2s ease;
        flex: 1;
    }

    .form-input:focus,
    .form-select:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .form-input:disabled {
        background-color: #f3f4f6;
        color: #6b7280;
        cursor: not-allowed;
        border-color: #d1d5db;
    }

    .attributes-grid {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .attribute-group {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 0.5rem;
    }

    .attribute-group label {
        font-size: 0.75rem;
        font-weight: 500;
        color: #6b7280;
        min-width: 80px;
        flex-shrink: 0;
        text-align: right;
    }

    .attribute-input {
        padding: 0.5rem;
        font-size: 0.875rem;
        flex: 1;
    }

    .pet-editor-footer {
        display: flex;
        gap: 0.75rem;
        padding: 1.5rem;
        border-top: 1px solid #e5e7eb;
        background: #f8fafc;
        justify-content: flex-end;
    }

    .btn {
        padding: 0.75rem 1.5rem;
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        border: none;
    }

    .btn-secondary {
        background: #f3f4f6;
        color: #374151;
    }

    .btn-secondary:hover {
        background: #e5e7eb;
    }

    .btn-primary {
        background: #3b82f6;
        color: white;
    }

    .btn-primary:hover {
        background: #2563eb;
    }

    /* Responsive adjustments */
    @media (max-width: 640px) {
        .pet-editor-modal {
            width: 95%;
            margin: 1rem;
        }
        
        .basic-info-grid {
            grid-template-columns: 1fr;
        }
        
        .form-group {
            flex-direction: column;
            align-items: stretch;
            gap: 0.5rem;
        }
        
        .form-group label {
            text-align: left;
            min-width: auto;
        }
        
        .attribute-group {
            flex-direction: column;
            align-items: stretch;
            gap: 0.25rem;
        }
        
        .attribute-group label {
            text-align: left;
            min-width: auto;
        }
        
        .pet-editor-footer {
            flex-direction: column;
        }
        
        .btn {
            width: 100%;
        }
    }
</style>