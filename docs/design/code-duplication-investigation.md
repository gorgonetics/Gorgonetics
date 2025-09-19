# Code Duplication Investigation TODO

## Issue Description

During the Flowbite migration implementation, we discovered concerning code duplication between two separate component directories:

- `/src/lib/components/` (SvelteKit structure)
- `/src/svelte/lib/components/` (Legacy structure?)

## Specific Duplications Found

### Sidebar Components
- `/src/lib/components/layout/Sidebar.svelte` (Active - used by SvelteKit routes)
- `/src/svelte/lib/components/Sidebar.svelte` (Inactive - different import paths)

### App Entry Points
- `/src/routes/+layout.svelte` (Active - SvelteKit layout)
- `/src/svelte/App.svelte` (Inactive - standalone app?)

## Import Path Differences

**Active Components (`/src/lib/`):**
```javascript
import { apiClient } from "$lib/services/api.js";
import { activeTab, appState, error } from "$lib/stores/pets.js";
import { authStore, isAuthenticated, user } from "$lib/stores/auth.js";
```

**Inactive Components (`/src/svelte/`):**
```javascript
import { apiClient } from "../services/apiClient.js";
import { activeTab, appState, error } from "../stores/appState.js";
import { authStore, isAuthenticated, user } from "../stores/authStore.js";
```

## Potential Causes

1. **Migration from standalone to SvelteKit**: App may have been migrated from standalone Svelte to SvelteKit
2. **Development/Build structure mismatch**: Different structures for different environments
3. **Incomplete cleanup**: Old files not removed after restructuring
4. **Parallel development**: Multiple approaches developed simultaneously

## Investigation Tasks

### High Priority
- [ ] **Identify Active Code Path**: Determine which directory structure is actually being used in production
- [ ] **Trace Build Process**: Check `vite.config.js`, `svelte.config.js` to see which directories are included
- [ ] **Audit Package.json Scripts**: Verify which entry points are used for dev/build/prod
- [ ] **Check Git History**: Review when duplication was introduced and why

### Medium Priority
- [ ] **Store Structure Analysis**: Compare store implementations between directories
- [ ] **Service Layer Review**: Check API client differences and compatibility
- [ ] **Component Functionality Diff**: Ensure no unique features exist in inactive components
- [ ] **Test Coverage Assessment**: Verify tests cover the correct component tree

### Low Priority
- [ ] **Bundle Analysis**: Check if inactive components are being bundled unnecessarily
- [ ] **Documentation Review**: Look for references to both structures in docs
- [ ] **IDE Configuration**: Ensure development tools point to correct structure

## Risk Assessment

### Immediate Risks
- **Development Confusion**: Developers may modify wrong files
- **Feature Discrepancies**: Changes applied to one structure but not the other
- **Build Size Impact**: Unused components potentially included in bundle
- **Maintenance Burden**: Double the code to maintain

### Long-term Risks
- **Technical Debt**: Accumulated differences between structures
- **Deployment Issues**: Wrong components deployed to production
- **Team Onboarding**: New developers confused by dual structure
- **Refactoring Complexity**: Harder to make architectural changes

## Cleanup Strategy (Draft)

### Phase 1: Investigation
1. Map complete directory structures
2. Identify all duplicated files
3. Determine canonical source of truth
4. Document differences in functionality

### Phase 2: Consolidation
1. Create backup of all unique features
2. Remove inactive directory structure
3. Update all import paths and references
4. Update build configuration if needed

### Phase 3: Verification
1. Full test suite execution
2. Manual QA of all features
3. Bundle size verification
4. Documentation updates

## Notes

- **Current Workaround**: Flowbite migration implemented in both structures to ensure functionality
- **Migration Impact**: Side-by-side comparison tool works because we used correct active structure
- **Urgency Level**: Medium - not blocking current work but needs resolution before next major feature

## Related Files

- `/src/routes/+layout.svelte` (Active layout)
- `/src/svelte/App.svelte` (Inactive app)
- `/src/lib/components/layout/Sidebar.svelte` (Active sidebar)
- `/src/svelte/lib/components/Sidebar.svelte` (Inactive sidebar)
- `/src/lib/components/layout/SidebarFlowbite.svelte` (New Flowbite implementation)

## Owner

TBD - Needs architect/lead developer assignment

## Timeline

Target completion: Before next major feature development