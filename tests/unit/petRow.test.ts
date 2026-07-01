import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PetRow from '$lib/components/shared/PetRow.svelte';
import PetRowHarness from '../fixtures/PetRowHarness.svelte';

type Props = ComponentProps<typeof PetRow>;

function mount(over: Partial<Props> = {}) {
  return render(PetRow, { name: 'Sample Fae Bee', ...over } as unknown as Props);
}

const row = (c: HTMLElement) => c.querySelector('[data-testid="pet-row"]') as HTMLElement;
const checkbox = (c: HTMLElement) => c.querySelector('[data-testid="pet-row-select"]') as HTMLInputElement;

afterEach(cleanup);

describe('PetRow', () => {
  it('renders name, avatar, and meta in card density', () => {
    const { container } = mount({ avatar: '🐝', meta: 'BeeWasp · Female' });
    expect(container.querySelector('.pr-name')?.textContent).toBe('Sample Fae Bee');
    expect(container.querySelector('.pr-avatar')?.textContent).toBe('🐝');
    expect(container.querySelector('.pr-meta')?.textContent).toBe('BeeWasp · Female');
  });

  it('applies the density class', () => {
    const { container } = mount({ density: 'row' });
    expect(row(container).classList.contains('density-row')).toBe(true);
  });

  it('hides the checkbox unless selectable', () => {
    const { container } = mount();
    expect(checkbox(container)).toBeNull();
  });

  it('shows the checkbox reflecting selected state when selectable', () => {
    const { container } = mount({ selectable: true, selected: true });
    expect(checkbox(container)).not.toBeNull();
    expect(checkbox(container).checked).toBe(true);
  });

  it('activates on row click', async () => {
    const onActivate = vi.fn();
    const { container } = mount({ onActivate });
    await fireEvent.click(row(container));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('activates on Enter and Space', async () => {
    const onActivate = vi.fn();
    const { container } = mount({ onActivate });
    await fireEvent.keyDown(row(container), { key: 'Enter' });
    await fireEvent.keyDown(row(container), { key: ' ' });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('toggling the checkbox fires onToggleSelect but NOT onActivate', async () => {
    const onActivate = vi.fn();
    const onToggleSelect = vi.fn();
    const { container } = mount({ selectable: true, onActivate, onToggleSelect });
    await fireEvent.click(checkbox(container));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('a key press bubbling from the checkbox does not activate the row', async () => {
    const onActivate = vi.fn();
    const { container } = mount({ selectable: true, onActivate });
    // Space/Enter while the checkbox is focused must reach the checkbox, not be
    // hijacked by the row's activate handler.
    await fireEvent.keyDown(checkbox(container), { key: ' ', bubbles: true });
    await fireEvent.keyDown(checkbox(container), { key: 'Enter', bubbles: true });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('marks the active row with aria-current', () => {
    const { container } = mount({ active: true });
    expect(row(container).getAttribute('aria-current')).toBe('true');
    expect(row(container).classList.contains('active')).toBe(true);
  });

  it('omits aria-current when not active', () => {
    const { container } = mount();
    expect(row(container).getAttribute('aria-current')).toBeNull();
  });

  it('renders the trailing snippet, and clicking it does not activate the row', async () => {
    const onActivate = vi.fn();
    const onTrailing = vi.fn();
    const { container } = render(PetRowHarness, { name: 'Roach', onActivate, onTrailing } as never);
    const btn = container.querySelector('[data-testid="harness-trailing-btn"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await fireEvent.click(btn);
    expect(onTrailing).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });
});
