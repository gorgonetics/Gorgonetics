<script>
import '../app.css';
import AuthWrapper from '$lib/components/AuthWrapper.svelte';
import MasterPanel from '$lib/components/layout/MasterPanel.svelte';
import TopBar from '$lib/components/layout/TopBar.svelte';
import { settings, settingsActions } from '$lib/stores/settings.js';
import { applyFontScale, clampScale, getFontScale, STEP } from '$lib/utils/fontScale.js';

const { children } = $props();

const fontScale = $derived(getFontScale($settings));

async function setScale(scale) {
  const clamped = clampScale(scale);
  applyFontScale(clamped);
  await settingsActions.update('display.fontScale', clamped);
}

function handleGlobalKeydown(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    setScale(fontScale + STEP);
  } else if (e.key === '-') {
    e.preventDefault();
    setScale(fontScale - STEP);
  } else if (e.key === '0') {
    e.preventDefault();
    setScale(100);
  }
}

// Apply persisted font scale on load and when it changes
$effect(() => {
  applyFontScale(fontScale);
});
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<a class="skip-link" href="#main-content">Skip to main content</a>
<AuthWrapper>
    <div class="app-shell">
        <TopBar />
        <div class="app-body">
            <MasterPanel />
            <main id="main-content" class="detail-pane">
                {@render children()}
            </main>
        </div>
    </div>
</AuthWrapper>

<style>
    .app-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .app-body {
        display: flex;
        flex: 1;
        min-height: 0;
    }

    .detail-pane {
        flex: 1;
        overflow: hidden;
        background: #ffffff;
        min-width: 0;
        position: relative;
    }
</style>
