# Frontend Documentation

## Overview

The Gorgonetics frontend is built with vanilla JavaScript using modern ES6+ features. The code is organized into modular files, each handling specific functionality. This architecture promotes reusability, maintainability, and testability.

## Architecture

### Module Structure

```
src/gorgonetics/static/js/
├── api-client.js        # API communication layer
├── ui-utils.js          # UI utilities and feedback
├── gene-manager.js      # Gene display and editing
├── gene-visualizer.js   # Pet genome visualization
├── export-manager.js    # Export functionality
└── app-controller.js    # Main application coordinator
```

### Module Dependencies

```
app-controller.js
├── api-client.js
├── ui-utils.js
├── gene-manager.js
├── gene-visualizer.js
└── export-manager.js
```

## Module Documentation

### ApiClient (`api-client.js`)

**Purpose**: Centralized API communication layer that handles all HTTP requests to the backend.

#### Class Structure

```javascript
class ApiClient {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl;
    }
}
```

#### Methods

##### `async getAnimalTypes()`
Fetches available animal types from the API.

**Returns**: `Promise<string[]>` - Array of animal type identifiers

**Example**:
```javascript
const apiClient = new ApiClient();
const animalTypes = await apiClient.getAnimalTypes();
// Returns: ['beewasp', 'horse']
```

##### `async getChromosomes(animalType)`
Fetches available chromosomes for a specific animal type.

**Parameters**:
- `animalType` (string): Animal type identifier

**Returns**: `Promise<string[]>` - Array of chromosome identifiers

**Example**:
```javascript
const chromosomes = await apiClient.getChromosomes('beewasp');
// Returns: ['chr01', 'chr02', ...]
```

##### `async getGenes(animalType, chromosome)`
Fetches all genes for a specific chromosome.

**Parameters**:
- `animalType` (string): Animal type identifier
- `chromosome` (string): Chromosome identifier

**Returns**: `Promise<Object[]>` - Array of gene objects

**Example**:
```javascript
const genes = await apiClient.getGenes('beewasp', 'chr01');
// Returns: [{ gene: '01A1', effect_dominant: 'Intelligence+', ... }]
```

##### `async getEffectOptions()`
Fetches available effect options for gene editing.

**Returns**: `Promise<string[]>` - Array of effect option strings

##### `async getPets()`
Fetches all uploaded pets.

**Returns**: `Promise<Object[]>` - Array of pet objects

##### `async getPet(petId)`
Fetches a specific pet by ID.

**Parameters**:
- `petId` (number): Pet ID

**Returns**: `Promise<Object>` - Pet data object

##### `async deletePet(petId)`
Deletes a pet.

**Parameters**:
- `petId` (number): Pet ID

**Returns**: `Promise<Object>` - API response

##### `async getPetGenome(petId)`
Fetches pet genome data for visualization.

**Parameters**:
- `petId` (number): Pet ID

**Returns**: `Promise<Object>` - Pet genome data

##### `async updateGene(updateData)`
Updates a gene with new data.

**Parameters**:
- `updateData` (Object): Gene update data
  - `animal_type` (string): Animal type
  - `gene` (string): Gene identifier
  - `effect_dominant` (string): Dominant effect
  - `effect_recessive` (string): Recessive effect
  - `appearance` (string): Appearance description
  - `notes` (string): Additional notes

**Returns**: `Promise<Object>` - API response

##### `async exportChromosome(animalType, chromosome)`
Exports chromosome data as JSON.

**Parameters**:
- `animalType` (string): Animal type identifier
- `chromosome` (string): Chromosome identifier

**Returns**: `Promise<Object>` - Export data

##### `async exportAllChromosomes(animalType)`
Exports all chromosome data for an animal type.

**Parameters**:
- `animalType` (string): Animal type identifier

**Returns**: `Promise<Object>` - Export data

---

### UIUtils (`ui-utils.js`)

**Purpose**: Provides common UI utilities, user feedback, and state management functions.

#### Methods

##### `showSuccess(message)`
Displays a success message to the user.

**Parameters**:
- `message` (string): Success message to display

**Example**:
```javascript
UIUtils.showSuccess('Gene saved successfully!');
```

##### `showError(message)`
Displays an error message to the user.

**Parameters**:
- `message` (string): Error message to display

##### `showLoading(message)`
Displays a loading state with optional message.

**Parameters**:
- `message` (string, optional): Loading message

##### `hideMessage()`
Hides the current message display.

##### `updateButtonStates(animalType, chromosome)`
Updates the enabled/disabled state of export buttons.

**Parameters**:
- `animalType` (string): Current animal type
- `chromosome` (string): Current chromosome

