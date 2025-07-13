# Development Guide

## Getting Started

This guide covers setting up the development environment, understanding the codebase, and contributing to PGBreeder.

## Prerequisites

### Required Software

- **Python 3.13+**: Modern Python with latest type hints
- **uv**: Fast Python package manager
- **Git**: Version control
- **VS Code** (recommended): IDE with Python extensions

### Installing uv

```bash
# Windows (PowerShell)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Project Setup

### 1. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/jlopezpena/PGBreeder.git
cd PGBreeder

# Install dependencies
uv sync --dev

# Populate database with sample data
uv run python populate_database.py

# Start the development server
uv run python run_web_app.py
```

### 2. Verify Installation

Visit `http://127.0.0.1:8000` to confirm the application is running.

## Development Workflow

### Daily Workflow

1. **Pull latest changes**
   ```bash
   git pull origin main
   uv sync --dev  # Update dependencies if needed
   ```

2. **Make changes**
   - Edit code using your preferred editor
   - Follow the coding standards below

3. **Test your changes**
   ```bash
   uv run pytest                # Run tests
   uv run ruff check           # Check linting
   uv run ruff format          # Format code
   uv run mypy src/            # Type checking
   ```

4. **Commit and push**
   ```bash
   git add .
   git commit -m "Descriptive commit message"
   git push origin your-branch
   ```

### VS Code Tasks

Use the pre-configured VS Code tasks:

- **Ctrl+Shift+P** → "Tasks: Run Task"
- Available tasks:
  - Install Dependencies
  - Run Tests
  - Run Tests with Coverage
  - Lint Code
  - Format Code
  - Type Check
  - Check All
  - Run PGBreeder

## Code Standards

### Python Style Guide

Follow PEP 8 with these specific guidelines:

```python
# Line length: 88 characters (Black default)
def long_function_name(
    variable_one: str, variable_two: str, variable_three: str
) -> str:
    """Always use docstrings for functions."""
    return f"{variable_one} {variable_two} {variable_three}"

# Type hints for all functions
def process_gene_data(
    animal_type: str, 
    chromosome: str, 
    gene_data: dict[str, Any]
) -> bool:
    """Process gene data and return success status."""
    pass

# Use double quotes for strings
message = "This is the preferred string format"

# Prefer pathlib over os.path
from pathlib import Path
config_path = Path("config") / "settings.json"

# Use descriptive variable names
effect_options = ["Intelligence+", "Intelligence-"]
animal_types = ["beewasp", "horse"]
```

### JavaScript Style Guide

```javascript
// Use ES6+ features
class GeneManager {
    constructor(apiClient, uiUtils) {
        this.apiClient = apiClient;
        this.uiUtils = uiUtils;
    }

    // Use async/await over Promises
    async loadGenes(animalType, chromosome) {
        try {
            const genes = await this.apiClient.getGenes(animalType, chromosome);
            return genes;
        } catch (error) {
            console.error('Error loading genes:', error);
            throw error;
        }
    }

    // Use meaningful function names
    checkForUnsavedChanges(geneCard) {
        // Implementation
    }
}

// Use const/let, never var
const API_BASE_URL = '/api';
let currentAnimalType = null;

// Prefer template literals
const message = `Loading genes for ${animalType} chromosome ${chromosome}`;
```

### Documentation Standards

#### Python Docstrings

Use Google-style docstrings:

```python
def update_gene_data(
    animal_type: str, 
    gene_id: str, 
    updates: dict[str, Any]
) -> bool:
    """
    Update gene data in the database.

    Args:
        animal_type: The type of animal (e.g., 'beewasp', 'horse')
        gene_id: Unique identifier for the gene (e.g., '01A1')
        updates: Dictionary containing field updates

    Returns:
        True if update was successful, False otherwise

    Raises:
        DatabaseError: If database connection fails
        ValueError: If gene_id is invalid

    Example:
        >>> success = update_gene_data('beewasp', '01A1', {
        ...     'effect_dominant': 'Intelligence+',
        ...     'notes': 'Updated in lab'
        ... })
        >>> print(success)
        True
    """
    pass
```

#### JavaScript Comments

```javascript
/**
 * Creates a gene card element for editing gene properties
 * @param {Object} gene - Gene data object containing all properties
 * @param {string} animalType - Animal type identifier
 * @returns {HTMLElement} Configured gene card DOM element
 */
createGeneCard(gene, animalType) {
    // Create main card container
    const card = document.createElement('div');
    card.className = 'gene-card';
    
    // Add gene identifier header
    const header = this.createGeneHeader(gene.gene);
    card.appendChild(header);
    
    return card;
}
```

