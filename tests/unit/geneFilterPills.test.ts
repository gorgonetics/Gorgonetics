import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GeneFilterPills, { type FilterPillItem } from '$lib/components/shared/GeneFilterPills.svelte';

// The shared tri-state focus/hide filter row used by the Compare diff controls
// (attributes + appearances) and the Trio view (attributes). Click = focus,
// Ctrl/⌘+click = multi-select, Alt+click = hide. The component is
// presentational; the caller owns selected/hidden + the toggle logic.

const ITEMS: FilterPillItem[] = [
  { key: 'toughness', name: 'Toughness', icon: '💪' },
  { key: 'intelligence', name: 'Intelligence', icon: '🧠' },
];

const APPEARANCE_ITEMS: FilterPillItem[] = [{ key: 'coat', name: 'Coat', swatch: '#e74c3c' }];

function setup(overrides: Record<string, unknown> = {}) {
  const onToggle = vi.fn();
  const onReset = vi.fn();
  const { container } = render(GeneFilterPills, {
    label: 'Attribute',
    items: ITEMS,
    selected: [],
    hidden: [],
    onToggle,
    onReset,
    ...overrides,
  } as never);
  return { container, onToggle, onReset };
}

const pills = (c: HTMLElement) => [...c.querySelectorAll('.gfp-btn')] as HTMLButtonElement[];
const pill = (c: HTMLElement, name: string) => pills(c).find((b) => b.textContent?.includes(name)) as HTMLButtonElement;

afterEach(cleanup);

describe('GeneFilterPills', () => {
  it('renders an All reset pill plus one pill per item', () => {
    const { container } = setup();
    const labels = pills(container).map((b) => b.textContent?.trim());
    expect(labels[0]).toBe('All');
    expect(labels.some((l) => l?.includes('Toughness'))).toBe(true);
    expect(labels.some((l) => l?.includes('Intelligence'))).toBe(true);
    expect(pills(container)).toHaveLength(3);
  });

  it('plain click focuses (no modifier flags)', async () => {
    const { container, onToggle } = setup();
    await fireEvent.click(pill(container, 'Toughness'));
    expect(onToggle).toHaveBeenCalledWith('toughness', false, false);
  });

  it('Ctrl/⌘+click multi-selects', async () => {
    const { container, onToggle } = setup();
    await fireEvent.click(pill(container, 'Intelligence'), { ctrlKey: true });
    expect(onToggle).toHaveBeenCalledWith('intelligence', true, false);
    await fireEvent.click(pill(container, 'Intelligence'), { metaKey: true });
    expect(onToggle).toHaveBeenLastCalledWith('intelligence', true, false);
  });

  it('Alt+click hides', async () => {
    const { container, onToggle } = setup();
    await fireEvent.click(pill(container, 'Toughness'), { altKey: true });
    expect(onToggle).toHaveBeenCalledWith('toughness', false, true);
  });

  it('clicking All calls onReset, not onToggle', async () => {
    const { container, onToggle, onReset } = setup();
    await fireEvent.click(pill(container, 'All'));
    expect(onReset).toHaveBeenCalledOnce();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('reflects selected/hidden as active / hidden-pill classes', () => {
    const { container } = setup({ selected: ['toughness'], hidden: ['intelligence'] });
    expect(pill(container, 'Toughness')).toHaveClass('active');
    expect(pill(container, 'Intelligence')).toHaveClass('hidden-pill');
    // With a selection active, the All pill is no longer the active one.
    expect(pill(container, 'All')).not.toHaveClass('active');
  });

  it('All is active only when nothing is selected or hidden', () => {
    const { container } = setup();
    expect(pill(container, 'All')).toHaveClass('active');
  });

  it('renders a colour swatch for appearance-style items', () => {
    const { container } = setup({ label: 'Appearance', items: APPEARANCE_ITEMS });
    const coat = pill(container, 'Coat');
    expect(coat.querySelector('.gfp-swatch')).toBeInTheDocument();
    // The colour var is set on the pill; the swatch span reads it via var().
    expect(coat.style.getPropertyValue('--swatch-color')).toBe('#e74c3c');
  });

  it('renders the icon as its own element so the row gap spaces it from the label', () => {
    const { container } = setup();
    const icon = pill(container, 'Toughness').querySelector('.gfp-icon');
    expect(icon).toBeInTheDocument();
    expect(icon?.textContent).toBe('💪');
  });

  it('still renders a swatch for an empty colour (grey fallback, matching the grid)', () => {
    const { container } = setup({ label: 'Appearance', items: [{ key: 'coat', name: 'Coat', swatch: '' }] });
    expect(pill(container, 'Coat').querySelector('.gfp-swatch')).toBeInTheDocument();
  });

  it('exposes tri-state via aria-pressed (true=focus, mixed=hidden, false=neither)', () => {
    const { container } = setup({ selected: ['toughness'], hidden: ['intelligence'] });
    expect(pill(container, 'Toughness')).toHaveAttribute('aria-pressed', 'true');
    expect(pill(container, 'Intelligence')).toHaveAttribute('aria-pressed', 'mixed');
  });

  it('marks a neutral pill aria-pressed=false and All pressed when nothing is filtered', () => {
    const { container } = setup();
    expect(pill(container, 'Toughness')).toHaveAttribute('aria-pressed', 'false');
    expect(pill(container, 'All')).toHaveAttribute('aria-pressed', 'true');
  });

  it('groups the row as a labelled ARIA group', () => {
    const { container } = setup();
    const row = container.querySelector('.gfp-row');
    expect(row).toHaveAttribute('role', 'group');
    expect(row).toHaveAttribute('aria-label', 'Attribute');
  });

  it('renders the interaction hint when provided', () => {
    const { container } = setup({ hint: 'Click to focus' });
    expect(container.querySelector('.gfp-hint')?.textContent).toContain('Click to focus');
  });
});
