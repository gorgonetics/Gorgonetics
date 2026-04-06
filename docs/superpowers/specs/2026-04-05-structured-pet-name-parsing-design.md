# Structured Pet Name Parsing

**Date:** 2026-04-05
**Status:** Approved

## Problem

Gene files exported from Project Gorgon do not include breed, sex, or attribute values. Users work around this by encoding that information into the pet's in-game name using a convention:

```
<breed_shortcode> <gender> <attr1> <attr2> ... <attr7> [optional label]
```

Example: `Kb F 60 70 65 80 90 100 55 Sparkle`

Currently, all uploaded pets get default attribute values (50) and no breed. Users must manually edit every pet after upload.

## Scope

- **Horse species only.** BeeWasps do not have breeds yet and are excluded.
- If the pet name does not match the structured format, nothing changes — existing behavior is preserved.

## Name Format

For Horse pets, the `Entity=` line in the genome file may follow this pattern:

```
<breed_shortcode> <M|F> <temperament> <toughness> <ruggedness> <enthusiasm> <friendliness> <intelligence> <virility> [label...]
```

**Tokens (space-separated):**

| Position | Token | Description |
|----------|-------|-------------|
| 1 | Breed shortcode | One of: Sb, Kb, Il, Po, Sc, St, Bl, Le, Pt, Cl (case-insensitive) |
| 2 | Gender | `M` or `F` (case-insensitive) |
| 3-9 | Attribute values | 7 numeric values in UI display order (see below) |
| 10+ | Label (optional) | Any remaining tokens, joined with spaces. Ignored by parser but returned. |

**Attribute order** (matches `FALLBACK_ATTRIBUTE_LIST` filtered to Horse):

1. Temperament
2. Toughness
3. Ruggedness
4. Enthusiasm
5. Friendliness
6. Intelligence
7. Virility

**Case insensitivity:** Breed shortcodes and gender tokens are matched case-insensitively (`kb`, `KB`, `Kb` all resolve to Kurbone; `m`, `M` both resolve to Male).

## Design

### Approach: Separate name-parser module (Approach B)

The parsing logic is self-contained string interpretation. A dedicated module is easy to test in isolation and keeps the upload flow clean.

### New module: `src/lib/services/nameParser.ts`

**Function:** `parseStructuredPetName(name: string, species: string)`

**Returns:** `{ breed: string, gender: 'Male' | 'Female', attributes: Record<string, number>, label: string | null }` or `null` if the name does not match.

**Logic:**

1. If `species` is not Horse, return `null`.
2. Split `name` by whitespace.
3. If fewer than 9 tokens, return `null`.
4. Match token 1 against `HORSE_BREED_ABBREVIATIONS` (case-insensitive). If no match, return `null`.
5. Match token 2 against `M`/`F` (case-insensitive). If no match, return `null`.
6. Parse tokens 3-9 as integers. If any is `NaN`, return `null`.
7. Map the 7 values to attribute keys in order: `temperament`, `toughness`, `ruggedness`, `enthusiasm`, `friendliness`, `intelligence`, `virility`.
8. Join remaining tokens (10+) as `label`, or `null` if none.
9. Return the result with `breed` as the full breed name (e.g. `"Kurbone"`).

### Integration: `petService.ts` `uploadPet`

After the genome is parsed and `petName` is determined:

1. Call `parseStructuredPetName(petName, genome.genome_type)`.
2. If result is `null`, continue with current behavior (defaults).
3. If result is non-null:
   - Use `result.gender` instead of the `gender` function parameter.
   - Use `result.breed` for the breed column.
   - Use `result.attributes` to override the default attribute values.
   - `petName` stays as the raw Entity string (unchanged).
4. Add `breed` to the INSERT statement (currently missing — defaults to empty string when not inferred).

### No UI changes

The pet name in the database remains the raw Entity string. Breed, gender, and attributes are populated automatically. Users can still edit everything via PetEditor.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/services/nameParser.ts` | New module with `parseStructuredPetName()` |
| `src/lib/services/petService.ts` | Call parser in `uploadPet`, add `breed` to INSERT |
| `tests/unit/nameParser.test.js` | Unit tests for the parser |
| `tests/unit/petService.test.js` | Integration test for structured name upload |

## Testing

### `nameParser.test.js`

- Valid Horse name with 7 attributes parses correctly
- Valid name with trailing single-word label
- Valid name with multi-word trailing label
- Unknown breed shortcode returns `null`
- Non-Horse species returns `null`
- Too few tokens returns `null`
- Non-numeric attribute tokens returns `null`
- Regular names ("Sample Horse", "Roach") return `null`
- Case insensitivity: `kb f`, `KB F`, `Kb F` all parse correctly
- `m`/`M` and `f`/`F` both work

### `petService.test.js`

- Upload a genome file with structured Entity name -> verify breed, gender, and attributes are set correctly in the database
