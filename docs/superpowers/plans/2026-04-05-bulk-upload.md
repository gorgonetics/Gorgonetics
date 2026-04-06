# Bulk Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable multi-file selection in the genome upload dialog and process files sequentially with a progress counter and result summary.

**Architecture:** Widen the existing file picker to return multiple paths, add a lightweight `uploadPetQuiet` store method that skips reload, and loop in the PetList component with progress tracking. One `loadPets()` call at the end.

**Tech Stack:** TypeScript, Svelte 5, Tauri dialog plugin, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/services/fileService.ts` | Modify | Multi-file picker (`pickGenomeFiles`) |
| `src/lib/stores/pets.js` | Modify | Add `uploadPetQuiet` method |
| `src/lib/components/pet/PetList.svelte` | Modify | Bulk upload loop, progress counter, summary |
| `tests/unit/petService.test.js` | Modify | Test sequential multi-upload |

---

### Task 1: Multi-file picker and store method

**Files:**
- Modify: `src/lib/services/fileService.ts:9-24`
- Modify: `src/lib/stores/pets.js:86-100`

- [ ] **Step 1: Change `pickFile` to support multiple selection**

In `src/lib/services/fileService.ts`, replace the `pickFile` function and `pickGenomeFile` export:

```ts
async function pickFiles(title: string, filterName: string, extensions: string[]): Promise<string[]> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: true,
      filters: [{ name: filterName, extensions }],
      title,
    });
    if (Array.isArray(result)) return result;
    if (typeof result === 'string') return [result];
    return [];
  }
  return [];
}

export function pickGenomeFiles(): Promise<string[]> {
  return pickFiles('Select Genome Files', 'Genome Files', ['txt']);
}
```

Also update `pickBackupFile` to use the old single-file behavior. Since `pickBackupFile` should stay single-select, keep a separate helper:

```ts
async function pickSingleFile(title: string, filterName: string, extensions: string[]): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: false,
      filters: [{ name: filterName, extensions }],
      title,
    });
    return typeof result === 'string' ? result : null;
  }
  return null;
}

export function pickBackupFile(): Promise<string | null> {
  return pickSingleFile('Import Gorgonetics Backup', 'Backup Files', ['zip', 'json']);
}
```

- [ ] **Step 2: Add `uploadPetQuiet` to the store**

In `src/lib/stores/pets.js`, add this method after the existing `uploadPet` method (after line 100):

```js
  async uploadPetQuiet(file, petName, petGender = 'Male') {
    return apiClient.uploadPet(file, petName, petGender, null);
  },
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `pnpm test`

Expected: All 124 tests PASS (no behavior change to uploadPet or petService).

- [ ] **Step 4: Lint**

Run: `pnpm run lint:fix`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/fileService.ts src/lib/stores/pets.js
git commit -m "feat: multi-file picker and uploadPetQuiet store method"
```

---

### Task 2: Bulk upload loop in PetList

**Files:**
- Modify: `src/lib/components/pet/PetList.svelte`

- [ ] **Step 1: Update the import and handleUpload function**

In `src/lib/components/pet/PetList.svelte`, replace the import and state/function:

Change line 2 from:
```js
import { pickGenomeFile, readFileContent } from '$lib/services/fileService.js';
```
to:
```js
import { pickGenomeFiles, readFileContent } from '$lib/services/fileService.js';
```

Replace the `uploading` state variable (line 8):
```js
let uploading = $state(false);
let uploadProgress = $state(null);
```

Replace the entire `handleUpload` function (lines 25-38):
```js
async function handleUpload() {
  try {
    const filePaths = await pickGenomeFiles();
    if (filePaths.length === 0) return;

    uploading = true;
    error.set(null);
    const total = filePaths.length;
    const failures = [];

    // Sequential upload — consider parallel with concurrency limit if this becomes a bottleneck
    for (let i = 0; i < filePaths.length; i++) {
      uploadProgress = { current: i + 1, total };
      try {
        const content = await readFileContent(filePaths[i]);
        const result = await appState.uploadPetQuiet(content, '', 'Male');
        if (result.status === 'error') {
          const fileName = filePaths[i].split('/').pop() || filePaths[i];
          failures.push(`${fileName}: ${result.message}`);
        }
      } catch (err) {
        const fileName = filePaths[i].split('/').pop() || filePaths[i];
        failures.push(`${fileName}: ${err.message}`);
      }
    }

    await appState.loadPets();

    if (failures.length > 0) {
      const succeeded = total - failures.length;
      error.set(`${succeeded}/${total} uploaded. ${failures.length} failed:\n${failures.join('\n')}`);
    }
  } catch (err) {
    error.set(`Upload failed: ${err.message}`);
  } finally {
    uploading = false;
    uploadProgress = null;
  }
}
```

- [ ] **Step 2: Update the button text**

In the template, replace the upload button text (line 111):

From:
```svelte
{uploading ? 'Uploading...' : '+ Upload Genome'}
```

To:
```svelte
{#if uploadProgress}
    Uploading... ({uploadProgress.current}/{uploadProgress.total})
{:else}
    + Upload Genome
{/if}
```

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`

Expected: All 124 tests PASS.

- [ ] **Step 4: Lint**

Run: `pnpm run lint:fix`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/pet/PetList.svelte
git commit -m "feat: bulk upload with progress counter and error summary"
```

---

### Task 3: Integration test for sequential multi-upload

**Files:**
- Modify: `tests/unit/petService.test.js`

- [ ] **Step 1: Add multi-upload test**

Add to the `uploadPet` describe block in `tests/unit/petService.test.js`, after the existing tests:

```js
it('handles multiple sequential uploads', async () => {
  // Upload the same beewasp with different content to avoid duplicate detection
  const result1 = await petService.uploadPet(SAMPLE_BEEWASP, 'Bee One', 'Female');
  expect(result1.status).toBe('success');

  const result2 = await petService.uploadPet(SAMPLE_HORSE, 'Horse One', 'Male');
  expect(result2.status).toBe('success');

  const { items, total } = await petService.getAllPets();
  expect(total).toBe(2);
  expect(items.map((p) => p.name).sort()).toEqual(['Bee One', 'Horse One']);
});

it('returns error for duplicates during sequential upload', async () => {
  const result1 = await petService.uploadPet(SAMPLE_BEEWASP, 'First', 'Female');
  expect(result1.status).toBe('success');

  const result2 = await petService.uploadPet(SAMPLE_BEEWASP, 'Second', 'Female');
  expect(result2.status).toBe('error');
  expect(result2.message).toContain('already been uploaded');

  // Only the first should be in the DB
  const { total } = await petService.getAllPets();
  expect(total).toBe(1);
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm test -- tests/unit/petService.test.js`

Expected: All tests PASS (these test existing behavior in a bulk-like pattern).

- [ ] **Step 3: Lint**

Run: `pnpm run lint:fix`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/petService.test.js
git commit -m "test: add sequential multi-upload integration tests"
```
