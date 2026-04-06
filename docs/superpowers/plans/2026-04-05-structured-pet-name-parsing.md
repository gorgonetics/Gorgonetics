# Structured Pet Name Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-infer breed, gender, and attribute values for Horse pets when the genome file's Entity name follows the convention `<breed_shortcode> <M|F> <7 attribute values> [label]`.

**Architecture:** A new `nameParser.ts` module provides a pure function `parseStructuredPetName()` that returns parsed data or `null`. `petService.uploadPet()` calls it after genome parsing and uses the result to override defaults. No UI changes.

**Tech Stack:** TypeScript, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/services/nameParser.ts` | Create | Pure parsing function for structured pet names |
| `tests/unit/nameParser.test.js` | Create | Unit tests for the parser |
| `src/lib/services/petService.ts` | Modify | Call parser in `uploadPet`, add `breed` to INSERT |
| `tests/unit/petService.test.js` | Modify | Integration test for structured name upload |

---

### Task 1: Create `nameParser.ts` with failing tests

**Files:**
- Create: `src/lib/services/nameParser.ts`
- Create: `tests/unit/nameParser.test.js`

- [ ] **Step 1: Write the test file**

```js
// tests/unit/nameParser.test.js
import { describe, expect, it } from 'vitest';
import { parseStructuredPetName } from '$lib/services/nameParser.js';

