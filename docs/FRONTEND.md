# Frontend Documentation

## Overview

The Gorgonetics frontend is built with **Svelte 5** using modern reactive patterns and component-based architecture. The application provides an intuitive interface for pet genome management and gene editing with real-time authentication and state management.

## Architecture

### Technology Stack

- **Svelte 5**: Modern reactive framework with runes and enhanced reactivity
- **Vite**: Fast build tool and development server
- **Flowbite Svelte**: UI components and design system
- **Tailwind CSS**: Utility-first CSS framework
- **Vitest**: Testing framework with jsdom
- **ESLint**: Code linting and quality

### Project Structure

```
src/svelte/
├── App.svelte                    # Main application component
├── app.html                      # HTML template
├── app.css                       # Global styles
├── main.js                       # Application entry point
└── lib/
    ├── components/               # Reusable Svelte components
    │   ├── AuthWrapper.svelte    # Authentication state wrapper
    │   ├── LoginForm.svelte      # User login form
    │   ├── RegisterForm.svelte   # User registration form
    │   ├── Sidebar.svelte        # Navigation sidebar
    │   ├── MainContent.svelte    # Main content area
    │   ├── GeneEditor.svelte     # Gene editing interface
    │   ├── GeneEditingView.svelte # Gene editing view container
    │   ├── GeneCell.svelte       # Individual gene cell component
    │   ├── GeneTooltip.svelte    # Gene information tooltip
    │   ├── GeneVisualizer.svelte # Genome visualization
    │   ├── GeneStatsTable.svelte # Gene statistics table
    │   ├── PetEditor.svelte      # Pet editing interface
    │   ├── PetUpload.svelte      # Pet genome upload form
    │   ├── PetVisualization.svelte # Pet genome display
    │   └── PetDataTableView.svelte # Pet data table
    ├── services/
    │   └── apiClient.js          # API communication layer
    └── stores/
        ├── appState.js           # Application state management
        └── authStore.js          # Authentication state management
```

## Component Architecture

### App.svelte - Main Application

The root component that orchestrates the entire application:

```svelte
<script>
  import { onMount } from 'svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import MainContent from './lib/components/MainContent.svelte';
  import AuthWrapper from './lib/components/AuthWrapper.svelte';
  import { appState } from './lib/stores/appState.js';
  import { apiClient } from './lib/services/apiClient.js';
  import { isAuthenticated } from './lib/stores/authStore.js';

  let sidebarCollapsed = $state(false);

  onMount(async () => {
    await apiClient.initialize();
    // Restore sidebar state from localStorage
    const savedState = localStorage.getItem('sidebarCollapsed');
    if (savedState !== null) {
      sidebarCollapsed = JSON.parse(savedState);
    }
  });

  // Load pets when user becomes authenticated
  $effect(() => {
    if ($isAuthenticated) {
      appState.loadPets();
    }
  });
</script>
```

### Authentication Components

#### AuthWrapper.svelte
Manages authentication state and displays login/register forms or main application:

```svelte
<script>
  import { isAuthenticated } from '../stores/authStore.js';
  import LoginForm from './LoginForm.svelte';
  import RegisterForm from './RegisterForm.svelte';
  
  let showRegister = $state(false);
</script>

{#if $isAuthenticated}
  <slot />
{:else}
  {#if showRegister}
    <RegisterForm bind:showRegister />
  {:else}
    <LoginForm bind:showRegister />
  {/if}
{/if}
```

#### LoginForm.svelte & RegisterForm.svelte
Handle user authentication with form validation and error handling:

```svelte
<script>
  import { authStore } from '../stores/authStore.js';
  
  let username = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state('');

  async function handleSubmit() {
    loading = true;
    error = '';
    
    try {
      await authStore.login(username, password);
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }
</script>
```

### Main Application Components

#### Sidebar.svelte
Navigation component with collapsible menu:

```svelte
<script>
  export let sidebarCollapsed;
  export let toggleSidebar;
  
  import { appState } from '../stores/appState.js';
  import { authStore } from '../stores/authStore.js';
</script>

<aside class="sidebar" class:collapsed={sidebarCollapsed}>
  <!-- Navigation items based on user permissions -->
</aside>
```

#### MainContent.svelte
Main content area that switches between different views:

```svelte
<script>
  import { appState } from '../stores/appState.js';
  import GeneEditingView from './GeneEditingView.svelte';
  import PetDataTableView from './PetDataTableView.svelte';
  import PetEditor from './PetEditor.svelte';
  
  let currentView = $derived(appState.currentView);
</script>

<main class="main-content">
  {#if currentView === 'gene-editing'}
    <GeneEditingView />
  {:else if currentView === 'pet-table'}
    <PetDataTableView />
  {:else if currentView === 'pet-editor'}
    <PetEditor />
  {/if}
</main>
```

### Gene Management Components

#### GeneEditor.svelte
Main gene editing interface with chromosome selection and gene modification:

```svelte
<script>
  import { appState } from '../stores/appState.js';
  import GeneCell from './GeneCell.svelte';
  import GeneTooltip from './GeneTooltip.svelte';
  
  let selectedSpecies = $state('beewasp');
  let selectedChromosome = $state('chr01');
  let genes = $derived(appState.getGenes(selectedSpecies, selectedChromosome));
</script>

<div class="gene-editor">
  <!-- Species and chromosome selectors -->
  <div class="gene-grid">
    {#each genes as gene (gene.gene)}
      <GeneCell {gene} />
    {/each}
  </div>
</div>
```

#### GeneCell.svelte
Individual gene editing component with inline editing capabilities:

```svelte
<script>
  export let gene;
  
  import { appState } from '../stores/appState.js';
  
  let editing = $state(false);
  let effectDominant = $state(gene.effectDominant);
  let effectRecessive = $state(gene.effectRecessive);
  
  async function saveGene() {
    await appState.updateGene({
      ...gene,
      effectDominant,
      effectRecessive
    });
    editing = false;
  }
</script>

<div class="gene-cell" class:editing>
  {#if editing}
    <input bind:value={effectDominant} />
    <input bind:value={effectRecessive} />
    <button onclick={saveGene}>Save</button>
  {:else}
    <span onclick={() => editing = true}>{gene.gene}</span>
  {/if}
</div>
```

### Pet Management Components

#### PetUpload.svelte
File upload component for genome files:

```svelte
<script>
  import { appState } from '../stores/appState.js';
  
  let files = $state([]);
  let uploading = $state(false);
  let petName = $state('');
  let gender = $state('Male');
  let notes = $state('');
  
  async function uploadPet() {
    uploading = true;
    try {
      await appState.uploadPet(files[0], { name: petName, gender, notes });
      // Reset form
      files = [];
      petName = '';
      notes = '';
    } finally {
      uploading = false;
    }
  }
</script>

<div class="pet-upload">
  <input type="file" bind:files accept=".txt" />
  <input bind:value={petName} placeholder="Pet name (optional)" />
  <select bind:value={gender}>
    <option value="Male">Male</option>
    <option value="Female">Female</option>
  </select>
  <textarea bind:value={notes} placeholder="Notes"></textarea>
  <button onclick={uploadPet} disabled={!files.length || uploading}>
    {uploading ? 'Uploading...' : 'Upload Pet'}
  </button>
</div>
```

#### PetVisualization.svelte
Pet genome visualization component:

```svelte
<script>
  export let petId;
  
  import { appState } from '../stores/appState.js';
  import GeneVisualizer from './GeneVisualizer.svelte';
  
  let petGenome = $derived(appState.getPetGenome(petId));
</script>

{#if petGenome}
  <div class="pet-visualization">
    <h2>{petGenome.name}</h2>
    <p>Species: {petGenome.species}</p>
    <p>Owner: {petGenome.owner}</p>
    
    <GeneVisualizer genes={petGenome.genes} />
  </div>
{/if}
```

## State Management

### appState.js - Application State Store

Manages application-wide state using Svelte stores:

```javascript
import { writable, derived } from 'svelte/store';
import { apiClient } from '../services/apiClient.js';

// Core state
export const currentView = writable('gene-editing');
export const selectedSpecies = writable('beewasp');
export const selectedChromosome = writable('chr01');
export const pets = writable([]);
export const genes = writable({});

// Derived state
export const currentPets = derived(
  [pets, selectedSpecies],
  ([$pets, $selectedSpecies]) => 
    $pets.filter(pet => pet.species === $selectedSpecies)
);

// Actions
export const appState = {
  async loadPets() {
    try {
      const petData = await apiClient.getPets();
      pets.set(petData);
    } catch (error) {
      console.error('Failed to load pets:', error);
    }
  },

  async uploadPet(file, metadata) {
    try {
      const result = await apiClient.uploadPet(file, metadata);
      await this.loadPets(); // Refresh pets list
      return result;
    } catch (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }
  },

  async updateGene(gene) {
    try {
      await apiClient.updateGene(gene);
      // Update local gene data
      genes.update(current => ({
        ...current,
        [gene.gene]: gene
      }));
    } catch (error) {
      throw new Error(`Gene update failed: ${error.message}`);
    }
  }
};
```

### authStore.js - Authentication Store

Manages user authentication state:

```javascript
import { writable } from 'svelte/store';
import { apiClient } from '../services/apiClient.js';

export const user = writable(null);
export const isAuthenticated = writable(false);
export const loading = writable(false);

export const authStore = {
  async login(username, password) {
    loading.set(true);
    try {
      const response = await apiClient.login(username, password);
      localStorage.setItem('access_token', response.access_token);
      localStorage.setItem('refresh_token', response.refresh_token);
      
      const userData = await apiClient.getCurrentUser();
      user.set(userData);
      isAuthenticated.set(true);
    } catch (error) {
      throw error;
    } finally {
      loading.set(false);
    }
  },

  async logout() {
    try {
      await apiClient.logout();
    } finally {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      user.set(null);
      isAuthenticated.set(false);
    }
  },

  async initialize() {
    const token = localStorage.getItem('access_token');
    if (token) {
      try {
        const userData = await apiClient.getCurrentUser();
        user.set(userData);
        isAuthenticated.set(true);
      } catch (error) {
        // Token invalid, clear storage
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      }
    }
  }
};
```

