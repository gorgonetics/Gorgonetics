# Frontend Documentation

## Overview

The Gorgonetics frontend is a **SvelteKit** single-page application for managing and visualizing pet genome data from Project Gorgon. It uses Svelte 5, Tailwind CSS 4, and Flowbite Svelte for UI components. The app renders entirely on the client side (SSR is disabled) and is built to a static bundle served alongside the FastAPI backend.

## Technology Stack

- **SvelteKit 2** with **Svelte 5** -- file-based routing, `$lib` alias, static adapter
- **Vite 7** -- dev server with API proxy to `localhost:8000`
- **Tailwind CSS 4** -- via `@tailwindcss/vite` plugin
- **Flowbite Svelte** -- UI primitives (Modal, Dropzone, Input, Select, Label, Button)
- **@flowbite-svelte-plugins/datatable** -- sortable/searchable pet data table
- **@lucide/svelte** -- icon library (used for navigation arrows, etc.)
- **Vitest** with jsdom -- unit and component tests
- **ESLint** with `eslint-plugin-svelte` -- linting

## Project Structure

```
src/
├── app.html                              # HTML shell (%sveltekit.head%, %sveltekit.body%)
├── app.css                               # Global styles, CSS custom properties for gene colors
├── routes/
│   ├── +layout.js                        # Disables SSR, enables prerendering
│   ├── +layout.svelte                    # Root layout: AuthWrapper + Sidebar + content slot
│   ├── +page.js                          # Prerender flag
│   ├── +page.svelte                      # Main page (pet viz, gene editing, pet table)
│   ├── auth/
│   │   ├── login/+page.svelte            # Standalone login page
│   │   └── register/+page.svelte         # Standalone registration page
│   ├── genes/+page.js                    # Prerender flag
│   └── pets/+page.js                     # Prerender flag
├── lib/
│   ├── components/
│   │   ├── AuthWrapper.svelte            # Auth initialization, loading gate
│   │   ├── GeneEditingView.svelte        # Full gene editing grid for a chromosome
│   │   ├── forms/
│   │   │   ├── LoginForm.svelte          # Username/password login form
│   │   │   ├── RegisterForm.svelte       # Registration form
│   │   │   └── PetUploadForm.svelte      # Drag-and-drop genome file upload
│   │   ├── gene/
│   │   │   ├── GeneCell.svelte           # Single gene dot in the genome visualization
│   │   │   ├── GeneEditor.svelte         # Sidebar species/chromosome selector
│   │   │   ├── GeneStatsTable.svelte     # Attribute statistics panel with filter controls
│   │   │   ├── GeneTooltip.svelte        # Hover tooltip for gene cells
│   │   │   └── GeneVisualizer.svelte     # Chromosome-by-chromosome genome dot grid
│   │   ├── layout/
│   │   │   ├── Sidebar.svelte            # Primary navigation, tab switching, user/auth section
│   │   │   └── VisualizationHeader.svelte # Sticky dark header bar for content views
│   │   └── pet/
│   │       ├── PetDataTable.svelte       # Searchable/sortable pet list (flowbite datatable)
│   │       ├── PetEditor.svelte          # Modal form for editing pet attributes
│   │       └── PetVisualization.svelte   # Per-pet genome visualization with view toggle
│   ├── services/
│   │   └── api.js                        # ApiClient singleton -- all backend communication
│   ├── stores/
│   │   ├── auth.js                       # Auth state (user, isAuthenticated, token management)
│   │   └── pets.js                       # Pet data, loading, error, active tab, gene editing state
│   └── utils/
│       └── apiUtils.js                   # normalizeSpecies, cached config loaders, fallback constants
└── static/
    ├── favicon.png
    ├── gorgonetics-logo.png
    ├── gorgonetics-logo-128.png
    └── styles.css
```

## Architecture

### Rendering Model

SvelteKit is configured as a fully client-side SPA:

- `+layout.js` sets `export const ssr = false` and `export const prerender = true`.
- The static adapter (`@sveltejs/adapter-static`) outputs to `build/` with `fallback: 'index.html'` so all routes resolve client-side.
- During development, Vite proxies `/api` and `/static` requests to the FastAPI backend on port 8000.

