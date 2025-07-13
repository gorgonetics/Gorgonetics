# Database Documentation

## Overview

PGBreeder uses DuckDB as its embedded analytical database. DuckDB provides excellent performance for analytical workloads while being embedded (no separate server required).

## Database File

- **Location**: `pgbreeder.db` (in project root)
- **Type**: DuckDB database file
- **Size**: Typically 1-10 MB depending on data volume

## Schema

### Genes Table

The main table storing all genetic information:

```sql
CREATE TABLE genes (
    animal_type VARCHAR NOT NULL,      -- Animal type identifier (e.g., 'beewasp', 'horse')
    chromosome VARCHAR NOT NULL,       -- Chromosome identifier (e.g., 'chr01', 'chr02')
    gene VARCHAR NOT NULL,             -- Gene identifier (e.g., '01A1', '02B3')
    effect_dominant VARCHAR,           -- Dominant genetic effect
    effect_recessive VARCHAR,          -- Recessive genetic effect
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
| `effect_dominant` | VARCHAR | Dominant allele effect | 'Intelligence+', 'Toughness-' |
| `effect_recessive` | VARCHAR | Recessive allele effect | 'Intelligence-', 'No Effect' |
| `appearance` | VARCHAR | Visual traits | 'Brighter glow', 'Darker coat' |
| `notes` | VARCHAR | Research notes | 'Lab observation', 'Field study' |
| `created_at` | TIMESTAMP | Creation timestamp | '2025-01-01 10:30:00' |
| `updated_at` | TIMESTAMP | Last update timestamp | '2025-01-01 15:45:00' |

#### Constraints

- **Primary Key**: `(animal_type, gene)` - Each gene is unique per animal type
- **Not Null**: `animal_type`, `chromosome`, `gene` are required fields
- **Foreign Key**: None (denormalized for performance)

### Indexes

DuckDB automatically creates indexes for primary key constraints. Additional indexes may be added for performance:

```sql
-- Index for chromosome queries
CREATE INDEX idx_genes_animal_chromosome ON genes(animal_type, chromosome);

-- Index for effect searches
CREATE INDEX idx_genes_effects ON genes(effect_dominant, effect_recessive);
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

The `populate_database.py` script handles initial data loading:

```python
# Example JSON structure
{
    "animal_type": "beewasp",
    "chromosome": "chr01",
    "genes": [
        {
            "gene": "01A1",
            "effect_dominant": "Intelligence+",
            "effect_recessive": "Intelligence-",
            "appearance": "Brighter antenna glow",
            "notes": "Commonly observed trait"
        }
    ]
}
```

## Database Operations

### GeneDatabase Class

The `GeneDatabase` class in `src/pgbreeder/database.py` provides all database operations:

#### Connection Management

```python
class GeneDatabase:
    def __init__(self, db_path: str = "pgbreeder.db"):
        """Initialize database connection."""
        self.db_path = db_path
        self.conn = duckdb.connect(db_path)
        self.init_db()
```

#### Core Operations

##### Create Tables
```python
def init_db(self) -> None:
    """Initialize database tables if they don't exist."""
    self.conn.execute("""
        CREATE TABLE IF NOT EXISTS genes (
            animal_type VARCHAR NOT NULL,
            chromosome VARCHAR NOT NULL,
            gene VARCHAR NOT NULL,
            effect_dominant VARCHAR,
            effect_recessive VARCHAR,
            appearance VARCHAR,
            notes VARCHAR,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (animal_type, gene)
        )
    """)
```

##### Insert/Update Operations
```python
def insert_gene(self, gene_data: dict) -> None:
    """Insert a new gene or update existing one."""
    self.conn.execute("""
        INSERT OR REPLACE INTO genes 
        (animal_type, chromosome, gene, effect_dominant, effect_recessive, 
         appearance, notes, created_at, updated_at)
        VALUES ($animal_type, $chromosome, $gene, $effect_dominant, 
                $effect_recessive, $appearance, $notes, 
                COALESCE($created_at, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
    """, gene_data)
```

##### Query Operations
```python
def get_genes_by_chromosome(self, animal_type: str, chromosome: str) -> list[dict]:
    """Get all genes for a specific chromosome."""
    result = self.conn.execute("""
        SELECT animal_type, chromosome, gene, effect_dominant, effect_recessive,
               appearance, notes, created_at, updated_at
        FROM genes 
        WHERE animal_type = $animal_type AND chromosome = $chromosome
        ORDER BY gene
    """, {"animal_type": animal_type, "chromosome": chromosome})
    return [dict(zip([col[0] for col in result.description], row)) for row in result.fetchall()]
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

#### Cleverness to Intelligence Migration

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
            SET effect_dominant = $new_effect, updated_at = CURRENT_TIMESTAMP
            WHERE effect_dominant = $old_effect
        """, {"old_effect": old_effect, "new_effect": new_effect})
        
        # Update recessive effects
        self.conn.execute("""
            UPDATE genes 
            SET effect_recessive = $new_effect, updated_at = CURRENT_TIMESTAMP
            WHERE effect_recessive = $old_effect
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
        SELECT animal_type, chromosome, gene, effect_dominant, effect_recessive,
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
cp pgbreeder.db pgbreeder_backup_$(date +%Y%m%d).db
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
db_size = os.path.getsize("pgbreeder.db")
print(f"Database size: {db_size / 1024 / 1024:.2f} MB")
```

### Record Counts
```python
def get_statistics(self) -> dict:
    """Get database statistics."""
    result = self.conn.execute("""
        SELECT 
            animal_type,
            COUNT(*) as gene_count,
            COUNT(DISTINCT chromosome) as chromosome_count
        FROM genes 
        GROUP BY animal_type
    """)
    return [dict(zip([col[0] for col in result.description], row)) for row in result.fetchall()]
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
-- Check table structure
DESCRIBE genes;

-- Check record counts
SELECT animal_type, COUNT(*) FROM genes GROUP BY animal_type;

-- Check recent updates
SELECT * FROM genes WHERE updated_at > CURRENT_TIMESTAMP - INTERVAL 1 DAY;

-- Find missing chromosomes
SELECT DISTINCT animal_type, chromosome FROM genes ORDER BY animal_type, chromosome;
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