##### `setLoadGenesButtonState(enabled)`
Controls the state of the "Load Genes" button.

**Parameters**:
- `enabled` (boolean): Whether button should be enabled

##### `clearGeneDisplay()`
Clears the gene display area.

#### UI Feedback System

The UIUtils module implements a consistent feedback system:

```javascript
// Success messages (green)
UIUtils.showSuccess('Operation completed successfully');

// Error messages (red)
UIUtils.showError('Something went wrong');

// Loading states (blue)
UIUtils.showLoading('Processing...');

// Auto-hide after 3 seconds
setTimeout(() => UIUtils.hideMessage(), 3000);
```

---

### GeneManager (`gene-manager.js`)

**Purpose**: Handles gene display, editing, and saving operations. This is the core module for gene manipulation.

#### Class Structure

```javascript
class GeneManager {
    constructor(apiClient, uiUtils) {
        this.apiClient = apiClient;
        this.uiUtils = uiUtils;
        this.effectOptions = [];
    }
}
```

#### Methods

##### `async initialize()`
Initializes the gene manager by loading effect options.

**Example**:
```javascript
const geneManager = new GeneManager(apiClient, uiUtils);
await geneManager.initialize();
```

##### `async displayGenes(genes, animalType)`
Renders gene cards for display and editing.

**Parameters**:
- `genes` (Array): Array of gene objects
- `animalType` (string): Animal type identifier

##### `createGeneCard(gene, animalType)`
Creates an individual gene card HTML element.

**Parameters**:
- `gene` (Object): Gene data object
- `animalType` (string): Animal type identifier

**Returns**: `HTMLElement` - Gene card element

##### `async saveGene(geneId, animalType)`
Saves changes to a specific gene.

**Parameters**:
- `geneId` (string): Gene identifier
- `animalType` (string): Animal type identifier

##### `checkForChanges(card)`
Checks if a gene card has unsaved changes and updates save button state.

**Parameters**:
- `card` (HTMLElement): Gene card element

#### Gene Card Structure

Each gene card contains:
- Gene identifier (header)
- Dominant effect dropdown
- Recessive effect dropdown
- Appearance text area
- Notes text area
- Save button (enabled only when changes detected)

#### Change Detection

The module implements intelligent change detection:

```javascript
// Monitor input changes
element.addEventListener('input', () => {
    this.checkForChanges(card);
});

// Compare current values with original data
const hasChanges = (
    dominantSelect.value !== gene.effect_dominant ||
    recessiveSelect.value !== gene.effect_recessive ||
    appearanceTextarea.value !== (gene.appearance || '') ||
    notesTextarea.value !== (gene.notes || '')
);
```

---

### ExportManager (`export-manager.js`)

**Purpose**: Manages data export functionality including single chromosome and bulk exports.

#### Class Structure

```javascript
class ExportManager {
    constructor(apiClient, uiUtils) {
        this.apiClient = apiClient;
        this.uiUtils = uiUtils;
    }
}
```

#### Methods

##### `async exportChromosome()`
Exports the currently selected chromosome.

**Process**:
1. Gets current animal type and chromosome from UI
2. Calls API to export chromosome data
3. Triggers file download

##### `async exportAllChromosomes()`
Exports all chromosomes for the current animal type.

**Process**:
1. Gets current animal type from UI
2. Calls API to export all chromosome data
3. Triggers file download

##### `downloadJSON(data, filename)`
Triggers a JSON file download.

**Parameters**:
- `data` (Object): Data to export
- `filename` (string): Filename for download

#### Export File Format

Exported files follow this structure:

```javascript
// Single chromosome export
{
    "animal_type": "beewasp",
    "chromosome": "chr01",
    "export_date": "2025-01-01T00:00:00Z",
    "genes": [
        {
            "gene": "01A1",
            "effect_dominant": "Intelligence+",
            "effect_recessive": "Intelligence-",
            "appearance": "Brighter glow",
            "notes": "Common trait"
        }
    ]
}

// All chromosomes export
{
    "animal_type": "beewasp",
    "export_date": "2025-01-01T00:00:00Z",
    "chromosomes": {
        "chr01": [...],
        "chr02": [...]
    }
}
```

---

### GeneVisualizer (`gene-visualizer.js`)

**Purpose**: Handles pet genome visualization with interactive gene display, filtering, and statistical analysis.

#### Class Structure

```javascript
class GeneVisualizer {
    constructor(apiClient) {
        this.apiClient = apiClient;
        this.currentPet = null;
        this.currentView = 'attribute';
        this.selectedAttributes = [];
        this.selectedChromosomes = [];
    }
}
```

