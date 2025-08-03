# Configuration-Driven Attribute System

## Overview

The Gorgonetics pet attribute system has been completely refactored to use a centralized configuration approach. Instead of hardcoding attributes in multiple places throughout the codebase, all attribute definitions now live in a single configuration file (`src/gorgonetics/attribute_config.py`) and everything else loads from there dynamically.

## Key Benefits

- **Single Source of Truth**: All attribute definitions in one place
- **Zero Hardcoding**: No attributes hardcoded anywhere in the system
- **Easy Extensibility**: Add new species or attributes by updating only the config
- **Type Safety**: Automatic validation based on species
- **Dynamic UI**: Frontend adapts automatically to species-specific attributes
- **Database Flexibility**: Schema handles all possible attributes automatically

## Architecture

### Central Configuration (`attribute_config.py`)

```python
class AttributeConfig:
    # Core attributes shared by all pet species
    CORE_ATTRIBUTES = {
        "intelligence": {"name": "Intelligence", "icon": "🧠", "default": 50.0},
        "toughness": {"name": "Toughness", "icon": "💪", "default": 50.0},
        # ... etc
    }

    # Species-specific additional attributes
    SPECIES_ATTRIBUTES = {
        "beewasp": {
            "ferocity": {"name": "Ferocity", "icon": "🔥", "default": 50.0}
        },
        "horse": {
            "temperament": {"name": "Temperament", "icon": "🐎", "default": 50.0}
        }
    }
```

All other components load from this configuration:

### Models Layer
- Pet models use `dict[str, float]` for attributes instead of fixed classes
- Automatic species detection and attribute validation
- Dynamic attribute creation based on genome type

### Database Layer
- Dynamic schema with all possible attribute columns
- Automatic migration when new attributes are added
- Flexible queries that adapt to available attributes

### Web API Layer
- Dynamic endpoint responses based on species
- Configuration-driven effect options for gene editing
- Species-specific attribute validation

### Frontend Layer
- Loads attribute configuration via API endpoint
- Dynamic UI rendering based on pet species
- Automatic icon and display name mapping

## Current Species Support

### BeeWasp Species
- **Core Attributes**: Intelligence, Toughness, Friendliness, Ruggedness, Enthusiasm, Virility
- **Specific Attributes**: Ferocity (🔥)
- **Recognition**: "beewasp", "bee", "wasp" (case-insensitive)

### Horse Species
- **Core Attributes**: Intelligence, Toughness, Friendliness, Ruggedness, Enthusiasm, Virility
- **Specific Attributes**: Temperament (🐎)
- **Recognition**: "horse" (case-insensitive)

### Unknown Species
- **Attributes**: Core attributes only
- **Fallback**: Any unrecognized species gets core attributes

## Adding New Species or Attributes

To add a new species (e.g., "Dragon" with "Fire Breath" attribute):

1. **Update ONLY the configuration in `attribute_config.py`:**

```python
SPECIES_ATTRIBUTES = {
    # ... existing species ...
    "dragon": {
        "fire_breath": {
            "name": "Fire Breath",
            "icon": "🔥",
            "default": 50.0,
            "description": "Ability to breathe fire"
        }
    }
}

SPECIES_MAPPINGS = {
    # ... existing mappings ...
    "dragon": ["dragon", "drake", "wyrm"]
}
```

2. **Everything else updates automatically:**
   - Database adds new column on next startup
   - Models validate the new attribute
   - API includes it in responses
   - Frontend displays it with the correct icon
   - Gene effects include "Fire Breath+" and "Fire Breath-"

## API Endpoints

### `/api/attribute-config/{species}`
Returns dynamic attribute configuration for a species:
```json
{
    "species": "BeeWasp",
    "attributes": [
        {"key": "Intelligence", "name": "Intelligence", "icon": "🧠"},
        {"key": "Ferocity", "name": "Ferocity", "icon": "🔥"}
    ],
    "all_attribute_names": ["intelligence", "ferocity", ...],
    "core_attributes": ["intelligence", "toughness", ...],
    "species_attributes": ["ferocity"]
}
```

### `/api/effect-options`
Returns dynamically generated gene effect options:
```json
[
    "None",
    "Ferocity+", "Ferocity-",
    "Intelligence+", "Intelligence-",
    "Temperament+", "Temperament-",
    ...
]
```

## Usage Examples

### Working with Pet Attributes
```python
# Create species-specific attributes
pet = Pet.from_genome_file("My Bee", "genome.txt")
assert pet.has_attribute("ferocity")  # True for BeeWasp
assert pet.has_attribute("temperament")  # False for BeeWasp

# Get/set attributes
pet.set_attribute_value("ferocity", 85.0)
ferocity = pet.get_attribute_value("ferocity")
```

### Database Operations
```python
# Add pet with species-specific attributes
pet_id = db.add_pet(
    name="Fire Bee",
    species="BeeWasp",
    attributes={
        "intelligence": 70.0,
        "ferocity": 95.0,  # BeeWasp-specific
        # Other attributes get defaults
    }
)

# Update specific attributes
db.update_pet(pet_id, attributes={"ferocity": 90.0})
```

### Frontend Integration
```javascript
// Load species configuration
const config = await fetch(`/api/attribute-config/${pet.species}`);
const attributeList = config.attributes;

// Render attributes dynamically
attributeList.forEach(attr => {
    renderAttribute(attr.icon, attr.name, pet.attributes[attr.key.toLowerCase()]);
});
```

## Migration and Backward Compatibility

- Existing pets are automatically migrated with new attribute columns
- Missing attributes default to 50.0
- All existing API endpoints continue to work
- Frontend gracefully handles pets with or without species-specific attributes

## Testing

The system includes comprehensive tests:
- `tests/test_attribute_config.py`: Tests the central configuration
- `tests/test_models.py`: Tests model integration
- Integration tests verify end-to-end functionality

## Performance Considerations

- Attribute configuration is cached at application startup
- Database queries are optimized with proper indexing
- Frontend loads configuration once per species
- No performance impact from the dynamic system

## Future Enhancements

The configuration-driven approach enables:
- **Attribute Relationships**: Define dependencies between attributes
- **Validation Rules**: Species-specific min/max values
- **Custom Icons**: Per-species icon overrides
- **Computed Attributes**: Derived values from other attributes
- **Inheritance**: Species hierarchies with attribute inheritance

## File Structure

```
src/gorgonetics/
├── attribute_config.py     # ⭐ Central configuration
├── models.py              # Uses config for validation
├── database.py            # Dynamic schema from config
├── web_app.py             # API endpoints use config
└── ...

tests/
├── test_attribute_config.py  # Configuration tests
├── test_models.py           # Model integration tests
└── ...

src/svelte/lib/components/
├── GeneStatsTable.svelte    # Loads config via API
├── GeneVisualizer.svelte    # Dynamic attribute handling
└── ...
```

## Summary

The new configuration-driven system achieves the goal of having attributes defined in only ONE place while maintaining full flexibility and extensibility. Adding new species or modifying existing attributes requires changes only to the central configuration, and everything else adapts automatically.

This design eliminates the previous hardcoding issues and makes the system much more maintainable and extensible.