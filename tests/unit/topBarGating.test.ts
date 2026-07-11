import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// While a root overlay (Settings / Pet Editor) is open, the TopBar gates
// destination navigation: switching the tab underneath the overlay would
// desync the nav highlight from what's visible and could bypass the editor's
// unsaved-changes guard (#396).

vi.mock('$lib/services/petService.js', () => ({
  updatePet: vi.fn(),
  getAllPets: vi.fn(),
  deletePet: vi.fn(),
  uploadPet: vi.fn(),
}));

// Stub DataMenu — it drags in backup/file services and is irrelevant here.
vi.mock('$lib/components/layout/DataMenu.svelte', async () => ({
  default: (await import('./fixtures/ChildStub.svelte')).default,
}));

import TopBar from '$lib/components/layout/TopBar.svelte';
import { activeTab, appState, canGoBack } from '$lib/stores/pets.js';
import { editingPet, settingsOpen } from '$lib/stores/ui.js';
import type { Pet } from '$lib/types/index.js';

beforeEach(() => {
  let guard = 0;
  while (get(canGoBack) && guard++ < 200) appState.goBack();
  activeTab.set('mypets');
  settingsOpen.set(false);
  editingPet.set(null);
});

afterEach(cleanup);

const tabButton = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="tab-${id}"]`) as HTMLButtonElement;

describe('TopBar nav gating while a root overlay is open', () => {
  it('destination buttons are enabled with no overlay open', () => {
    const { container } = render(TopBar);
    for (const id of ['mypets', 'breed', 'community', 'reference']) {
      expect(tabButton(container, id).disabled).toBe(false);
    }
  });

  it('disables destination buttons and the settings toggle while Settings is open', () => {
    settingsOpen.set(true);
    const { container } = render(TopBar);
    for (const id of ['mypets', 'breed', 'community', 'reference']) {
      expect(tabButton(container, id).disabled).toBe(true);
    }
    expect((container.querySelector('.settings-toggle') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables destination buttons while the pet editor is open', () => {
    editingPet.set({ id: 1, name: 'Dobbin' } as Pet);
    const { container } = render(TopBar);
    for (const id of ['mypets', 'breed', 'community', 'reference']) {
      expect(tabButton(container, id).disabled).toBe(true);
    }
  });

  it('re-enables the nav when the overlay closes', async () => {
    settingsOpen.set(true);
    const { container } = render(TopBar);
    expect(tabButton(container, 'breed').disabled).toBe(true);

    settingsOpen.set(false);
    await Promise.resolve();
    expect(tabButton(container, 'breed').disabled).toBe(false);
  });

  it('a gated destination click does not switch the tab', async () => {
    settingsOpen.set(true);
    const { container } = render(TopBar);

    await fireEvent.click(tabButton(container, 'community'));
    expect(get(activeTab)).toBe('mypets');
  });

  it('disables the history back button while an overlay is open', () => {
    appState.switchTab('community'); // gives goBack a target
    settingsOpen.set(true);
    const { container } = render(TopBar);
    expect((container.querySelector('.back-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('gates the Alt+Left keyboard back-navigation but still suppresses the browser gesture', async () => {
    appState.switchTab('community');
    settingsOpen.set(true);
    render(TopBar);

    // Gated: no tab switch, but the default (webview history back) is still
    // prevented so the app shell can't be navigated away.
    const notPrevented = await fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    expect(get(activeTab)).toBe('community');
    expect(notPrevented).toBe(false);

    settingsOpen.set(false);
    await fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    expect(get(activeTab)).toBe('mypets');
  });

  it('gates the mouse back-button navigation but still suppresses the browser gesture', async () => {
    appState.switchTab('community');
    settingsOpen.set(true);
    render(TopBar);

    const notPrevented = await fireEvent.mouseUp(window, { button: 3 });
    expect(get(activeTab)).toBe('community');
    expect(notPrevented).toBe(false);

    // The forward button is suppressed too (it has no in-app meaning).
    const fwdNotPrevented = await fireEvent.mouseUp(window, { button: 4 });
    expect(fwdNotPrevented).toBe(false);
  });
});