## API Integration

### apiClient.js - API Communication

Centralized API client with authentication:

```javascript
class ApiClient {
  constructor() {
    this.baseUrl = '';
    this.token = null;
  }

  async initialize() {
    this.token = localStorage.getItem('access_token');
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    return headers;
  }

  async request(endpoint, options = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers
      }
    });

    if (response.status === 401) {
      // Token expired, redirect to login
      localStorage.removeItem('access_token');
      window.location.reload();
      return;
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Request failed');
    }

    return response.json();
  }

  // Authentication methods
  async login(username, password) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  }

  async register(username, password) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  }

  async getCurrentUser() {
    return this.request('/api/auth/me');
  }

  // Pet methods
  async getPets() {
    return this.request('/api/pets');
  }

  async uploadPet(file, metadata) {
    const formData = new FormData();
    formData.append('file', file);
    if (metadata.name) formData.append('name', metadata.name);
    if (metadata.gender) formData.append('gender', metadata.gender);
    if (metadata.notes) formData.append('notes', metadata.notes);

    return fetch(`${this.baseUrl}/api/pets/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`
      },
      body: formData
    }).then(response => {
      if (!response.ok) throw new Error('Upload failed');
      return response.json();
    });
  }

  // Gene methods
  async updateGene(gene) {
    return this.request('/api/gene', {
      method: 'PUT',
      body: JSON.stringify(gene)
    });
  }
}

export const apiClient = new ApiClient();
```

## Build and Development

### Development Server

```bash
# Start development server (port 5173)
pnpm run dev

# Build for production
pnpm run build

# Preview production build
pnpm run preview
```

### Linting and Formatting

```bash
# Lint code
pnpm run lint

# Fix linting issues
pnpm run lint:fix

# Strict linting (CI)
pnpm run lint:strict
```

### Testing

```bash
# Run client tests
pnpm run test:client

# Run with UI
pnpm run test:client:ui

# Run with coverage
pnpm run test:client:coverage

# Watch mode
pnpm run test:client:watch
```

## Styling

### Tailwind CSS Classes

Common utility classes used throughout the application:

```css
/* Layout */
.sidebar { @apply w-64 bg-gray-800 text-white transition-all duration-300; }
.sidebar.collapsed { @apply w-16; }
.main-content { @apply flex-1 p-6 bg-gray-50; }

/* Components */
.gene-cell { @apply p-2 border rounded hover:bg-gray-100 cursor-pointer; }
.gene-cell.editing { @apply bg-blue-50 border-blue-300; }

/* Forms */
.form-input { @apply px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500; }
.btn-primary { @apply px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700; }
```

### Flowbite Components

Key Flowbite Svelte components used:

- `Button`, `Input`, `Select` - Form controls
- `Modal`, `Tooltip` - Overlay components  
- `Table`, `Pagination` - Data display
- `Alert`, `Spinner` - Feedback components

## Performance Optimizations

### Svelte 5 Features

- **Runes**: `$state()`, `$derived()`, `$effect()` for fine-grained reactivity
- **Snippets**: Reusable template fragments
- **Component Events**: Simplified event handling

### Optimization Techniques

- **Lazy Loading**: Components loaded on-demand
- **Virtual Scrolling**: For large pet/gene lists
- **Debounced Search**: Reduces API calls during typing
- **Caching**: Local storage for user preferences

## Testing Strategy

### Component Tests

```javascript
// Example component test
import { render, screen } from '@testing-library/svelte';
import GeneCell from '../src/lib/components/GeneCell.svelte';

test('renders gene cell with correct data', () => {
  const gene = {
    gene: '01A1',
    effectDominant: 'Intelligence+',
    effectRecessive: 'Intelligence-'
  };
  
  render(GeneCell, { gene });
  
  expect(screen.getByText('01A1')).toBeInTheDocument();
  expect(screen.getByText('Intelligence+')).toBeInTheDocument();
});
```

### Integration Tests

```javascript
// API integration test
test('can upload pet genome', async () => {
  const file = new File(['genome data'], 'test.txt', { type: 'text/plain' });
  
  const result = await apiClient.uploadPet(file, {
    name: 'Test Pet',
    gender: 'Female'
  });
  
  expect(result.status).toBe('success');
  expect(result.name).toBe('Test Pet');
});
```

## Browser Support

- **Modern browsers**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **ES2022 features**: Top-level await, class fields, optional chaining
- **Build target**: ES2022 with automatic polyfills for older browsers