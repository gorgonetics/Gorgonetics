# Database Documentation

## Overview

Gorgonetics uses DuckDB as its embedded analytical database. DuckDB provides excellent performance for analytical workloads while being embedded (no separate server required).

## Database File

- **Location**: `gorgonetics.db` (in project root)
- **Type**: DuckDB database file
- **Size**: Typically 1-10 MB depending on data volume

## Schema

### Tables Overview

The database contains two main tables:
- **genes**: Stores genetic template data
- **pets**: Stores uploaded pet genome data

### Genes Table

The main table storing all genetic information:

```sql
CREATE TABLE genes (
    animal_type VARCHAR NOT NULL,      -- Animal type identifier (e.g., 'beewasp', 'horse')
    chromosome VARCHAR NOT NULL,       -- Chromosome identifier (e.g., 'chr01', 'chr02')
    gene VARCHAR NOT NULL,             -- Gene identifier (e.g., '01A1', '02B3')
    effectDominant VARCHAR,           -- Dominant genetic effect
    effectRecessive VARCHAR,          -- Recessive genetic effect
    appearance VARCHAR,                -- Visual appearance description
    notes VARCHAR,                     -- Additional notes and observations
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- Record creation time
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- Last update time
    PRIMARY KEY (animal_type, gene)    -- Composite primary key
);
```

#### Field Descriptions

| Field | Type | Description | Example Values |
|-------|------|-------------|----------------|
| `animal_type` | VARCHAR | Species identifier | 'beewasp', 'horse' |
| `chromosome` | VARCHAR | Chromosome location | 'chr01', 'chr02', ..., 'chr48' |
| `gene` | VARCHAR | Unique gene identifier | '01A1', '02B3', '15C2' |
| `effectDominant` | VARCHAR | Dominant allele effect | 'Intelligence+', 'Toughness-' |
| `effectRecessive` | VARCHAR | Recessive allele effect | 'Intelligence-', 'No Effect' |
| `appearance` | VARCHAR | Visual traits | 'Brighter glow', 'Darker coat' |
| `notes` | VARCHAR | Research notes | 'Lab observation', 'Field study' |
| `created_at` | TIMESTAMP | Creation timestamp | '2025-01-01 10:30:00' |
| `updated_at` | TIMESTAMP | Last update timestamp | '2025-01-01 15:45:00' |

#### Constraints

- **Primary Key**: `(animal_type, gene)` - Each gene is unique per animal type
- **Not Null**: `animal_type`, `chromosome`, `gene` are required fields
- **Foreign Key**: None (denormalized for performance)

### Pets Table

Stores uploaded pet genome data for visualization:

```sql
CREATE TABLE pets (
    id INTEGER PRIMARY KEY,            -- Auto-incrementing pet ID
    name VARCHAR NOT NULL,             -- Pet name
    species VARCHAR NOT NULL,          -- Animal species (e.g., 'beewasp', 'horse')  
    breeder VARCHAR,                   -- Breeder/owner name
    genome_data JSON NOT NULL,         -- Complete genome data as JSON
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- Upload timestamp
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP   -- Last update timestamp
);
```

#### Pets Field Descriptions

| Field | Type | Description | Example Values |
|-------|------|-------------|----------------|
| `id` | INTEGER | Auto-increment primary key | 1, 2, 3 |
| `name` | VARCHAR | Pet's name | 'BabyFaeBee178', 'Thunderhoof' |
| `species` | VARCHAR | Pet species | 'beewasp', 'horse' |
| `breeder` | VARCHAR | Breeder/owner name | 'PlayerName', 'Unknown' |
| `genome_data` | JSON | Complete genome structure | `{"chr01": [...], "chr02": [...]}` |
| `created_at` | TIMESTAMP | Upload timestamp | '2025-01-01 10:30:00' |
| `updated_at` | TIMESTAMP | Last update timestamp | '2025-01-01 15:45:00' |

