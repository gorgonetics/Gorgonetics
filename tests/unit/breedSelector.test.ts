import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BreedSelector from '$lib/components/shared/BreedSelector.svelte';

type Props = ComponentProps<typeof BreedSelector>;

const BREEDS = { Standardbred: 'Sb', Kurbone: 'Kb', Ilmarian: 'Il' };

function mount(over: Partial<Props> = {}) {
  const onChange = vi.fn();
  const utils = render(BreedSelector, {
    value: '',
    breeds: BREEDS,
    onChange,
    ...over,
  } as unknown as Props);
  return { ...utils, onChange };
}

const trigger = (c: HTMLElement) => c.querySelector('[data-testid="breed-selector-trigger"]') as HTMLButtonElement;
const pop = (c: HTMLElement) => c.querySelector('[data-testid="breed-selector-pop"]');
const opt = (c: HTMLElement, breed: string) => c.querySelector(`.bs-opt[data-breed="${breed}"]`) as HTMLButtonElement;

afterEach(cleanup);

describe('BreedSelector', () => {
  it('shows the all-label on the trigger and keeps the popover closed initially', () => {
    const { container } = mount();
    expect(trigger(container).textContent).toContain('Breed:');
    expect(trigger(container).textContent).toContain('All');
    expect(trigger(container).getAttribute('aria-expanded')).toBe('false');
    expect(pop(container)).toBeNull();
  });

  it('shows the selected breed name on the trigger', () => {
    const { container } = mount({ value: 'Kurbone' });
    expect(trigger(container).querySelector('.bs-value')?.textContent).toBe('Kurbone');
  });

  it('honors a custom label', () => {
    const { container } = mount({ label: 'Offspring breed' });
    expect(trigger(container).textContent).toContain('Offspring breed:');
  });

  it('opens on trigger click and lists All + every breed with its abbreviation', async () => {
    const { container } = mount();
    await fireEvent.click(trigger(container));
    expect(pop(container)).not.toBeNull();
    expect(trigger(container).getAttribute('aria-expanded')).toBe('true');
    // All option plus one per breed.
    expect(container.querySelectorAll('.bs-opt')).toHaveLength(1 + Object.keys(BREEDS).length);
    const sb = opt(container, 'Standardbred');
    expect(sb.textContent).toContain('Standardbred');
    expect(sb.textContent).toContain('Sb');
  });

  it('selecting a breed calls onChange with its name and closes the popover', async () => {
    const { container, onChange } = mount();
    await fireEvent.click(trigger(container));
    await fireEvent.click(opt(container, 'Ilmarian'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Ilmarian');
    expect(pop(container)).toBeNull();
  });

  it('selecting All clears the filter (onChange with empty string)', async () => {
    const { container, onChange } = mount({ value: 'Kurbone' });
    await fireEvent.click(trigger(container));
    await fireEvent.click(opt(container, ''));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('');
  });

  it('does not fire onChange when the already-selected value is re-picked', async () => {
    const { container, onChange } = mount({ value: 'Kurbone' });
    await fireEvent.click(trigger(container));
    await fireEvent.click(opt(container, 'Kurbone'));
    expect(onChange).not.toHaveBeenCalled();
    expect(pop(container)).toBeNull(); // still closes
  });

  it('marks the current value as pressed/selected in the list', async () => {
    const { container } = mount({ value: 'Standardbred' });
    await fireEvent.click(trigger(container));
    expect(opt(container, 'Standardbred').getAttribute('aria-pressed')).toBe('true');
    expect(opt(container, 'Kurbone').getAttribute('aria-pressed')).toBe('false');
    expect(opt(container, '').getAttribute('aria-pressed')).toBe('false');
  });

  it('closes on Escape', async () => {
    const { container } = mount();
    await fireEvent.click(trigger(container));
    expect(pop(container)).not.toBeNull();
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(pop(container)).toBeNull();
  });

  it('closes on an outside click', async () => {
    const { container } = mount();
    await fireEvent.click(trigger(container));
    expect(pop(container)).not.toBeNull();
    await fireEvent.click(document.body);
    expect(pop(container)).toBeNull();
  });

  it('stays open when clicking inside the popover chrome (non-option area)', async () => {
    const { container } = mount();
    await fireEvent.click(trigger(container));
    await fireEvent.click(pop(container) as Element);
    expect(pop(container)).not.toBeNull();
  });
});