### Path Aliases

Defined in `svelte.config.js` and available throughout the app:

| Alias          | Resolves to            |
|----------------|------------------------|
| `$lib`         | `src/lib`              |
| `$components`  | `src/lib/components`   |
| `$stores`      | `src/lib/stores`       |
| `$services`    | `src/lib/services`     |
| `$utils`       | `src/lib/utils`        |

In practice, imports use the standard `$lib` prefix (e.g., `import { apiClient } from '$lib/services/api.js'`).

### Application Shell

The root layout (`+layout.svelte`) composes the app shell:

```svelte
<script>
    import "../app.css";
    import AuthWrapper from "$lib/components/AuthWrapper.svelte";
    import Sidebar from "$lib/components/layout/Sidebar.svelte";

    const { children } = $props();
    let sidebarCollapsed = $state(false);

    function toggleSidebar() {
        sidebarCollapsed = !sidebarCollapsed;
        localStorage.setItem("sidebarCollapsed", JSON.stringify(sidebarCollapsed));
    }
</script>

<AuthWrapper>
    <div class="app-layout" class:sidebar-collapsed={sidebarCollapsed}>
        <Sidebar {sidebarCollapsed} {toggleSidebar} />
        <main class="flex-1 overflow-auto">
            {@render children()}
        </main>
    </div>
</AuthWrapper>
```

`AuthWrapper` initializes auth state on mount (validates stored JWT), shows a loading spinner while checking, then renders the app content via a `<slot>`. Authentication is optional -- anonymous users see demo data.

### Main Page View Switching

The main page (`+page.svelte`) reads store values to determine which view to display. There is no client-side router for these views; they are driven by store state:

1. **Loading** -- spinner while pets load
2. **Welcome** -- shown when no pet, no gene editing view, and not on the pets tab
3. **PetVisualization** -- when `$selectedPet` is set (genome dot visualization)
4. **PetDataTable** -- when `$activeTab === "pets"` (sortable table of all pets)
5. **GeneEditingView** -- when `$geneEditingView` is set (chromosome gene editor)

The Sidebar controls which view is active by calling `appState.switchTab()`, `appState.selectPet()`, and `appState.setGeneEditingView()`.

## Component Reference

### Layout Components

**`Sidebar.svelte`** -- The main navigation panel. Receives `sidebarCollapsed` and `toggleSidebar` as props. Contains:
- Logo and branding
- Tab buttons for "Pet Manager" and "Gene Editor"
- Contextual controls panel (pet upload form when on pets tab, gene species/chromosome selector when on editor tab)
- User info section (authenticated) or sign-in/sign-up buttons (anonymous)
- Auth modal (Flowbite `Modal`) for inline login/registration without navigating away
- Collapsible via toggle button in the footer

**`VisualizationHeader.svelte`** -- A sticky dark header bar used by `PetVisualization`, `PetDataTable`, and `GeneEditingView`. Accepts `title`, `stats`, and optional snippet slots for controls:

```svelte
<VisualizationHeader
    title="Gene Visualization: {pet?.name}"
    stats={[{ text: `${pet?.known_genes || 0} known genes` }]}
>
    {#snippet leftControls()}
        <button onclick={handleBack}><ArrowLeft /></button>
    {/snippet}
    <div class="view-controls">
        <button onclick={() => handleViewChange("attribute")}>Attributes</button>
    </div>
</VisualizationHeader>
```

### Gene Components

**`GeneEditor.svelte`** (in `gene/`) -- Sidebar control that lets the user select an animal type and chromosome. On mount, it fetches available animal types from `/api/animal-types`. When an animal type is selected, it loads chromosomes from `/api/chromosomes/{type}`. Clicking "Edit Genes" calls `appState.setGeneEditingView()` to show the editing grid in the main content area.

**`GeneEditingView.svelte`** -- The full chromosome editing interface. Receives `animalType` and `chromosome` as props. Loads genes from the API, displays them in a responsive 4-column card grid. Each card has dropdowns for dominant/recessive effects (color-coded positive/negative), an appearance text input, and expandable notes. Tracks unsaved changes and supports batch save (admin-only). Also supports JSON export of the chromosome.

