import { describe, expect, it } from 'vitest';
import { initializeStats, updateStats } from '$lib/utils/geneStats.js';

describe('initializeStats — attribute view', () => {
  const stats = initializeStats('attribute', ['Toughness', 'Speed']);

  it('seeds the scalar effect counters and global gene-type counters', () => {
    expect(stats.positive).toBe(0);
    expect(stats.neutral).toBe(0);
    expect(stats['potential-positive']).toBe(0);
    expect(stats['inactive-breed']).toBe(0);
    expect(stats._dominant).toBe(0);
    expect(stats._recessive).toBe(0);
    expect(stats._mixed).toBe(0);
  });

  it('seeds a per-attribute entry for each attribute name', () => {
    expect(stats.Toughness).toEqual({ positive: 0, negative: 0, dominant: 0, recessive: 0, mixed: 0 });
    expect(stats.Speed).toEqual({ positive: 0, negative: 0, dominant: 0, recessive: 0, mixed: 0 });
  });
});

describe('initializeStats — appearance view', () => {
  it('seeds appearance-neutral, inactive-breed, and a zero per appearance key', () => {
    const stats = initializeStats('appearance', ['coat', 'hair']);
    expect(stats).toEqual({ 'appearance-neutral': 0, 'inactive-breed': 0, coat: 0, hair: 0 });
  });
});

describe('updateStats — attribute view', () => {
  it('counts a confirmed positive on its attribute and the global counters', () => {
    const stats = initializeStats('attribute', ['Toughness']);
    updateStats(stats, { type: 'positive', attribute: 'Toughness' }, 'D', 'attribute');
    expect(stats.positive).toBe(1);
    expect(stats._dominant).toBe(1);
    expect(stats.Toughness).toEqual({ positive: 1, negative: 0, dominant: 1, recessive: 0, mixed: 0 });
  });

  it('counts a potential effect in the scalar bucket but not as positive/negative on the attribute', () => {
    const stats = initializeStats('attribute', ['Toughness']);
    updateStats(stats, { type: 'potential-positive', attribute: 'Toughness' }, 'R', 'attribute');
    expect(stats['potential-positive']).toBe(1);
    expect(stats._recessive).toBe(1);
    expect(stats.Toughness).toEqual({ positive: 0, negative: 0, dominant: 0, recessive: 1, mixed: 0 });
  });

  it('skips inactive-breed genes from every bucket except its own counter', () => {
    const stats = initializeStats('attribute', ['Toughness']);
    updateStats(stats, { type: 'inactive-breed', attribute: null }, 'D', 'attribute');
    expect(stats['inactive-breed']).toBe(1);
    expect(stats._dominant).toBe(0);
    expect(stats.positive).toBe(0);
  });
});

describe('updateStats — appearance view', () => {
  it('counts the appearance category and ignores per-attribute breakdown', () => {
    const stats = initializeStats('appearance', ['coat']);
    updateStats(stats, { type: 'coat', attribute: 'coat' }, 'D', 'appearance');
    expect(stats.coat).toBe(1);
  });

  it('still skips inactive-breed genes', () => {
    const stats = initializeStats('appearance', ['coat']);
    updateStats(stats, { type: 'inactive-breed', attribute: null }, 'D', 'appearance');
    expect(stats['inactive-breed']).toBe(1);
    expect(stats.coat).toBe(0);
  });
});
