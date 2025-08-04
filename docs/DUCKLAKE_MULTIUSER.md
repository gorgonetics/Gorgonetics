# DuckLake Multi-User Setup Guide

This guide explains how to enable multi-user support in Gorgonetics using DuckLake, allowing multiple users to work with the same genetic data simultaneously.

## Overview

DuckLake is a lakehouse format that provides:
- **Multi-user concurrent access** through catalog databases
- **Time travel queries** and snapshots
- **ACID transactions** across multi-table operations
- **Data lake features** like schema evolution and partitioning
- **Performance optimization** with statistics and filter pushdown

## Architecture

DuckLake uses a hybrid architecture:
- **Catalog Database**: Stores metadata and manages transactions (PostgreSQL, MySQL, SQLite, or DuckDB)
- **Data Storage**: Parquet files containing the actual genetic data
- **DuckDB Clients**: Multiple DuckDB instances can connect simultaneously through the catalog

## Quick Start

### 1. Migrate Existing Data

If you have an existing `gorgonetics.db` file, migrate it to DuckLake:

```bash
# Using SQLite as catalog (single-server multi-user)
uv run gorgonetics migrate-to-ducklake --catalog-type sqlite

# Using PostgreSQL as catalog (distributed multi-user)
uv run gorgonetics migrate-to-ducklake \
    --catalog-type postgresql \
    --catalog-path "dbname=gorgonetics_catalog host=localhost user=gorgonetics password=secret"
```

### 2. Configure Environment

Create a `.env` file or set environment variables:

```bash
# Use DuckLake backend
GORGONETICS_DB_BACKEND=ducklake

# SQLite catalog (file-based, single server)
GORGONETICS_CATALOG_TYPE=sqlite
GORGONETICS_CATALOG_PATH=metadata.sqlite
GORGONETICS_DATA_PATH=data

# Enable concurrent access
GORGONETICS_CONCURRENT_ACCESS=true
```

### 3. Start Using Multi-User Features

```python
from gorgonetics.database_config import create_database_instance

# This will automatically use DuckLake based on environment
db = create_database_instance()

# All existing methods work the same
pets = db.get_all_pets()
genes = db.get_genes_for_animal("Cow")

# New DuckLake features
snapshots = db.get_snapshots()
changes = db.get_table_changes("pets", 0, 1)
```

## Catalog Database Options

### SQLite (Recommended for Single Server)

**Best for**: Small teams, single server deployment

```bash
GORGONETICS_CATALOG_TYPE=sqlite
GORGONETICS_CATALOG_PATH=metadata.sqlite
```

**Pros**:
- No additional database server required
- Simple file-based storage
- Good performance for small teams

**Cons**:
- Limited to single server
- Less robust under high concurrency

### PostgreSQL (Recommended for Production)

**Best for**: Production deployments, multiple servers, high concurrency

```bash
GORGONETICS_CATALOG_TYPE=postgresql
GORGONETICS_CATALOG_PATH="dbname=gorgonetics_catalog host=postgres.example.com user=gorgonetics password=secret"
```

**Setup**:
1. Create database: `CREATE DATABASE gorgonetics_catalog;`
2. Create user: `CREATE USER gorgonetics WITH PASSWORD 'secret';`
3. Grant permissions: `GRANT ALL ON DATABASE gorgonetics_catalog TO gorgonetics;`

**Pros**:
- Excellent concurrent performance
- Robust ACID guarantees
- Mature backup and monitoring tools
- Distributed deployment support

**Cons**:
- Requires PostgreSQL server setup
- More operational complexity

### MySQL

**Best for**: Existing MySQL infrastructure

```bash
GORGONETICS_CATALOG_TYPE=mysql
GORGONETICS_CATALOG_PATH="db=gorgonetics_catalog host=mysql.example.com user=gorgonetics password=secret"
```

**Setup**:
1. Create database: `CREATE DATABASE gorgonetics_catalog;`
2. Create user: `CREATE USER 'gorgonetics'@'%' IDENTIFIED BY 'secret';`
3. Grant permissions: `GRANT ALL ON gorgonetics_catalog.* TO 'gorgonetics'@'%';`

### DuckDB (Single User)

**Best for**: Development, single-user scenarios with data lake features

```bash
GORGONETICS_CATALOG_TYPE=duckdb
GORGONETICS_CATALOG_PATH=metadata.duckdb
```

**Note**: This doesn't provide multi-user support but gives you time travel and other DuckLake features.

## Deployment Scenarios

### Scenario 1: Small Team, Single Server

```bash
# Use SQLite catalog
GORGONETICS_DB_BACKEND=ducklake
GORGONETICS_CATALOG_TYPE=sqlite
GORGONETICS_CATALOG_PATH=/shared/gorgonetics/metadata.sqlite
GORGONETICS_DATA_PATH=/shared/gorgonetics/data
```