### Indexes

DuckDB automatically creates indexes for primary key constraints. Additional indexes may be added for performance:

```sql
-- Index for chromosome queries
CREATE INDEX idx_genes_animal_chromosome ON genes(animal_type, chromosome);

-- Index for effect searches  
CREATE INDEX idx_genes_effects ON genes(effectDominant, effectRecessive);

-- Index for pet species queries
CREATE INDEX idx_pets_species ON pets(species);
```

## Data Population

### Initial Data Loading

Data is populated from JSON template files in the `assets/` directory:

```
assets/
├── beewasp/
│   ├── beewasp_genes_chr01.json
│   ├── beewasp_genes_chr02.json
│   └── ...
└── horse/
    ├── horse_genes_chr01.json
    ├── horse_genes_chr02.json
    └── ...
```

### Population Script

The `uv run gorgonetics populate` command handles initial data loading:

```python
# Example JSON structure
{
    "animal_type": "beewasp",
    "chromosome": "chr01",
    "genes": [
        {
            "gene": "01A1",
            "effectDominant": "Intelligence+",
            "effectRecessive": "Intelligence-",
            "appearance": "Brighter antenna glow",
            "notes": "Commonly observed trait"
        }
    ]
}
```

## Database Operations

### GeneDatabase Class

The `DuckLakeGeneDatabase` class in `src/gorgonetics/ducklake_database.py` provides all database operations with multi-user support:

#### Connection Management

```python
class GeneDatabase:
    def __init__(self, db_path: str = "gorgonetics.db"):
        """Initialize database connection."""
        self.db_path = db_path
        self.conn = duckdb.connect(db_path)
        self.init_db()
```

#### Core Operations

##### Create Tables
```python
def _create_tables(self) -> None:
    """Create the necessary database tables."""
    # Genes table (static data)
    self.conn.execute("""
        CREATE TABLE IF NOT EXISTS genes (
            animal_type VARCHAR NOT NULL,
            chromosome VARCHAR NOT NULL,
            gene VARCHAR NOT NULL,
            effectDominant VARCHAR DEFAULT 'None',
            effectRecessive VARCHAR DEFAULT 'None',
            appearance VARCHAR DEFAULT '|String for me to fill in|',
            notes VARCHAR DEFAULT '|String for me to fill in|',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (animal_type, gene)
        )
    """)
    
    # Pets table (uploaded pet data)
    self.conn.execute("""
        CREATE TABLE IF NOT EXISTS pets (
            id INTEGER PRIMARY KEY,
            name VARCHAR NOT NULL,
            species VARCHAR NOT NULL,
            breeder VARCHAR,
            genome_data JSON NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
```

##### Insert/Update Operations
```python
def update_gene(self, gene_update: dict) -> bool:
    """Update a gene with new data."""
    result = self.conn.execute("""
        UPDATE genes 
        SET effectDominant = $effectDominant,
            effectRecessive = $effectRecessive,
            appearance = $appearance,
            notes = $notes,
            updated_at = CURRENT_TIMESTAMP
        WHERE animal_type = $animal_type AND gene = $gene
    """, gene_update)
    return result.rowcount > 0

def insert_pet(self, name: str, species: str, breeder: str, genome_data: dict) -> int:
    """Insert a new pet and return the pet ID."""
    result = self.conn.execute("""
        INSERT INTO pets (name, species, breeder, genome_data)
        VALUES ($name, $species, $breeder, $genome_data)
        RETURNING id
    """, {
        "name": name,
        "species": species,
        "breeder": breeder,
        "genome_data": json.dumps(genome_data)
    })
    return result.fetchone()[0]
```

