import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BreedingPoolPanel from '$lib/components/breeding/BreedingPoolPanel.svelte';
import type { Pet } from '$lib/types/index.js';

const pet = (over: Partial<Pet>): Pet =>
  ({
    id: 0,
    name: 'Pet',
    species: 'Horse',
    breed: 'Standardbred',
    gender: 'Female',
    tags: [],
    stabled: true,
    positive_genes: 0,
    ...over,
  }) as unknown as Pet;

const POOL = [
  pet({ id: 1, name: 'Dusty', gender: 'Male' }),
  pet({ id: 2, name: 'Bolt', gender: 'Male' }),
  pet({ id: 3, name: 'Roach', gender: 'Female' }),
  pet({ id: 4, name: 'Mabel', gender: 'Female' }),
];

const props = (over: Record<string, unknown> = {}) => ({
  pool: POOL,
  benchedIds: new Set<number>(),
  onToggle: vi.fn(),
  onClearBench: vi.fn(),
  ...over,
});

afterEach(cleanup);

const expand = async (container: HTMLElement) => {
  await fireEvent.click(container.querySelector('.pool-toggle') as HTMLButtonElement);
};

describe('BreedingPoolPanel', () => {
  it('is collapsed by default and shows available/benched counts', async () => {
    const { container, rerender } = render(BreedingPoolPanel, props({ benchedIds: new Set([1]) }));
    await rerender({});
    expect(container.querySelector('[data-testid="pool-chip"]')).toBeNull();
    expect(container.querySelector('.counts')?.textContent).toContain('3 available');
    expect(container.querySelector('.counts')?.textContent).toContain('1 benched');
  });

  it('renders one chip per animal when expanded', async () => {
    const { container, rerender } = render(BreedingPoolPanel, props());
    await rerender({});
    await expand(container);
    expect(container.querySelectorAll('[data-testid="pool-chip"]').length).toBe(POOL.length);
  });

  it('calls onToggle with the pet id when a chip is clicked', async () => {
    const onToggle = vi.fn();
    const { container, rerender } = render(BreedingPoolPanel, props({ onToggle }));
    await rerender({});
    await expand(container);
    const chip = container.querySelector('[data-pet-id="2"]') as HTMLButtonElement;
    await fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith(2);
  });

  it('marks benched chips as pressed and struck through', async () => {
    const { container, rerender } = render(BreedingPoolPanel, props({ benchedIds: new Set([3]) }));
    await rerender({});
    await expand(container);
    const chip = container.querySelector('[data-pet-id="3"]') as HTMLButtonElement;
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.classList.contains('benched')).toBe(true);
  });

  it('shows Return all only when something is benched, and it clears', async () => {
    const onClearBench = vi.fn();
    const { container, rerender } = render(BreedingPoolPanel, props());
    await rerender({});
    expect(container.querySelector('[data-testid="pool-return-all"]')).toBeNull();

    await rerender(props({ benchedIds: new Set([1]), onClearBench }));
    const btn = container.querySelector('[data-testid="pool-return-all"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await fireEvent.click(btn);
    expect(onClearBench).toHaveBeenCalledOnce();
  });
});
