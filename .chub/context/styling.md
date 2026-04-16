---
name: Styling & Theming
description: "CSS approach, theme tokens, gene colors, and accessibility patterns"
tags: css, theming, accessibility, design
---

# Styling & Theming

## Approach

Plain CSS with Svelte scoped `<style>` blocks. No Tailwind, no CSS frameworks. Shared classes live in `src/app.css`.

## Theme System (CSS Custom Properties)

Defined in `src/app.css` with light mode defaults and `[data-theme="dark"]` overrides.

### Token Categories

| Category | Examples |
|----------|---------|
| Surfaces | `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-hover`, `--bg-selected`, `--bg-overlay` |
| Text | `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-muted`, `--text-inverse` |
| Borders | `--border-primary`, `--border-secondary`, `--border-focus` |
| Accent | `--accent`, `--accent-hover`, `--accent-soft` |
| Status | `--error`, `--success`, `--warning` (with `-text`, `-bg`, `-border` variants) |
| Shadows | `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl` |

### Global Component Classes

- Buttons: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`
- Dialogs: `.dialog`, `.dialog-header`, `.dialog-body`, `.dialog-footer`, `.close-btn`
- Forms: `.checkbox-row`, `.checkbox-label`, `.checkbox-desc`
- States: `.loading`, `.error`, `.success`

## Gene Colors

Canonical source: `src/lib/theme/gene-colors.ts`, mirrored in CSS for grid rendering.

| Type | Color |
|------|-------|
| Positive effect | #4caf50 (green) |
| Negative effect | #f44336 (red) |
| Neutral effect | #95a5a6 (gray) |

Appearance colors are per-species mappings (BeeWasp: body-hue, wing-hue; Horse: coat, markings, etc.).

## Dark Mode

- Detects OS preference via `prefers-color-scheme`
- User override persisted in `settings` table
- `[data-theme="dark"]` selector overrides all CSS custom properties

## Accessibility

- `:focus-visible` outline on all interactive elements
- Skip-to-content link (`.skip-link`)
- Focus trapping in modals via `focusTrap.ts` utility
- Semantic HTML + ARIA role attributes
- Layout uses CSS Grid + Flexbox (no table-based layouts)
