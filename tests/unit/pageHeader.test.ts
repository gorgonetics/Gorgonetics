import { cleanup, render } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PageHeader from '$lib/components/shared/PageHeader.svelte';
import PageHeaderHarness from '../fixtures/PageHeaderHarness.svelte';

type Props = ComponentProps<typeof PageHeader>;

function mount(over: Partial<Props> = {}) {
  return render(PageHeader, { title: 'Stable', ...over } as unknown as Props);
}

afterEach(cleanup);

describe('PageHeader', () => {
  it('renders the title', () => {
    const { container } = mount();
    expect(container.querySelector('.ph-title')?.textContent?.trim()).toBe('Stable');
  });

  it('renders the subtitle when provided', () => {
    const { container } = mount({ subtitle: 'Rank stabled pairs.' });
    expect(container.querySelector('[data-testid="page-header-subtitle"]')?.textContent).toBe('Rank stabled pairs.');
  });

  it('omits the subtitle when not provided', () => {
    const { container } = mount();
    expect(container.querySelector('[data-testid="page-header-subtitle"]')).toBeNull();
  });

  it('renders the icon before the title when provided', () => {
    const { container } = mount({ icon: '💞', title: 'Breeding' });
    expect(container.querySelector('.ph-icon')?.textContent).toBe('💞');
    expect(container.querySelector('.ph-title')?.textContent).toContain('Breeding');
  });

  it('omits the actions container when no actions snippet is given', () => {
    const { container } = mount();
    expect(container.querySelector('[data-testid="page-header-actions"]')).toBeNull();
  });

  it('renders the actions snippet content when provided', () => {
    const { container } = render(PageHeaderHarness, { title: 'Stable' } as never);
    const actions = container.querySelector('[data-testid="page-header-actions"]');
    expect(actions).not.toBeNull();
    expect(actions?.querySelector('[data-testid="harness-action"]')?.textContent).toBe('Do thing');
  });
});
