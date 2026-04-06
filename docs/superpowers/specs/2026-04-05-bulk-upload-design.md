# Bulk Upload Genome Files

**Date:** 2026-04-05
**Status:** Approved

## Problem

Users must upload genome files one at a time. With dozens or hundreds of pets, this is tedious. The existing "Upload Genome" button opens a single-file picker.

## Solution

Make the existing "Upload Genome" button support multi-file selection. Files are uploaded sequentially. A progress counter shows in the button. A summary is shown at the end with success/failure counts.

## Scope

- Same button, same flow — just multi-select enabled
- Sequential uploads (with comment noting potential upgrade to parallel if bottleneck observed)
- No new UI elements beyond progress text in the existing button and error/success messages

## Design

### File picker: `pickGenomeFiles`

Rename `pickGenomeFile` to `pickGenomeFiles` in `fileService.ts`. Change Tauri `open` dialog to `multiple: true`. Return `string[]` (empty array if cancelled).

### Store: `uploadPetQuiet`

Add `uploadPetQuiet(content, name, gender)` to the `appState` store. Same as `uploadPet` but does not call `loadPets()` after each upload. The caller is responsible for reloading once at the end.

### PetList: bulk upload loop

`handleUpload` in `PetList.svelte`:

1. Open file picker (multi-select). If no files selected, return.
2. Set `uploading = true`. Initialize progress state `{ current: 0, total: files.length }`.
3. Loop sequentially over files:
   - Read file content via `readFileContent(path)`
   - Call `appState.uploadPetQuiet(content, '', 'Male')`
   - Increment progress counter
   - Collect result `{ fileName, status, message }`
4. Call `appState.loadPets()` once.
5. Set `uploading = false`.
6. Show summary:
   - If all succeeded and count > 1: set success message
   - If any failed: set error message with failure count and reasons
   - If only one file and it succeeded: no message (same as current behavior)

### Button text

- Idle: `"+ Upload Genome"`
- In progress: `"Uploading... (3/12)"`
- Disabled while uploading

## Files Changed

| File | Change |
|------|--------|
| `src/lib/services/fileService.ts` | Rename `pickGenomeFile` -> `pickGenomeFiles`, `multiple: true`, return `string[]` |
| `src/lib/stores/pets.js` | Add `uploadPetQuiet` method |
| `src/lib/components/pet/PetList.svelte` | Bulk upload loop, progress counter, result summary |
| `tests/unit/petService.test.js` | Test sequential multi-upload |

## Testing

- Unit: upload 3 genome files sequentially, verify all 3 in DB with correct data
- Existing upload tests unchanged
- Manual: multi-select file dialog, verify progress counter and summary
