---
name: Data Model
description: "Database schema, species config, gene/genome structures, and migration history"
tags: database, schema, genes, species
---

# Data Model

## Database Schema (SQLite)

```sql
-- Gene effect definitions per species (loaded from bundled JSON templates)
genes (animal_type, chromosome, gene [PK], effectDominant, effectRecessive,
       appearance, breed, notes, created_at, updated_at)

-- Pet records with genome data stored as JSON
pets (id [PK], name, species, gender, breed, breeder, content_hash [UNIQUE],
      genome_data [JSON], notes, created_at, updated_at, sort_order,
      intelligence, toughness, friendliness, ruggedness, enthusiasm,
      virility, ferocity, temperament)

-- Pet image gallery
pet_images (id [PK], pet_id [FK→pets], filename, original_name, caption,
            tags [JSON], created_at, sort_order)

-- Tag junction table (migrated from JSON column in v7)
pet_tags (id [PK], pet_id [FK→pets], tag [UNIQUE composite with pet_id])

-- User preferences (key-value store)
settings (key [PK], value, updated_at)
```

## Migration History (PRAGMA user_version)

| Version | Change |
|---------|--------|
| v1 | Baseline: genes + pets tables |
| v2 | Add settings table |
| v3 | Add pet_images table |
| v4 | Add sort_order to pets (drag-and-drop) |
| v5 | Add sort_order to pet_images + index |
| v6 | Add tags column to pets (legacy JSON) |
| v7 | Create pet_tags junction table + migrate from JSON |

## Species Configuration

| Species | Chromosomes | Unique Attribute | Core Attributes |
|---------|------------|------------------|-----------------|
| BeeWasp | 10 | Ferocity | Toughness, Ruggedness, Enthusiasm, Friendliness, Intelligence, Virility |
| Horse | 48 | Temperament | Toughness, Ruggedness, Enthusiasm, Friendliness, Intelligence, Virility |

All attributes default to 50. Species are extensible via `configService.ts`.

## Gene/Genome Types

```typescript
interface Gene {
  chromosome: string;      // "chr01", "chr02", ...
  block: string;           // "A", "B", ..., "Z", "AA", ...
  position: number;        // 1-indexed within block
  gene_type: GeneType;     // "R" (recessive) | "D" (dominant) | "x" (mixed) | "?" (unknown)
}

interface Genome {
  format_version: string;
  breeder: string;
  name: string;
  genome_type: string;     // Species name
  genes: Record<string, Gene[]>;  // Key: chromosome ID
}
```

## Gene Visualization

- **Grid:** Chromosome → Blocks (A–Z, AA–...) → Positions (1–N genes per position)
- **Effect lookup:** Query cached gene effects DB → classify positive/negative/neutral → color-code
- **Appearance:** Map effect text to category (e.g., "Body Color Hue" → `--gene-body-hue`)
- **Views:** Attribute view (stats table) and Appearance view (color grid)