##### Query Operations
```python
def get_genes_by_chromosome(self, animal_type: str, chromosome: str) -> list[dict]:
    """Get all genes for a specific chromosome."""
    result = self.conn.execute("""
        SELECT animal_type, chromosome, gene, effectDominant, effectRecessive,
               appearance, notes, created_at, updated_at
        FROM genes 
        WHERE animal_type = $animal_type AND chromosome = $chromosome
        ORDER BY gene
    """, {"animal_type": animal_type, "chromosome": chromosome})
    return [dict(zip([col[0] for col in result.description], row)) for row in result.fetchall()]

def get_all_pets(self) -> list[dict]:
    """Get all pets with basic information."""
    result = self.conn.execute("""
        SELECT id, name, species, breeder, created_at
        FROM pets 
        ORDER BY created_at DESC
    """)
    return [dict(zip([col[0] for col in result.description], row)) for row in result.fetchall()]

def get_pet_genome(self, pet_id: int) -> dict | None:
    """Get pet genome data for visualization."""
    result = self.conn.execute("""
        SELECT id, name, species, genome_data
        FROM pets 
        WHERE id = $pet_id
    """, {"pet_id": pet_id})
    
    row = result.fetchone()
    if not row:
        return None
        
    return {
        "pet_id": row[0],
        "name": row[1], 
        "species": row[2],
        "genes": json.loads(row[3])
    }
```

#### Named Parameters

All queries use named parameters ($parameter) instead of positional parameters (?) for better maintainability:

```python
# Good - Named parameters
result = self.conn.execute("""
    SELECT * FROM genes 
    WHERE animal_type = $animal_type AND chromosome = $chromosome
""", {"animal_type": "beewasp", "chromosome": "chr01"})

# Avoid - Positional parameters
result = self.conn.execute("""
    SELECT * FROM genes 
    WHERE animal_type = ? AND chromosome = ?
""", ("beewasp", "chr01"))
```

### Data Migration

#### Recent Improvements

The database has been enhanced with several improvements:

1. **Pet Management**: Added pets table for storing uploaded pet genome data
2. **JSON Support**: Native JSON storage for complex genome structures  
3. **Auto-initialization**: Database tables are created automatically on first run
4. **Improved Error Handling**: Better error messages and validation

#### Historical Migrations

##### Cleverness to Intelligence Migration

A migration function handles updating legacy "Cleverness" effects to "Intelligence":

```python
def migrate_cleverness_to_intelligence(self) -> None:
    """Migrate Cleverness effects to Intelligence for consistency."""
    migrations = [
        ("Cleverness+", "Intelligence+"),
        ("Cleverness-", "Intelligence-")
    ]
    
    for old_effect, new_effect in migrations:
        # Update dominant effects
        self.conn.execute("""
            UPDATE genes 
            SET effectDominant = $new_effect, updated_at = CURRENT_TIMESTAMP
            WHERE effectDominant = $old_effect
        """, {"old_effect": old_effect, "new_effect": new_effect})
        
        # Update recessive effects
        self.conn.execute("""
            UPDATE genes 
            SET effectRecessive = $new_effect, updated_at = CURRENT_TIMESTAMP
            WHERE effectRecessive = $old_effect
        """, {"old_effect": old_effect, "new_effect": new_effect})
```

## Performance Considerations

### Query Optimization

1. **Use specific columns**: Avoid `SELECT *` in production queries
2. **Leverage indexes**: Primary key lookups are fastest
3. **Batch operations**: Use transactions for multiple inserts
4. **Prepared statements**: DuckDB optimizes repeated queries

### Example Optimized Queries

```python
# Efficient - Uses primary key
def get_gene(self, animal_type: str, gene: str) -> dict | None:
    result = self.conn.execute("""
        SELECT animal_type, chromosome, gene, effectDominant, effectRecessive,
               appearance, notes, created_at, updated_at
        FROM genes 
        WHERE animal_type = $animal_type AND gene = $gene
    """, {"animal_type": animal_type, "gene": gene})

# Efficient - Uses compound index
def get_chromosomes(self, animal_type: str) -> list[str]:
    result = self.conn.execute("""
        SELECT DISTINCT chromosome 
        FROM genes 
        WHERE animal_type = $animal_type 
        ORDER BY chromosome
    """, {"animal_type": animal_type})
```

