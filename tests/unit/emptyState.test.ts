import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EmptyState from '$lib/components/shared/EmptyState.svelte';

type Props = ComponentProps<typeof EmptyState>;

function mount(over: Partial<Props> = {}) {
  return render(EmptyState, { title: 'Pick a pet', ...over } as unknown as Props);
}

afterEach(cleanup);

describe('EmptyState', () => {
  it('renders the title', () => {
    const { container } = mount();
    expect(container.querySelector('.es-title')?.textContent).toBe('Pick a pet');
  });

  it('renders the body when provided', () => {
    const { container } = mount({ body: 'Choose one from the list.' });
    expect(container.querySelector('.es-body')?.textContent).toBe('Choose one from the list.');
  });

  it('omits the body element when not provided', () => {
    const { container } = mount();
    expect(container.querySelector('.es-body')).toBeNull();
  });

  it('renders the icon when provided', () => {
    const { container } = mount({ icon: '🐾' });
    expect(container.querySelector('[data-testid="empty-state-icon"]')?.textContent).toBe('🐾');
  });

  it('omits the icon when not provided', () => {
    const { container } = mount();
    expect(container.querySelector('[data-testid="empty-state-icon"]')).toBeNull();
  });

  it('shows the action and fires onAction only when both label and handler are given', async () => {
    const onAction = vi.fn();
    const { container } = mount({ actionLabel: 'Upload genome', onAction });
    const btn = container.querySelector('[data-testid="empty-state-action"]') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe('Upload genome');
    await fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('hides the action when the label is missing even if a handler is passed', () => {
    const { container } = mount({ onAction: vi.fn() });
    expect(container.querySelector('[data-testid="empty-state-action"]')).toBeNull();
  });

  it('hides the action when the handler is missing even if a label is passed', () => {
    const { container } = mount({ actionLabel: 'Do it' });
    expect(container.querySelector('[data-testid="empty-state-action"]')).toBeNull();
  });
});