**`GeneVisualizer.svelte`** -- Renders the genome as a dot grid organized by chromosome. Each gene is a colored circle (`GeneCell`) whose fill and border encode the gene's effect type (positive/negative/neutral) and zygosity (dominant/recessive/mixed). Supports two view modes: "attribute" (colors by stat effect) and "appearance" (colors by appearance category using CSS custom properties).

**`GeneCell.svelte`** -- A single 19px circular dot. Computes its CSS class from the gene's analysis data to set color and style. Dispatches `tooltip-show`/`tooltip-hide` events on hover, consumed by `GeneTooltip`.

**`GeneTooltip.svelte`** -- Positioned tooltip that displays gene ID, type description, and effect text when hovering over a `GeneCell`.

**`GeneStatsTable.svelte`** -- Statistics panel showing attribute breakdowns (positive/negative/neutral counts). Loads attribute and appearance configs via `apiUtils.js` cached loaders. Supports attribute filtering to highlight specific genes in the visualizer.

### Pet Components

**`PetDataTable.svelte`** -- Renders all pets in a searchable, sortable, paginated table using the `@flowbite-svelte-plugins/datatable` `Table` component. Columns include pet name, species, gender, breed, all attribute values, created date, and action buttons (view/edit/delete). Action buttons use `data-action` attributes and a delegated click handler.

**`PetVisualization.svelte`** -- Wraps `GeneVisualizer` for a selected pet. Provides a header with attribute/appearance view toggle and a back button to return to the pet table. Receives the `pet` object as a prop.

**`PetEditor.svelte`** -- A Flowbite `Modal` form for editing pet attributes (name, gender, breed, genetic stats). Uses `$bindable()` for the `open` prop so the parent can control modal visibility.

### Form Components

**`LoginForm.svelte`** -- Username/password form. Calls `authStore.login()` and dispatches `loginSuccess` on success.

**`RegisterForm.svelte`** -- Registration form. Calls `authStore.register()` (which auto-logs-in on success) and dispatches `registerSuccess`.

**`PetUploadForm.svelte`** -- Flowbite `Dropzone` for `.txt` genome files, plus optional name and gender fields. Calls `appState.uploadPet()` on file selection.

### AuthWrapper

**`AuthWrapper.svelte`** -- Initializes authentication on mount by calling `authStore.initialize()`. While loading, shows a full-screen spinner. Once loaded, renders child content unconditionally (auth is optional; anonymous users see demo pets).

## State Management

The app uses Svelte writable stores for shared state. There are two store modules.

### `auth.js` -- Authentication State

Exports:
- `user` -- writable store holding the current user object (or `null`)
- `isAuthenticated` -- writable boolean
- `isLoading` -- writable boolean (true during login/register/initialize)
- `authError` -- writable string for error messages
- `TOKEN_KEY` / `REFRESH_TOKEN_KEY` -- localStorage key constants, shared with `api.js`
- `authStore` -- action object with methods:
  - `initialize()` -- reads token from localStorage, validates via `/api/auth/me`
  - `login(username, password)` -- authenticates, stores tokens, sets user
  - `register(username, password)` -- registers then auto-logs-in
  - `logout()` -- calls logout API, clears tokens and state
  - `clearTokens()`, `getAccessToken()`, `getRefreshToken()`, `clearError()`

### `pets.js` -- Application State

Exports:
- `pets` -- writable array of pet objects
- `selectedPet` -- writable (the pet currently being visualized, or `null`)
- `loading` -- writable boolean
- `error` -- writable string
- `geneEditingView` -- writable (`{ animalType, chromosome }` or `null`)
- `petTableView` -- writable boolean
- `activeTab` -- writable string (`"pets"` or `"editor"`)
- `appState` -- action object with methods:
  - `loadPets()` -- fetches pets from API, handles pagination response
  - `selectPet(pet)` -- sets the selected pet for visualization
  - `deletePet(petId)` -- deletes and reloads
  - `updatePet(petId, data)` -- updates and reloads
  - `uploadPet(file, name, gender)` -- uploads genome file and reloads
  - `setGeneEditingView(data)` / `clearGeneEditingView()`
  - `showPetTableView()` / `hidePetTableView()`
  - `switchTab(tab)` -- switches active tab, clears conflicting views
  - `clearError()`, `setError(msg)`, `reset()`