#### Methods

##### `initialize()`
Initializes the gene visualizer with event listeners and UI setup.

##### `async loadPet(petId)`
Loads pet genome data for visualization.

**Parameters**:
- `petId` (number): Pet ID to load

**Process**:
1. Fetches pet genome data from API
2. Processes gene data for visualization
3. Renders gene grid and statistics

##### `renderGenomeGrid()`
Renders the interactive genome visualization grid.

**Features**:
- Color-coded gene cells based on effects
- Chromosome-based organization
- Hover tooltips with gene details
- Click interactions for selection

##### `updateFilters(effectFilter, valueFilter)`
Updates the visualization based on filter criteria.

**Parameters**:
- `effectFilter` (Array): Effect types to show
- `valueFilter` (Array): Value types to show

##### `showTooltip(cell, gene)`
Displays detailed gene information on hover.

**Parameters**:
- `cell` (HTMLElement): Gene cell element
- `gene` (Object): Gene data object

##### `updateStatistics()`
Updates the statistics table with current gene counts.

**Features**:
- Attribute effect counts (positive/negative)
- Appearance type counts
- Interactive row selection
- Filter integration

#### Visualization Features

##### Color Coding System

```javascript
// Effect-based colors
.gene-positive.gene-dominant { background: #4caf50; }    // Green
.gene-negative.gene-dominant { background: #f44336; }    // Red  
.gene-neutral.gene-dominant { background: #95a5a6; }     // Gray

// Appearance-based colors (recessive)
.gene-body-color-hue.gene-recessive { background: #ff9800; }
.gene-wing-color-hue.gene-recessive { background: #2196f3; }
```

##### Interactive Elements

- **Gene Cells**: Hover for tooltips, click for selection
- **Chromosome Labels**: Click to filter by chromosome
- **Statistics Rows**: Click to filter by attribute type
- **Legend Items**: Click to toggle effect visibility

##### View Modes

1. **Attribute View**: Shows genetic effects (Intelligence, Toughness, etc.)
2. **Appearance View**: Shows visual traits (Body Color, Wing Scale, etc.)

#### Data Processing

##### Gene Classification

```javascript
// Classify gene effects
const classifyGene = (gene) => {
    if (gene.dominant.endsWith('+') || gene.recessive.endsWith('+')) {
        return 'positive';
    } else if (gene.dominant.endsWith('-') || gene.recessive.endsWith('-')) {
        return 'negative';
    } else {
        return 'neutral';
    }
};
```

##### Statistics Calculation

```javascript
// Count genes by attribute
const stats = genes.reduce((acc, gene) => {
    const attribute = extractAttribute(gene.effect);
    acc[attribute] = acc[attribute] || { positive: 0, negative: 0 };
    if (gene.type === 'positive') acc[attribute].positive++;
    if (gene.type === 'negative') acc[attribute].negative++;
    return acc;
}, {});
```

---

### AppController (`app-controller.js`)

**Purpose**: Main application coordinator that initializes and connects all modules.

#### Class Structure

```javascript
class AppController {
    constructor() {
        this.apiClient = new ApiClient();
        this.uiUtils = new UIUtils();
        this.geneManager = new GeneManager(this.apiClient, this.uiUtils);
        this.geneVisualizer = null; // Initialized when needed
        this.exportManager = new ExportManager(this.apiClient, this.uiUtils);
        this.currentMode = 'gene-editing';
    }
}
```

#### Methods

##### `async initialize()`
Initializes the entire application.

**Process**:
1. Initializes all modules
2. Loads animal types
3. Sets up event listeners
4. Handles any initialization errors

##### `async loadAnimalTypes()`
Loads and populates the animal type dropdown.

##### `setupEventListeners()`
Sets up all UI event listeners.

**Events handled**:
- Animal type selection change
- Chromosome selection change
- Load genes button click
- Export button clicks
- Tab switching between gene editing and pet management
- Pet selection and deletion

##### `switchTab(tabId)`
Switches between application tabs (gene editing vs pet management).

**Parameters**:
- `tabId` (string): Target tab identifier ('gene-editing' or 'pet-management')

##### `async loadChromosomes()`
Loads chromosomes when animal type changes.

##### `async loadGenes()`
Loads genes when chromosome is selected.

##### `async loadPets()`
Loads pets for the pet management tab.

##### `async selectPet(petId)`
Selects a pet for visualization.

**Parameters**:
- `petId` (number): Pet ID to select

##### `initializeGeneVisualizer()`
Initializes the gene visualizer module when needed.

#### Application Flow

