# DuckLake Multi-User Setup Guide

This guide explains how to use DuckLake with SQLite catalog in Gorgonetics, providing data versioning and concurrent access capabilities.

## Overview

DuckLake is a lakehouse format that provides:
- **Multi-user concurrent access** through SQLite catalog
- **Time travel queries** and snapshots
- **ACID transactions** across multi-table operations
- **Data versioning** with automatic snapshot creation
- **Performance optimization** with statistics and filter pushdown

## Architecture

DuckLake uses a hybrid architecture:
- **SQLite Catalog**: Stores metadata and manages transactions in a local SQLite database
- **Data Storage**: Parquet files containing the actual genetic data
- **DuckDB Clients**: Multiple DuckDB instances can connect simultaneously through the catalog

## Quick Start

### 1. Initialize Database

Gorgonetics automatically creates and manages the DuckLake database for you. No migration is needed as this is the primary database format.

### 2. Configure Environment (Optional)

Create a `.env` file or set environment variables:

```bash
# DuckLake settings
GORGONETICS_CATALOG_PATH=metadata.sqlite
GORGONETICS_DATA_PATH=data
GORGONETICS_DUCKLAKE_NAME=gorgonetics_lake

# Multi-user settings
GORGONETICS_CONCURRENT_ACCESS=true
GORGONETICS_SESSION_TIMEOUT=30
```

### 3. Start Using Gorgonetics

All Gorgonetics commands automatically use DuckLake:

```bash
# Import genome data
uv run gorgonetics import assets/dog.genome

# Start web interface
uv run gorgonetics web

# Check database status
uv run gorgonetics db-status
```

## File Structure

Your Gorgonetics project will have:

```
gorgonetics/
├── metadata.sqlite          # SQLite catalog database
├── data/                   # Parquet data directory
│   ├── genes/             # Gene data tables
│   ├── pets/              # Pet data tables
│   └── _delta_log/        # DuckLake transaction log
└── backups/               # Optional backups
```

## Multi-User Features

### Concurrent Access

Multiple users can access the same DuckLake database simultaneously:

```bash
# User 1
cd /shared/gorgonetics
uv run gorgonetics web --port 8000

# User 2 (different terminal/machine)
cd /shared/gorgonetics
uv run gorgonetics web --port 8001
```

Both instances will see the same data and changes are immediately visible to all users.

### Snapshots and Time Travel

DuckLake automatically creates snapshots of your data:

```bash
# View available snapshots
uv run gorgonetics db-snapshots

# Query historical data (in DuckDB)
SELECT * FROM genes VERSION AS OF TIMESTAMP '2024-01-01 12:00:00'
```

### Data Versioning

Every change creates a new version:
- **Automatic snapshots** on data modifications
- **Transaction log** tracks all changes
- **Time travel queries** to access historical data
- **Rollback capability** to previous versions

## Performance Optimization

DuckLake provides several performance benefits:

### Statistics Collection
- Automatic column statistics
- Min/max values for efficient filtering
- Row count estimates for query planning

### Parquet Format
- Columnar storage for analytical queries
- Built-in compression
- Efficient serialization

### Filter Pushdown
- Predicates pushed to storage layer
- Reduced I/O for selective queries
- Automatic index usage

## Backup and Recovery

### Backup Strategy
```bash
# Create backup before major changes
cp -r data/ backup_$(date +%Y%m%d)/
cp metadata.sqlite backup_$(date +%Y%m%d)/
```

### Recovery
```bash
# Restore from backup
rm -rf data/
rm metadata.sqlite
cp -r backup_20240101/data/ .
cp backup_20240101/metadata.sqlite .
```

## Maintenance

### Cleanup Old Files
```bash
# Remove old data files (dry run)
uv run gorgonetics db-cleanup

# Actually perform cleanup
uv run gorgonetics db-cleanup --no-dry-run
```

### Monitor Storage
```bash
# Check data directory size
du -sh data/

# Check catalog size
ls -lh metadata.sqlite
```

## Troubleshooting

### Connection Issues
1. **File Permissions**: Ensure read/write access to `metadata.sqlite` and `data/` directory
2. **Disk Space**: Check available disk space for Parquet files
3. **SQLite Locks**: Ensure no processes are holding exclusive locks

### Performance Issues
1. **Statistics**: Allow DuckLake to collect statistics automatically
2. **Queries**: Use appropriate WHERE clauses for filter pushdown
3. **Cleanup**: Run periodic cleanup to remove old data files

### Data Consistency
1. **Snapshots**: Use `db-snapshots` to verify data versions
2. **Validation**: Run data validation queries after major changes
3. **Backups**: Maintain regular backups before schema changes

## Database Initialization

Gorgonetics automatically sets up the DuckLake database:

1. **Catalog Creation**: SQLite catalog created in `metadata.sqlite`
2. **Data Directory**: Parquet data files stored in `data/` directory
3. **Schema Setup**: Database tables created automatically
4. **Initial Snapshot**: First snapshot created when data is added

## Best Practices

1. **Regular Backups**: Create backups before major data modifications
2. **Monitor Storage**: Watch disk usage in the `data/` directory
3. **Cleanup Routine**: Run `db-cleanup` periodically to manage storage
4. **Environment Variables**: Use `.env` file for consistent configuration
5. **Access Control**: Manage file permissions for multi-user scenarios

## Limitations

- **Single Server**: SQLite catalog requires shared file system access
- **File Locking**: Concurrent writers may experience brief lock delays
- **Storage Growth**: Parquet files grow over time; regular cleanup recommended