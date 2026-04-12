# v0.3.0

A major quality-of-life release focused on accessibility, personalisation, and data organisation.

## Dark Mode

The app now supports Light, Dark, and System themes. Every component has been migrated to a semantic CSS token system, so the dark theme feels native rather than bolted on. Gene visualisation colours are tuned for contrast on dark backgrounds. Choose your preference in Settings or let it follow your OS.

## Keyboard Navigation

Gorgonetics is now fully keyboard-navigable following WAI-ARIA patterns:

- **Tab** through all interactive elements with a visible focus ring
- **Arrow keys** to navigate pet cards, gene grid cells, and dropdown menus
- **Enter/Space** to activate controls and show gene tooltips
- **Escape** to close any modal, dialog, or dropdown
- All modals and dialogs trap focus so Tab stays within them
- A skip-to-content link appears on first Tab press

## Font Scaling

Adjust the app's text size with **Cmd/Ctrl + Plus/Minus** (75%--150% range). Cmd/Ctrl + 0 resets to default. The scale is also adjustable from Settings and persists across sessions.

## Pet Tags

Organise your pets with custom tags:

- Add tags in the pet editor with autocomplete from previously used tags
- Filter the pet list by one or more tags using the new filter buttons
- Tags are stored in a proper database junction table for reliable querying
- Tags are included in backup exports and imports

## Under the Hood

- Migrated pet tags from a JSON column to a junction table for better query performance
- Settings store now updates optimistically for responsive UI during rapid interactions
- Focus trap utility implemented as a reusable Svelte action
- Comprehensive test coverage: 222 unit tests, 94 E2E tests
- Theme and font scale utilities are SSR-safe with proper environment guards
