# Configuration-Driven Attribute System

## Overview

Gorgonetics uses a centralized configuration system for pet attributes, with all definitions stored in `src/gorgonetics/attribute_config.py`. This approach provides a single source of truth and enables easy extensibility for new species and attributes.

## Key Benefits

- **Single Source of Truth**: All attribute definitions in one place
- **Easy Extensibility**: Add new species or attributes by updating only the config
- **Type Safety**: Automatic validation based on species
- **Dynamic UI**: Frontend adapts automatically to species-specific attributes

## Architecture

The system uses a central `AttributeConfig` class that defines:
- Core attributes shared by all species (intelligence, toughness, etc.)
- Species-specific behavioral attributes (ferocity for beewasp, temperament for horse)
- Appearance attributes for visual gene effects
- Default values and metadata for each attribute

All other components (models, database, API, frontend) load from this configuration dynamically.

## Supported Species

- **BeeWasp**: Core attributes plus ferocity
- **Horse**: Core attributes plus temperament  
- **Unknown Species**: Core attributes only (fallback)

## Adding New Species

To add a new species, update only `attribute_config.py`:

```python
SPECIES_ATTRIBUTES = {
    "dragon": {
        "fire_breath": {
            "name": "Fire Breath",
            "icon": "🔥", 
            "default": 50.0,
            "description": "Ability to breathe fire"
        }
    }
}
```

The database, API, and frontend will automatically adapt to include the new attribute.

## API Integration

The system provides endpoints for retrieving attribute configuration:
- `/api/attribute-config/{species}` - Behavioral attributes
- `/api/appearance-config/{species}` - Appearance attributes
- `/api/effect-options` - Gene effect options (includes all attributes)

See [API.md](API.md) for detailed endpoint documentation.