View switching is mutual-exclusion: selecting a pet clears gene editing, switching to the editor tab clears the selected pet, etc.

## API Layer

### `api.js` -- ApiClient Class

A singleton `ApiClient` instance manages all backend communication:

```javascript
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '$lib/stores/auth.js';

class ApiClient {
    constructor(baseUrl = "") { /* ... */ }
    setAuthToken(token) { /* ... */ }

    async fetchWithErrorHandling(url, options = {}, _isRetry = false) {
        // Adds Authorization header from currentToken
        // Strips Content-Type for FormData (browser sets multipart boundary)
        // On 401: attempts silent token refresh via /api/auth/refresh, retries once
        // On refresh failure: throws "Session expired"
    }

    // Auth endpoints
    async login(username, password) { /* POST /api/auth/login */ }
    async register(username, password) { /* POST /api/auth/register */ }
    async getCurrentUser(token) { /* GET /api/auth/me */ }
    async logout(token) { /* POST /api/auth/logout */ }

    // Gene endpoints
    async getAnimalTypes() { /* GET /api/animal-types */ }
    async getChromosomes(animalType) { /* GET /api/chromosomes/{type} */ }
    async getGenes(animalType, chromosome) { /* GET /api/genes/{type}/{chr} */ }
    async updateGene(updateData) { /* PUT /api/gene */ }
    async getEffectOptions() { /* GET /api/effect-options */ }
    async getGeneEffects(animalType) { /* GET /api/gene-effects/{type} */ }
    async getAttributeConfig(animalType) { /* GET /api/attribute-config/{type} */ }
    async exportChromosome(animalType, chr) { /* GET /api/download/{type}/{chr} */ }
    async exportAllChromosomes(animalType) { /* GET /api/export/{type} */ }

    // Pet endpoints
    async getPets() { /* GET /api/pets */ }
    async getPet(petId) { /* GET /api/pets/{id} */ }
    async deletePet(petId) { /* DELETE /api/pets/{id} */ }
    async updatePet(petId, data) { /* PUT /api/pets/{id} */ }
    async uploadPet(file, name, gender, notes) { /* POST /api/pets/upload (FormData) */ }
    async getPetGenome(petId) { /* GET /api/pet-genome/{id} */ }
}

export const apiClient = new ApiClient();
```

Key behaviors:
- Token is set imperatively via `setAuthToken()` by the auth store and AuthWrapper after login/initialization.
- `TOKEN_KEY` and `REFRESH_TOKEN_KEY` are imported from `auth.js` so both modules use the same localStorage keys.
- On 401, the client tries a single silent refresh using the stored refresh token before giving up.
- FormData requests (pet upload) skip the `Content-Type` header so the browser can set the multipart boundary.

### `apiUtils.js` -- Cached Config Loaders

Provides utility functions used by visualization components:

- `normalizeSpecies(species)` -- maps variations ("bee", "wasp") to canonical names ("beewasp", "horse")
- `loadAttributeConfig(species)` -- fetches and caches attribute config from the API
- `loadAppearanceConfig(species)` -- fetches and caches appearance config
- `loadGeneEffects(species)` -- fetches and caches gene effects data
- `FALLBACK_ATTRIBUTES` / `FALLBACK_ATTRIBUTE_LIST` / `FALLBACK_APPEARANCE_LIST` -- hardcoded fallbacks used when API config is unavailable

All loaders use in-memory `Map` caches keyed by normalized species name.

## Styling

### Tailwind CSS 4

Global styles are imported in `app.css` with `@import 'tailwindcss'`. The Tailwind Vite plugin handles processing. Utility classes are used alongside component-scoped `<style>` blocks.

### CSS Custom Properties

Gene colors are defined as CSS custom properties in both `app.css` and `GeneCell.svelte`:

```css
:root {
    --color-positive: #4caf50;
    --color-negative: #f44336;
    --color-neutral: #95a5a6;
    --gene-body-hue: #ff9800;
    --gene-wing-hue: #2196f3;
    /* ... more appearance-category colors */
}
```

`GeneCell` uses `--gene-color` as an intermediary variable, set per-appearance-class (e.g., `.gene-body-color-hue { --gene-color: var(--gene-body-hue); }`), then applied uniformly for dominant/recessive/mixed patterns.

### Gene Visualization Color Encoding

Genes are rendered as small circles with visual encoding:

| Zygosity   | Positive (green)      | Negative (red)         | Neutral (gray)        |
|------------|-----------------------|------------------------|-----------------------|
| Dominant   | Solid fill            | Solid fill             | Solid fill            |
| Recessive  | Thick border, no fill | Thick border, no fill  | Thick border, no fill |
| Mixed      | Diagonal half-fill    | Diagonal half-fill     | Diagonal half-fill    |
| Unknown    | Dashed border, "?"    | --                     | --                    |

In appearance view mode, colors switch to category-specific hues (body hue, wing scale, etc.) instead of the positive/negative/neutral palette.

### Flowbite Components

The app uses Flowbite Svelte for:
- `Modal` -- auth dialogs in Sidebar, pet editor
- `Dropzone` -- file upload in PetUploadForm
- `Input`, `Label`, `Select`, `Button` -- form controls in PetUploadForm and PetEditor
- `Table` (via `@flowbite-svelte-plugins/datatable`) -- the pet data table with search, sort, and pagination

## Build and Development

### Development

```bash
pnpm run dev        # Start dev server on port 5173 (proxies /api to localhost:8000)
```

The backend must be running on port 8000 for API calls to work. Start it with `uv run gorgonetics web`.

### Production Build

```bash
pnpm run build      # Static build output to build/
pnpm run preview    # Preview the production build locally
```

The static adapter outputs to `build/` with `fallback: 'index.html'` for SPA routing.

### Linting

```bash
pnpm run lint       # ESLint check
pnpm run lint:fix   # ESLint with auto-fix
pnpm run lint:ci    # Zero-warning mode (same as CI)
```

### Testing

```bash
pnpm run test:client           # Run Vitest tests
pnpm run test:client:watch     # Watch mode
pnpm run test:client:ui        # Interactive Vitest UI
pnpm run test:client:coverage  # With coverage report
pnpm run test:integration      # Backend integration tests (./test.sh quick)
pnpm run test:all              # Full suite (./test.sh all)
```

## Key Patterns

### Props with `$props()`

All components use the Svelte 5 runes API for props:

```svelte
<script>
    const { pet, open = $bindable(), onClose } = $props();
</script>
```

### Reactive State with `$state()` and `$derived()`

Local component state uses `$state()`. Computed values use `$derived()`:

```svelte
<script>
    let genes = $state([]);
    let hasUnsavedChanges = $state(false);
    const isAdmin = $derived($user?.role === 'admin');
</script>
```

### Side Effects with `$effect()`

Used for reacting to store changes, such as reloading pets when auth status changes:

```svelte
<script>
    $effect(() => {
        const _authenticated = $isAuthenticated;
        if (_authenticated !== undefined) {
            appState.loadPets();
        }
    });
</script>
```

### Content Projection with `{@render}`

The root layout uses `{@render children()}` instead of `<slot>` for content projection. `VisualizationHeader` uses named snippets:

```svelte
<VisualizationHeader title="...">
    {#snippet leftControls()}
        <button>Back</button>
    {/snippet}
    <div>Default slot content</div>
</VisualizationHeader>
```

### Store Subscriptions in Templates

Svelte's `$` prefix auto-subscribes to stores in templates and reactive contexts:

```svelte
{#if $isAuthenticated}
    <PetUpload />
{:else}
    <p>Sign in to upload pets.</p>
{/if}
```

### Event Dispatching

Some components (LoginForm, RegisterForm, PetUploadForm) still use `createEventDispatcher()` for parent communication, while others use callback props.
