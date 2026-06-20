import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FilterBar from '$lib/components/shared/FilterBar.svelte';

type Props = ComponentProps<typeof FilterBar>;

function mount(over: Partial<Props> = {}) {
  const onSearch = vi.fn();
  const utils = render(FilterBar, { search: '', onSearch, ...over } as unknown as Props);
  return { ...utils, onSearch };
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const search = (c: HTMLElement) => c.querySelector('[data-testid="filter-search"]') as HTMLInputElement;

afterEach(cleanup);

describe('FilterBar', () => {
  it('renders the search box with placeholder and value, and fires onSearch on input', async () => {
    const { container, onSearch } = mount({ search: 'roach', searchPlaceholder: 'Find…' });
    expect(search(container).value).toBe('roach');
    expect(search(container).placeholder).toBe('Find…');
    await fireEvent.input(search(container), { target: { value: 'bee' } });
    expect(onSearch).toHaveBeenCalledWith('bee');
  });

  it('hides optional sections when their props are omitted', () => {
    const { container } = mount();
    expect(q(container, '[data-testid="filter-species"]')).toBeNull();
    expect(q(container, '[data-testid="breed-selector"]')).toBeNull();
    expect(q(container, '[data-testid="filter-flags"]')).toBeNull();
  });

  it('renders the species toggle with All + each option and reflects the active one', () => {
    const { container } = mount({ species: ['beewasp', 'horse'], activeSpecies: 'horse' });
    const seg = q(container, '[data-testid="filter-species"]') as HTMLElement;
    const btns = seg.querySelectorAll('.fb-seg-btn');
    expect([...btns].map((b) => b.getAttribute('data-species'))).toEqual(['', 'beewasp', 'horse']);
    expect(seg.querySelector('[data-species="horse"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(seg.querySelector('[data-species=""]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('fires onSpecies with the species value, and "" for All', async () => {
    const onSpecies = vi.fn();
    const { container } = mount({ species: ['beewasp', 'horse'], activeSpecies: 'horse', onSpecies });
    await fireEvent.click(container.querySelector('[data-species="beewasp"]') as HTMLButtonElement);
    await fireEvent.click(container.querySelector('[data-species=""]') as HTMLButtonElement);
    expect(onSpecies).toHaveBeenNthCalledWith(1, 'beewasp');
    expect(onSpecies).toHaveBeenNthCalledWith(2, '');
  });

  it('renders the shared BreedSelector when breeds are provided and forwards selection', async () => {
    const onBreed = vi.fn();
    const { container } = mount({ breeds: { Standardbred: 'Sb', Kurbone: 'Kb' }, breed: '', onBreed });
    const trigger = container.querySelector('[data-testid="breed-selector-trigger"]') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    await fireEvent.click(trigger);
    await fireEvent.click(container.querySelector('.bs-opt[data-breed="Kurbone"]') as HTMLButtonElement);
    expect(onBreed).toHaveBeenCalledWith('Kurbone');
  });

  it('renders flag pills reflecting active state and toggles them', async () => {
    const onToggleFlag = vi.fn();
    const { container } = mount({
      flags: [
        { key: 'starred', label: '★ Starred', active: false },
        { key: 'stabled', label: '🏠 Stabled', active: true },
      ],
      onToggleFlag,
    });
    const pills = container.querySelectorAll('.fb-pill');
    expect(pills).toHaveLength(2);
    expect(container.querySelector('[data-flag="stabled"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-flag="starred"]')?.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(container.querySelector('[data-flag="starred"]') as HTMLButtonElement);
    expect(onToggleFlag).toHaveBeenCalledExactlyOnceWith('starred');
  });
});