- Multiple users connect to the same shared filesystem
- SQLite handles concurrent access through file locking
- Data stored in shared Parquet files

### Scenario 2: Production Deployment

```bash
# Use PostgreSQL catalog
GORGONETICS_DB_BACKEND=ducklake
GORGONETICS_CATALOG_TYPE=postgresql
GORGONETICS_CATALOG_PATH="dbname=gorgonetics_catalog host=db.internal user=gorgonetics password=${DB_PASSWORD}"
GORGONETICS_DATA_PATH=s3://gorgonetics-data/
```

- PostgreSQL for robust concurrent metadata management
- S3 or other object storage for Parquet files
- Multiple application servers can connect

### Scenario 3: Development with Data Lake Features

```bash
# Use DuckDB catalog for development
GORGONETICS_DB_BACKEND=ducklake
GORGONETICS_CATALOG_TYPE=duckdb
GORGONETICS_CATALOG_PATH=dev_metadata.duckdb
GORGONETICS_DATA_PATH=dev_data/
```

- Single user development environment
- Access to time travel and snapshots
- Easy to reset and experiment

## Advanced Features

### Time Travel Queries

```python
# Get data as it existed at a specific snapshot
db.conn.execute("SELECT * FROM pets FOR SYSTEM_TIME AS OF SNAPSHOT 5")

# See what changed between snapshots
changes = db.get_table_changes("pets", start_snapshot=0, end_snapshot=2)
```

### Snapshot Management

```python
# List all snapshots
snapshots = db.get_snapshots()

# Create manual snapshot
db.conn.commit()

# Clean up old files
db.cleanup_old_files(dry_run=False)
```

### Schema Evolution

DuckLake automatically handles schema changes:
- Adding new columns
- Changing column types (compatible changes)
- Maintaining backward compatibility

## CLI Commands

### Check Database Status

```bash
uv run gorgonetics db-status
```

### View Snapshots

```bash
uv run gorgonetics db-snapshots
```

### Cleanup Old Files

```bash
# Dry run first
uv run gorgonetics db-cleanup --dry-run

# Actual cleanup
uv run gorgonetics db-cleanup --no-dry-run
```

## Troubleshooting

### Connection Issues

1. **Extension not found**: Ensure DuckDB version >= 1.3.1
2. **Catalog connection fails**: Check connection strings and database permissions
3. **Data path issues**: Verify file system permissions

### Performance Issues

1. **Slow queries**: Check if statistics are up to date
2. **Large snapshots**: Run cleanup regularly
3. **Concurrent conflicts**: Consider using PostgreSQL catalog

### Migration Issues

1. **Backup first**: Always create backups before migration
2. **Verify data**: Use the verification step in migration
3. **Rollback plan**: Keep original DuckDB file until verified

## Best Practices

### 1. Regular Maintenance

```bash
# Weekly cleanup
uv run gorgonetics db-cleanup --no-dry-run

# Monitor snapshot count
uv run gorgonetics db-snapshots
```

### 2. Backup Strategy

- **Catalog database**: Regular PostgreSQL/MySQL backups
- **Data files**: Backup Parquet files (they're immutable)
- **Snapshots**: Export metadata for disaster recovery

### 3. Monitoring

- Track snapshot growth
- Monitor catalog database size
- Watch for failed transactions

### 4. Security

- Use dedicated database users
- Encrypt connections for remote catalogs
- Secure data file access permissions

## Migration from DuckDB

The migration process:

1. **Backup**: Original database is backed up
2. **Export**: Genes exported to Parquet files by animal type
3. **Setup**: DuckLake catalog initialized
4. **Import**: Data loaded into DuckLake format
5. **Verify**: Data integrity checked
6. **Snapshot**: Initial snapshot created

After migration, you can:
- Continue using the same API
- Access new DuckLake features
- Support multiple concurrent users
- Query historical data through snapshots

## Performance Comparison

| Feature | DuckDB | DuckLake |
|---------|--------|----------|
| Single user | ✅ Excellent | ✅ Excellent |
| Multi-user | ❌ Not supported | ✅ Yes |
| Time travel | ❌ No | ✅ Yes |
| Snapshots | ❌ No | ✅ Yes |
| Schema evolution | ⚠️ Manual | ✅ Automatic |
| Query performance | ✅ Excellent | ✅ Excellent |
| Storage efficiency | ✅ Good | ✅ Better (Parquet) |

## Support

For issues with DuckLake setup:

1. Check the [DuckLake documentation](https://ducklake.select/)
2. Review DuckDB extension logs
3. Verify catalog database connectivity
4. Test with a minimal example

The transition to DuckLake provides a robust foundation for multi-user genetics data management while maintaining the analytical performance that makes DuckDB excellent for genomics workloads.