## Testing

### Python Testing with pytest

#### Test Structure
```
tests/
├── __init__.py
├── conftest.py           # Shared fixtures
├── test_database.py      # Database tests
├── test_web_app.py       # API tests
└── test_cli.py           # CLI tests
```

#### Writing Tests

```python
# tests/test_database.py
import pytest
from pgbreeder.database import GeneDatabase

class TestGeneDatabase:
    """Test suite for GeneDatabase class."""
    
    def test_insert_gene(self, temp_db):
        """Test gene insertion functionality."""
        gene_data = {
            "animal_type": "beewasp",
            "chromosome": "chr01",
            "gene": "01A1",
            "effect_dominant": "Intelligence+",
            "effect_recessive": "Intelligence-",
            "appearance": "Test appearance",
            "notes": "Test notes"
        }
        
        temp_db.insert_gene(gene_data)
        
        # Verify insertion
        result = temp_db.get_gene("beewasp", "01A1")
        assert result is not None
        assert result["effect_dominant"] == "Intelligence+"

    def test_get_nonexistent_gene(self, temp_db):
        """Test retrieving non-existent gene returns None."""
        result = temp_db.get_gene("nonexistent", "fake")
        assert result is None

# conftest.py
@pytest.fixture
def temp_db():
    """Create temporary database for testing."""
    import tempfile
    import os
    
    # Create temporary database file
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
    temp_file.close()
    
    db = GeneDatabase(temp_file.name)
    yield db
    
    # Cleanup
    db.close()
    os.unlink(temp_file.name)
```

#### Running Tests

```bash
# Run all tests
uv run pytest

# Run with coverage
uv run pytest --cov=pgbreeder --cov-report=html

# Run specific test file
uv run pytest tests/test_database.py

# Run specific test
uv run pytest tests/test_database.py::TestGeneDatabase::test_insert_gene

# Verbose output
uv run pytest -v

# Stop on first failure
uv run pytest -x
```

### Frontend Testing

For JavaScript testing, consider adding:

```javascript
// Example test structure (if adding Jest)
describe('GeneManager', () => {
    let geneManager;
    let mockApiClient;
    let mockUiUtils;

    beforeEach(() => {
        mockApiClient = {
            getGenes: jest.fn(),
            updateGene: jest.fn()
        };
        mockUiUtils = {
            showSuccess: jest.fn(),
            showError: jest.fn()
        };
        geneManager = new GeneManager(mockApiClient, mockUiUtils);
    });

    test('should display genes correctly', async () => {
        const mockGenes = [
            { gene: '01A1', effect_dominant: 'Intelligence+' }
        ];
        mockApiClient.getGenes.mockResolvedValue(mockGenes);

        await geneManager.displayGenes(mockGenes, 'beewasp');

        expect(document.querySelector('.gene-card')).toBeTruthy();
    });
});
```

## Debugging

### Python Debugging

#### Logging
```python
import logging

# Configure logging level
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def process_gene_data(gene_data):
    logger.debug(f"Processing gene data: {gene_data}")
    logger.info("Gene processing started")
    
    try:
        # Process data
        result = do_something(gene_data)
        logger.info(f"Processing completed successfully: {result}")
        return result
    except Exception as e:
        logger.error(f"Error processing gene data: {e}")
        raise
```

#### VS Code Debugging

Create `.vscode/launch.json`:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Python: Web App",
            "type": "python",
            "request": "launch",
            "program": "run_web_app.py",
            "console": "integratedTerminal",
            "cwd": "${workspaceFolder}"
        },
        {
            "name": "Python: Populate DB",
            "type": "python",
            "request": "launch",
            "program": "populate_database.py",
            "console": "integratedTerminal",
            "cwd": "${workspaceFolder}"
        }
    ]
}
```

### Browser Debugging

#### JavaScript Console
```javascript
// Use console methods for debugging
console.log('Gene data:', geneData);
console.error('API error:', error);
console.table(genes);  // Nice table format for arrays
console.group('Gene Processing');
console.log('Step 1: Validation');
console.log('Step 2: Processing');
console.groupEnd();
```

#### Network Tab
- Monitor API requests in browser DevTools
- Check request/response data
- Verify status codes and timing

## Database Development

### Migrations

For schema changes, create migration functions:

```python
def migrate_database_v1_to_v2(db: GeneDatabase) -> None:
    """Migrate database from version 1 to version 2."""
    logger.info("Running migration v1 to v2")
    
    # Add new column
    db.conn.execute("""
        ALTER TABLE genes 
        ADD COLUMN version_added VARCHAR DEFAULT 'v1'
    """)
    
    # Update existing records
    db.conn.execute("""
        UPDATE genes 
        SET version_added = 'v1' 
        WHERE version_added IS NULL
    """)
    
    logger.info("Migration v1 to v2 completed")
