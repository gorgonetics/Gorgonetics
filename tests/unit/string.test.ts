import { describe, expect, it } from 'vitest';
import { capitalize, escapeHtml, pluralise } from '$lib/utils/string.js';

describe('capitalize', () => {
  it('raises the first character and leaves the rest alone', () => {
    expect(capitalize('horse')).toBe('Horse');
    expect(capitalize('beeWasp')).toBe('BeeWasp');
  });

  it('is a no-op on an empty string', () => {
    expect(capitalize('')).toBe('');
  });
});

describe('pluralise', () => {
  it('keeps the singular at one and adds an s otherwise', () => {
    expect(pluralise(1, 'Horse')).toBe('1 Horse');
    expect(pluralise(12, 'Horse')).toBe('12 Horses');
    expect(pluralise(0, 'Horse')).toBe('0 Horses');
  });

  it('works for the other species without a special case', () => {
    expect(pluralise(3, 'BeeWasp')).toBe('3 BeeWasps');
  });
});

/**
 * Used by both gene tooltips, whose lines are rendered with `{@html}` from gene
 * template DB text and genome-file text — neither of which is trusted markup.
 */
describe('escapeHtml', () => {
  it('escapes every character that could break out of an injected line', () => {
    expect(escapeHtml(`<script>&"'`)).toBe('&lt;script&gt;&amp;&quot;&#39;');
  });

  it('escapes the ampersand first, so an entity is not double-decoded', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('neutralises an injected tag rather than dropping it silently', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('leaves ordinary effect text untouched', () => {
    expect(escapeHtml('Temperament+')).toBe('Temperament+');
  });
});