### Transaction Management

For bulk operations, use transactions:

```python
def bulk_insert_genes(self, genes: list[dict]) -> None:
    """Insert multiple genes in a single transaction."""
    try:
        self.conn.begin()
        for gene_data in genes:
            self.insert_gene(gene_data)
        self.conn.commit()
    except Exception as e:
        self.conn.rollback()
        raise e
```

## Backup and Recovery

### Manual Backup
```bash
# Copy database file
cp gorgonetics.db gorgonetics_backup_$(date +%Y%m%d).db
```

### Export Data
```python
# Export to JSON via API
import json
database = GeneDatabase()
export_data = database.export_genes_to_json("beewasp")
with open("backup.json", "w") as f:
    json.dump(export_data, f, indent=2)
```

### Recovery
```python
# Restore from JSON export
import json
with open("backup.json", "r") as f:
    data = json.load(f)

database = GeneDatabase()
for chromosome, genes in data["chromosomes"].items():
    for gene in genes:
        gene["animal_type"] = data["animal_type"]
        gene["chromosome"] = chromosome
        database.insert_gene(gene)
```

## Monitoring

### Database Size
```python
import os
db_size = os.path.getsize("gorgonetics.db")
print(f"Database size: {db_size / 1024 / 1024:.2f} MB")
```

### Record Counts
```python
def get_statistics(self) -> dict:
    """Get comprehensive database statistics."""
    # Gene statistics
    gene_stats = self.conn.execute("""
        SELECT 
            animal_type,
            COUNT(*) as gene_count,
            COUNT(DISTINCT chromosome) as chromosome_count
        FROM genes 
        GROUP BY animal_type
    """).fetchall()
    
    # Pet statistics  
    pet_stats = self.conn.execute("""
        SELECT 
            species,
            COUNT(*) as pet_count
        FROM pets
        GROUP BY species
    """).fetchall()
    
    return {
        "genes": [dict(zip(["animal_type", "gene_count", "chromosome_count"], row)) for row in gene_stats],
        "pets": [dict(zip(["species", "pet_count"], row)) for row in pet_stats]
    }
```

## Troubleshooting

### Common Issues

#### Database Locked
- **Cause**: Multiple connections or process not closed
- **Solution**: Kill Python processes, restart application

#### Corruption
- **Cause**: Unexpected shutdown during write
- **Solution**: Restore from backup

#### Performance Degradation
- **Cause**: Large dataset without proper indexing
- **Solution**: Add appropriate indexes, optimize queries

### Diagnostic Queries

```sql
-- Check table structures
DESCRIBE genes;
DESCRIBE pets;

-- Check record counts
SELECT animal_type, COUNT(*) FROM genes GROUP BY animal_type;
SELECT species, COUNT(*) FROM pets GROUP BY species;

-- Check recent updates
SELECT * FROM genes WHERE updated_at > CURRENT_TIMESTAMP - INTERVAL 1 DAY;
SELECT * FROM pets WHERE created_at > CURRENT_TIMESTAMP - INTERVAL 1 DAY;

-- Find missing chromosomes
SELECT DISTINCT animal_type, chromosome FROM genes ORDER BY animal_type, chromosome;

-- Pet genome structure analysis
SELECT name, species, JSON_EXTRACT_STRING(genome_data, '$.chr01[0].gene') as first_gene 
FROM pets LIMIT 5;
```

## Future Considerations

### Scaling
- For larger datasets, consider PostgreSQL or other RDBMS
- Implement connection pooling for high concurrency
- Add read replicas for better read performance

### Schema Evolution
- Implement proper migrations system
- Version control schema changes
- Add foreign key constraints for data integrity

### Audit Trail
- Add audit table for change tracking
- Implement soft deletes
- Log user actions for compliance
