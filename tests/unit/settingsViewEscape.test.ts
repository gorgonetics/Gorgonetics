import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Settings is an in-space DetailOverlay lens, so it must close on Escape like
// the pet detail and the Pet Editor — including when focus sits on
// document.body rather than inside the overlay (#396).

vi.mock('$lib/services/settingsService.js', () => ({
  getAllSettings: vi.fn().mockResolvedValue({}),
  getDefaultSettings: () => ({}),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

import SettingsView from '$lib/components/layout/SettingsView.svelte';

afterEach(cleanup);

describe('SettingsView Escape handling', () => {
  it('renders as a labelled settings region', () => {
    const { container } = render(SettingsView, { onClose: () => {} } as never);
    const view = container.querySelector('[data-testid="settings-view"]');
    expect(view).not.toBeNull();
    expect(view?.getAttribute('aria-label')).toBe('Settings');
  });

  it('closes on Escape even with focus on document.body', async () => {
    const onClose = vi.fn();
    render(SettingsView, { onClose } as never);

    (document.activeElement as HTMLElement | null)?.blur?.();
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via the back button', async () => {
    const onClose = vi.fn();
    const { container } = render(SettingsView, { onClose } as never);

    const back = container.querySelector('[data-testid="settings-back"]') as HTMLElement;
    await fireEvent.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