```javascript
// 1. Application starts
const app = new AppController();
await app.initialize();

// Gene Editing Mode:
// 2. User selects animal type → loadChromosomes()
// 3. User selects chromosome → enables "Load Genes" button  
// 4. User clicks "Load Genes" → loadGenes() → displays gene cards
// 5. User edits genes → change detection → save buttons enable/disable
// 6. User saves changes → API call via GeneManager
// 7. User exports data → export functions via ExportManager

// Pet Management Mode:
// 2. User switches to Pet Management tab → switchTab('pet-management')
// 3. App loads pets → loadPets() → displays pet list
// 4. User selects pet → selectPet() → loads genome visualization
// 5. Gene visualizer displays interactive genome grid
// 6. User interacts with visualization (filters, statistics)
```

## Event System

### Event Flow

```
User Action → Event Listener → Controller Method → Module Method → API Call → UI Update
```

### Example Event Handling

```javascript
// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        const tabId = e.target.closest('.tab').dataset.tab;
        this.switchTab(tabId);
    });
});

// Animal type selection
document.getElementById('animalType').addEventListener('change', async () => {
    await this.loadChromosomes();
    this.uiUtils.clearGeneDisplay();
    this.uiUtils.updateButtonStates(null, null);
});

// Pet selection
// Handled via onclick attributes in pet HTML elements

// Gene field changes
element.addEventListener('input', () => {
    this.geneManager.checkForChanges(card);
});
```

## Error Handling

### API Error Handling

```javascript
try {
    const result = await this.apiClient.updateGene(updateData);
    this.uiUtils.showSuccess('Gene saved successfully!');
} catch (error) {
    console.error('Error saving gene:', error);
    this.uiUtils.showError('Error saving gene. Please try again.');
}
```

### User-Friendly Messages

- **Success**: Green notifications for successful operations
- **Errors**: Red notifications with helpful messages
- **Loading**: Blue indicators for ongoing operations

## Performance Considerations

### DOM Manipulation

- Batch DOM updates when possible
- Use document fragments for multiple insertions
- Cache DOM element references

### API Optimization

- Avoid unnecessary API calls
- Implement debouncing for frequent operations
- Cache static data (effect options)

### Memory Management

- Remove event listeners when not needed
- Avoid global variables
- Clean up references in module destruction

## Browser Compatibility

### Supported Features

- ES6+ classes and modules
- Async/await syntax
- Fetch API
- Modern DOM APIs

### Minimum Browser Requirements

- Chrome 61+
- Firefox 60+
- Safari 11+
- Edge 79+

## Development Guidelines

### Code Style

```javascript
// Use meaningful variable names
const effectOptions = await this.apiClient.getEffectOptions();

// Prefer const/let over var
const element = document.getElementById('geneCard');

// Use async/await over Promises
async function saveGene() {
    try {
        const result = await apiClient.updateGene(data);
        return result;
    } catch (error) {
        throw error;
    }
}

// Document complex functions
/**
 * Creates a gene card element with editing capabilities
 * @param {Object} gene - Gene data object
 * @param {string} animalType - Animal type identifier
 * @returns {HTMLElement} Configured gene card element
 */
createGeneCard(gene, animalType) {
    // Implementation...
}
```

### Testing Considerations

Each module is designed to be testable:

```javascript
// Dependency injection for testing
class GeneManager {
    constructor(apiClient, uiUtils) {
        this.apiClient = apiClient;
        this.uiUtils = uiUtils;
    }
}

// Mock API client for testing
const mockApiClient = {
    getGenes: () => Promise.resolve([]),
    updateGene: () => Promise.resolve({})
};

const geneManager = new GeneManager(mockApiClient, mockUiUtils);
```

### Debugging

Each module includes console logging for development:

```javascript
console.log('Loading genes for:', animalType, chromosome);
console.error('Error saving gene:', error);
```

## Future Enhancements

### Potential Improvements

1. **State Management**: Implement Redux-like state management
2. **Real-time Updates**: WebSocket for live collaboration  
3. **Offline Support**: Service worker for offline functionality
4. **Advanced Search**: Filter and search gene data
5. **Undo/Redo**: Action history management
6. **Drag & Drop**: Reorder gene cards
7. **Bulk Edit**: Edit multiple genes simultaneously
8. **Enhanced Visualization**: 3D genome visualization, gene relationship graphs
9. **Export Formats**: PDF reports, CSV data export
10. **Collaborative Features**: Multi-user editing, comments system

### Migration Considerations

The modular architecture makes it easy to:
- Replace individual modules
- Add new functionality
- Integrate with frameworks (React, Vue, etc.)
- Implement TypeScript
- Add automated testing