```

### Database Testing

```python
def test_database_migration(temp_db):
    """Test database migration functionality."""
    # Insert test data in old format
    old_data = {"animal_type": "beewasp", "gene": "01A1"}
    temp_db.insert_gene(old_data)
    
    # Run migration
    migrate_database_v1_to_v2(temp_db)
    
    # Verify migration
    result = temp_db.get_gene("beewasp", "01A1")
    assert result["version_added"] == "v1"
```

## Performance Optimization

### Python Performance

```python
# Use type hints for better performance
from typing import List, Dict, Optional

def process_genes(genes: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Process genes with proper type hints."""
    return [process_single_gene(gene) for gene in genes]

# Cache expensive operations
from functools import lru_cache

@lru_cache(maxsize=128)
def get_effect_options() -> List[str]:
    """Get effect options with caching."""
    return ["Intelligence+", "Intelligence-", "Toughness+", "Toughness-"]

# Use generators for large datasets
def process_large_gene_file(file_path: Path):
    """Process large gene files efficiently."""
    with open(file_path) as f:
        for line in f:
            yield json.loads(line)
```

### JavaScript Performance

```javascript
// Cache DOM queries
class GeneManager {
    constructor() {
        this.geneContainer = document.getElementById('gene-container');
        this.loadButton = document.getElementById('load-genes-btn');
    }

    // Use document fragments for batch DOM updates
    displayGenes(genes) {
        const fragment = document.createDocumentFragment();
        
        genes.forEach(gene => {
            const card = this.createGeneCard(gene);
            fragment.appendChild(card);
        });
        
        this.geneContainer.appendChild(fragment);
    }

    // Debounce frequent operations
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
}
```

## Deployment

### Local Development

```bash
# Development server with auto-reload
uv run uvicorn pgbreeder.web_app:app --reload --host 127.0.0.1 --port 8000
```

### Production Considerations

```python
# web_app.py - Production configuration
import os

# Use environment variables for configuration
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
DATABASE_URL = os.getenv("DATABASE_URL", "pgbreeder.db")
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))

# Configure CORS for production
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://yourdomain.com"],  # Specific domains only
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)
```

## Troubleshooting

### Common Issues

#### Database Locked
```bash
# Kill Python processes
taskkill /F /IM python.exe

# Or use uv to restart
uv run python run_web_app.py
```

#### Import Errors
```bash
# Reinstall dependencies
uv sync --dev

# Check Python path
uv run python -c "import sys; print(sys.path)"
```

#### Type Checking Errors
```bash
# Run mypy with verbose output
uv run mypy src/ --verbose

# Check specific file
uv run mypy src/pgbreeder/database.py
```

## Contributing

### Pull Request Process

1. **Create feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes following standards**
   - Write tests for new functionality
   - Update documentation
   - Follow code style guidelines

3. **Test thoroughly**
   ```bash
   uv run pytest
   uv run ruff check
   uv run mypy src/
   ```

4. **Submit pull request**
   - Clear description of changes
   - Reference any related issues
   - Include screenshots for UI changes

### Code Review Checklist

- [ ] Code follows style guidelines
- [ ] Tests are included and passing
- [ ] Documentation is updated
- [ ] Type hints are included
- [ ] Error handling is appropriate
- [ ] Performance impact is considered

## Resources

### Documentation
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [DuckDB Documentation](https://duckdb.org/docs/)
- [pytest Documentation](https://docs.pytest.org/)
- [uv Documentation](https://docs.astral.sh/uv/)

### Tools
- [VS Code Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
- [Ruff Formatter](https://docs.astral.sh/ruff/)
- [mypy Type Checker](http://mypy-lang.org/)

This development guide should help you get started and maintain high code quality throughout the project lifecycle.
