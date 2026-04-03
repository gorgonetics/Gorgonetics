/**
 * Layout verification tests.
 *
 * These tests check the CSS/layout properties that control:
 * 1. The detail pane constrains to viewport (not growing to content height)
 * 2. The gene grid is the only scrolling element (legend/header pinned)
 * 3. The stats drawer sits at the bottom of the viewport, not below content
 *
 * We parse the actual Svelte component files and verify CSS rules.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readComponent(path) {
  return readFileSync(resolve(path), 'utf-8');
}

function extractStyles(content) {
  const match = content.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  return match ? match[1] : '';
}

function extractTemplate(content) {
  // Everything between </script> and <style>
  const match = content.match(/<\/script>([\s\S]*?)<style/);
  return match ? match[1] : '';
}

// Helper: check that a CSS class has a specific property
function hasProperty(css, selector, property, value) {
  // Find the rule block for the selector
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`, 'g');
  let match = regex.exec(css);
  while (match !== null) {
    const block = match[1];
    if (value) {
      const propRegex = new RegExp(`${property}\\s*:\\s*${value}`);
      if (propRegex.test(block)) return true;
    } else {
      if (block.includes(property)) return true;
    }
    match = regex.exec(css);
  }
  return false;
}

describe('Layout: detail pane constrains to viewport', () => {
  const layout = readComponent('src/routes/+layout.svelte');
  const layoutCss = extractStyles(layout);

  it('app-shell fills height', () => {
    expect(hasProperty(layoutCss, '.app-shell', 'height', '100%')).toBe(true);
    expect(hasProperty(layoutCss, '.app-shell', 'display', 'flex')).toBe(true);
    expect(hasProperty(layoutCss, '.app-shell', 'flex-direction', 'column')).toBe(true);
  });

  it('app-body fills remaining space with min-height:0', () => {
    expect(hasProperty(layoutCss, '.app-body', 'flex', '1')).toBe(true);
    expect(hasProperty(layoutCss, '.app-body', 'min-height', '0')).toBe(true);
  });

  it('detail-pane does NOT have overflow:auto (prevents being the scroll container)', () => {
    // This was the root cause — overflow:auto on detail-pane made IT the scroll container
    expect(hasProperty(layoutCss, '.detail-pane', 'overflow', 'auto')).toBe(false);
  });

  it('detail-pane has position:relative for absolute child positioning', () => {
    expect(hasProperty(layoutCss, '.detail-pane', 'position', 'relative')).toBe(true);
  });

  const page = readComponent('src/routes/+page.svelte');
  const pageCss = extractStyles(page);

  it('detail-content uses position:absolute to fill detail-pane exactly', () => {
    expect(hasProperty(pageCss, '.detail-content', 'position', 'absolute')).toBe(true);
    expect(hasProperty(pageCss, '.detail-content', 'inset', '0')).toBe(true);
  });
});

describe('Layout: PetVisualization flex structure', () => {
  const viz = readComponent('src/lib/components/pet/PetVisualization.svelte');
  const css = extractStyles(viz);
  const html = extractTemplate(viz);

  it('pet-visualization is flex column with overflow:hidden', () => {
    expect(hasProperty(css, '.pet-visualization', 'display', 'flex')).toBe(true);
    expect(hasProperty(css, '.pet-visualization', 'flex-direction', 'column')).toBe(true);
    expect(hasProperty(css, '.pet-visualization', 'overflow', 'hidden')).toBe(true);
    expect(hasProperty(css, '.pet-visualization', 'height', '100%')).toBe(true);
  });

  it('detail-header is flex-shrink:0 (pinned at top)', () => {
    expect(hasProperty(css, '.detail-header', 'flex-shrink', '0')).toBe(true);
  });

  it('visualizer-container does NOT have overflow:auto (not a scroll container)', () => {
    expect(hasProperty(css, '.visualizer-container', 'overflow', 'auto')).toBe(false);
  });

  it('visualizer-container has flex:1 and min-height:0', () => {
    expect(hasProperty(css, '.visualizer-container', 'flex', '1')).toBe(true);
    expect(hasProperty(css, '.visualizer-container', 'min-height', '0')).toBe(true);
  });

  it('stats-drawer is a right-side panel', () => {
    expect(hasProperty(css, '.stats-drawer', 'flex-shrink', '0')).toBe(true);
    expect(hasProperty(css, '.stats-drawer', 'border-left')).toBe(true);
    // Width is set via inline style (resizable), not in CSS
  });

  it('content-area is flex row containing visualizer and drawer', () => {
    expect(hasProperty(css, '.content-area', 'display', 'flex')).toBe(true);
    expect(hasProperty(css, '.content-area', 'flex', '1')).toBe(true);
  });
});

describe('Layout: GeneVisualizer internal scroll', () => {
  const viz = readComponent('src/lib/components/gene/GeneVisualizer.svelte');
  const css = extractStyles(viz);

  it('gene-visualizer fills parent height', () => {
    expect(hasProperty(css, '.gene-visualizer', 'height', '100%')).toBe(true);
    expect(hasProperty(css, '.gene-visualizer', 'display', 'flex')).toBe(true);
  });

  it('visualizer-content is flex:1 with min-height:0', () => {
    expect(hasProperty(css, '.visualizer-content', 'flex', '1')).toBe(true);
    expect(hasProperty(css, '.visualizer-content', 'min-height', '0')).toBe(true);
  });

  it('gene-section is flex:1 with min-height:0', () => {
    expect(hasProperty(css, '.gene-section', 'flex', '1')).toBe(true);
    expect(hasProperty(css, '.gene-section', 'min-height', '0')).toBe(true);
  });

  it('gene-legend is flex-shrink:0 (stays above scroll area)', () => {
    expect(hasProperty(css, '.gene-legend', 'flex-shrink', '0')).toBe(true);
  });

  it('gene-grid-container is the ONLY element with overflow:auto', () => {
    expect(hasProperty(css, '.gene-grid-container', 'overflow', 'auto')).toBe(true);
    expect(hasProperty(css, '.gene-grid-container', 'flex', '1')).toBe(true);
    expect(hasProperty(css, '.gene-grid-container', 'min-height', '0')).toBe(true);
  });

  it('gene-headers (thead) is sticky', () => {
    expect(hasProperty(css, '.gene-headers', 'position', 'sticky')).toBe(true);
    expect(hasProperty(css, '.gene-headers', 'top', '0')).toBe(true);
  });

  it('chromosome-header is sticky left', () => {
    expect(hasProperty(css, '.chromosome-header', 'position', 'sticky')).toBe(true);
    expect(hasProperty(css, '.chromosome-header', 'left', '0')).toBe(true);
  });

  it('chromosome-label is sticky left', () => {
    expect(hasProperty(css, '.chromosome-label', 'position', 'sticky')).toBe(true);
    expect(hasProperty(css, '.chromosome-label', 'left', '0')).toBe(true);
  });
});

describe('Layout: no competing scroll containers', () => {
  it('only gene-grid-container has overflow:auto in the visualization chain', () => {
    const files = [
      'src/routes/+layout.svelte',
      'src/routes/+page.svelte',
      'src/lib/components/pet/PetVisualization.svelte',
      'src/lib/components/gene/GeneVisualizer.svelte',
    ];

    const overflowAutoLocations = [];

    for (const file of files) {
      const content = readComponent(file);
      const css = extractStyles(content);
      // Find all overflow: auto declarations
      const regex = /([.#]\w[\w-]*)\s*\{[^}]*overflow\s*:\s*auto[^}]*\}/g;
      let match = regex.exec(css);
      while (match !== null) {
        overflowAutoLocations.push({ file, selector: match[1] });
        match = regex.exec(css);
      }
    }

    // Only gene-grid-container and stats-drawer should have overflow auto
    const unexpected = overflowAutoLocations.filter(
      (l) => !l.selector.includes('gene-grid-container') && !l.selector.includes('stats-drawer'),
    );

    expect(unexpected).toEqual([]);
  });
});