describe('parseStructuredPetName', () => {
  describe('valid Horse names', () => {
    it('parses a standard name with all 7 attributes', () => {
      const result = parseStructuredPetName('Kb F 60 70 65 80 90 100 55', 'Horse');
      expect(result).toEqual({
        breed: 'Kurbone',
        gender: 'Female',
        attributes: {
          temperament: 60,
          toughness: 70,
          ruggedness: 65,
          enthusiasm: 80,
          friendliness: 90,
          intelligence: 100,
          virility: 55,
        },
        label: null,
      });
    });

    it('parses a name with a single-word label', () => {
      const result = parseStructuredPetName('Sc M 50 60 70 80 90 55 65 Sparkle', 'Horse');
      expect(result).toEqual({
        breed: 'Satincoat',
        gender: 'Male',
        attributes: {
          temperament: 50,
          toughness: 60,
          ruggedness: 70,
          enthusiasm: 80,
          friendliness: 90,
          intelligence: 55,
          virility: 65,
        },
        label: 'Sparkle',
      });
    });

    it('parses a name with a multi-word label', () => {
      const result = parseStructuredPetName('Il F 40 50 60 70 80 90 100 My Best', 'Horse');
      expect(result).toEqual({
        breed: 'Ilmarian',
        gender: 'Female',
        attributes: {
          temperament: 40,
          toughness: 50,
          ruggedness: 60,
          enthusiasm: 70,
          friendliness: 80,
          intelligence: 90,
          virility: 100,
        },
        label: 'My Best',
      });
    });

    it('handles all breed shortcodes', () => {
      const shortcodes = ['Sb', 'Kb', 'Il', 'Po', 'Sc', 'St', 'Bl', 'Le', 'Pt', 'Cl'];
      const breeds = [
        'Standardbred', 'Kurbone', 'Ilmarian', 'Plateau Pony', 'Satincoat',
        'Statehelm', 'Blanketed', 'Leopard', 'Paint', 'Calico',
      ];
      for (let i = 0; i < shortcodes.length; i++) {
        const result = parseStructuredPetName(`${shortcodes[i]} M 50 50 50 50 50 50 50`, 'Horse');
        expect(result).not.toBeNull();
        expect(result.breed).toBe(breeds[i]);
      }
    });
  });

  describe('case insensitivity', () => {
    it('accepts lowercase breed shortcode', () => {
      const result = parseStructuredPetName('kb f 60 70 65 80 90 100 55', 'Horse');
      expect(result).not.toBeNull();
      expect(result.breed).toBe('Kurbone');
      expect(result.gender).toBe('Female');
    });

    it('accepts uppercase breed shortcode', () => {
      const result = parseStructuredPetName('KB M 60 70 65 80 90 100 55', 'Horse');
      expect(result).not.toBeNull();
      expect(result.breed).toBe('Kurbone');
      expect(result.gender).toBe('Male');
    });

    it('accepts mixed case gender', () => {
      const result = parseStructuredPetName('Kb m 60 70 65 80 90 100 55', 'Horse');
      expect(result).not.toBeNull();
      expect(result.gender).toBe('Male');
    });
  });

  describe('returns null for non-matching names', () => {
    it('returns null for non-Horse species', () => {
      expect(parseStructuredPetName('Kb F 60 70 65 80 90 100 55', 'BeeWasp')).toBeNull();
    });

    it('returns null for unknown breed shortcode', () => {
      expect(parseStructuredPetName('Zz F 60 70 65 80 90 100 55', 'Horse')).toBeNull();
    });

    it('returns null for invalid gender token', () => {
      expect(parseStructuredPetName('Kb X 60 70 65 80 90 100 55', 'Horse')).toBeNull();
    });

    it('returns null for too few tokens', () => {
      expect(parseStructuredPetName('Kb F 60 70 65', 'Horse')).toBeNull();
    });

    it('returns null for non-numeric attribute values', () => {
      expect(parseStructuredPetName('Kb F abc 70 65 80 90 100 55', 'Horse')).toBeNull();
    });

    it('returns null for regular pet names', () => {
      expect(parseStructuredPetName('Sample Horse', 'Horse')).toBeNull();
      expect(parseStructuredPetName('Roach', 'Horse')).toBeNull();
    });

    it('returns null for empty name', () => {
      expect(parseStructuredPetName('', 'Horse')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Create a minimal stub so the import resolves**

```ts
// src/lib/services/nameParser.ts
import { HORSE_BREED_ABBREVIATIONS } from '$lib/types/index.js';
import { normalizeSpecies } from './configService.js';

export interface StructuredPetName {
  breed: string;
  gender: 'Male' | 'Female';
  attributes: Record<string, number>;
  label: string | null;
}

export function parseStructuredPetName(_name: string, _species: string): StructuredPetName | null {
  return null;
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test -- tests/unit/nameParser.test.js`

Expected: All "valid Horse names" and "case insensitivity" tests FAIL. All "returns null" tests PASS (stub returns `null`).

- [ ] **Step 4: Implement the parser**

Replace the stub in `src/lib/services/nameParser.ts`:

```ts
// src/lib/services/nameParser.ts
import { HORSE_BREED_ABBREVIATIONS } from '$lib/types/index.js';
import { normalizeSpecies } from './configService.js';

export interface StructuredPetName {
  breed: string;
  gender: 'Male' | 'Female';
  attributes: Record<string, number>;
  label: string | null;
}

/**
 * Attribute order matching FALLBACK_ATTRIBUTE_LIST filtered to Horse.
 */
const HORSE_ATTRIBUTE_ORDER = [
  'temperament',
  'toughness',
  'ruggedness',
  'enthusiasm',
  'friendliness',
  'intelligence',
  'virility',
];

/**
 * Build a case-insensitive lookup from shortcode -> full breed name.
 */
const BREED_LOOKUP: Record<string, string> = Object.fromEntries(
  Object.entries(HORSE_BREED_ABBREVIATIONS).map(([abbr, fullName]) => [abbr.toLowerCase(), fullName]),
);

/**
 * Parse a structured pet name for Horse species.
 *
 * Format: <breed_shortcode> <M|F> <7 attribute values> [optional label...]
 *
 * Returns null if the name does not match the expected format.
 */
export function parseStructuredPetName(name: string, species: string): StructuredPetName | null {
  if (normalizeSpecies(species) !== 'horse') return null;

  const tokens = name.trim().split(/\s+/);
  if (tokens.length < 9) return null;

  // Token 1: breed shortcode
  const breedName = BREED_LOOKUP[tokens[0].toLowerCase()];
  if (!breedName) return null;

  // Token 2: gender
  const genderToken = tokens[1].toUpperCase();
  if (genderToken !== 'M' && genderToken !== 'F') return null;
  const gender: 'Male' | 'Female' = genderToken === 'M' ? 'Male' : 'Female';

  // Tokens 3-9: attribute values
  const attributes: Record<string, number> = {};
  for (let i = 0; i < HORSE_ATTRIBUTE_ORDER.length; i++) {
    const value = Number.parseInt(tokens[2 + i], 10);
    if (Number.isNaN(value)) return null;
    attributes[HORSE_ATTRIBUTE_ORDER[i]] = value;
  }

  // Remaining tokens: optional label
  const labelTokens = tokens.slice(9);
  const label = labelTokens.length > 0 ? labelTokens.join(' ') : null;

  return { breed: breedName, gender, attributes, label };
}
```

- [ ] **Step 5: Run the tests to verify they all pass**

Run: `pnpm test -- tests/unit/nameParser.test.js`

Expected: All tests PASS.

- [ ] **Step 6: Lint**

Run: `pnpm run lint:fix`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/nameParser.ts tests/unit/nameParser.test.js
git commit -m "feat: add structured pet name parser for Horse species"
```

---

### Task 2: Integrate parser into `uploadPet`

**Files:**
- Modify: `src/lib/services/petService.ts:137-216`
- Modify: `tests/unit/petService.test.js`

- [ ] **Step 1: Write the integration test**

Add to the `uploadPet` describe block in `tests/unit/petService.test.js`:

```js
it('infers breed, gender, and attributes from structured Horse name', async () => {
  // Create a Horse genome file with a structured Entity name
  const structuredHorse = SAMPLE_HORSE.replace('Entity=Sample Horse', 'Entity=Kb F 60 70 65 80 90 100 55');
  const result = await petService.uploadPet(structuredHorse, '', 'Male');
  expect(result.status).toBe('success');

  const pet = await petService.getPet(result.pet_id);
  expect(pet.breed).toBe('Kurbone');
  expect(pet.gender).toBe('Female');  // Overrides the 'Male' parameter
  expect(pet.temperament).toBe(60);
  expect(pet.toughness).toBe(70);
  expect(pet.ruggedness).toBe(65);
  expect(pet.enthusiasm).toBe(80);
  expect(pet.friendliness).toBe(90);
  expect(pet.intelligence).toBe(100);
  expect(pet.virility).toBe(55);
  // Name stays as the raw Entity string
  expect(pet.name).toBe('Kb F 60 70 65 80 90 100 55');
});

it('uses defaults when Horse name is not structured', async () => {
  const result = await petService.uploadPet(SAMPLE_HORSE, '', 'Male');
  expect(result.status).toBe('success');

  const pet = await petService.getPet(result.pet_id);
  expect(pet.breed).toBe('');
  expect(pet.gender).toBe('Male');
  expect(pet.toughness).toBe(50);
  expect(pet.temperament).toBe(50);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/unit/petService.test.js -t "infers breed"`

Expected: FAIL — breed is empty, gender is 'Male', attributes are all 50.

- [ ] **Step 3: Modify `uploadPet` in `petService.ts`**

Add the import at the top of `petService.ts`:

```ts
import { parseStructuredPetName } from './nameParser.js';
```

Replace the section from `// Determine pet name` through the `db.execute` INSERT call (lines ~172-208) with:

```ts
  // Determine pet name
  const petName = genome.name.trim() || name.trim() || 'Unknown Pet';

  // Try to infer breed, gender, and attributes from structured name
  const parsed = parseStructuredPetName(petName, genome.genome_type);

  // Get default attributes for species
  const defaults = getDefaultValues(genome.genome_type);

  // Apply parsed values or fall back to defaults
  const petGender = parsed?.gender ?? gender;
  const petBreed = parsed?.breed ?? '';
  const attrValues = parsed ? { ...defaults, ...parsed.attributes } : defaults;

  const db = getDb();
  const ts = now();

  const result = await db.execute(
    `INSERT INTO pets
     (name, species, gender, breed, breeder, content_hash, genome_data, notes,
      created_at, updated_at,
      intelligence, toughness, friendliness, ruggedness, enthusiasm, virility, ferocity, temperament)
     VALUES ($name, $species, $gender, $breed, $breeder, $content_hash, $genome_data, $notes,
             $created_at, $updated_at,
             $intelligence, $toughness, $friendliness, $ruggedness, $enthusiasm, $virility, $ferocity, $temperament)`,
    {
      name: petName,
      species: genome.genome_type,
      gender: petGender,
      breed: petBreed,
      breeder: genome.breeder,
      content_hash: contentHash,
      genome_data: genomeJson,
      notes: notes ?? '',
      created_at: ts,
      updated_at: ts,
      intelligence: attrValues.intelligence ?? 50,
      toughness: attrValues.toughness ?? 50,
      friendliness: attrValues.friendliness ?? 50,
      ruggedness: attrValues.ruggedness ?? 50,
      enthusiasm: attrValues.enthusiasm ?? 50,
      virility: attrValues.virility ?? 50,
      ferocity: attrValues.ferocity ?? 50,
      temperament: attrValues.temperament ?? 50,
    },
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- tests/unit/petService.test.js`

Expected: All tests PASS, including the new integration tests.

- [ ] **Step 5: Run the full unit test suite**

Run: `pnpm test`

Expected: All tests PASS.

- [ ] **Step 6: Lint**

Run: `pnpm run lint:fix`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/petService.ts tests/unit/petService.test.js
git commit -m "feat: integrate structured name parser into pet upload"
```
