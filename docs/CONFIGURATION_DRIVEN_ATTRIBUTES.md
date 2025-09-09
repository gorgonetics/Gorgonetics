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
    # Ordered list of core attributes (matches game order)
    CORE_ATTRIBUTE_ORDER = ["toughness", "ruggedness", "enthusiasm", 
                           "friendliness", "intelligence", "virility"]

    # Core attributes shared by all pet species
    CORE_ATTRIBUTES = {
        "intelligence": {
            "name": "Intelligence", 
            "icon": "🧠", 
            "default": 50.0,
            "description": "Mental capacity and problem-solving ability"
        },
        "toughness": {
            "name": "Toughness", 
            "icon": "💪", 
            "default": 50.0,
            "description": "Physical durability and resistance to damage"
        },
        # ... 6 core attributes total
    }

    # Species-specific behavioral attributes
    SPECIES_ATTRIBUTES = {
        "beewasp": {
            "ferocity": {
                "name": "Ferocity", 
                "icon": "🔥", 
                "default": 50.0,
                "description": "Aggressive tendencies and combat intensity"
            }
        },
        "horse": {
            "temperament": {
                "name": "Temperament", 
                "icon": "🐎", 
                "default": 50.0,
                "description": "Behavioral disposition and emotional stability"
            }
        }
    }

    # Species-specific appearance attributes
    SPECIES_APPEARANCE_ATTRIBUTES = {
        "beewasp": {
            "body-color-hue": {
                "name": "Body Color Hue",
                "examples": "Color tone",
                "color_indicator": "linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1)"
            },
            "body-scale": {
                "name": "Body Scale", 
                "examples": "Body size", 
                "color_indicator": "#8b5cf6"
            },
            "particles": {
                "name": "Particles",
                "examples": "Special effects",
                "color_indicator": "radial-gradient(circle, #fbbf24, #f59e0b)"
            },
            # ... 13 appearance attributes total for BeeWasp
        },
        "horse": {
            "coat": {
                "name": "Coat",
                "examples": "Coat effects (all breeds)",
                "color_indicator": "#2ecc71"
            },
            "markings": {
                "name": "Markings",
                "examples": "Markings effects (all breeds)",
                "color_indicator": "#16a085"
            },
            # ... 10 appearance attribute categories for Horse
        }
    }
```

All other components load from this configuration:

### Models Layer
- Pet models use individual typed fields with `AttributeValue = Annotated[int, Field(ge=0, le=100)]`
- Species-specific Pydantic classes: `CoreAttributes`, `BeeWaspAttributes`, `HorseAttributes`
- Automatic species detection and attribute validation with 0-100 integer range
- Dynamic attribute creation based on genome type

### Database Layer (`ducklake_database.py`)
- DuckLake database with individual INTEGER columns for each behavioral attribute
- Multi-user support with user isolation for pet data  
- Dynamic schema creation: separate columns for `intelligence`, `ferocity`, `temperament`, etc.
- Appearance data stored as JSON in `genome_data` column for visual gene effects
- Attribute values constrained to 0-100 integer range

### Web API Layer
- Dynamic endpoint responses based on species
- Configuration-driven effect options for gene editing
- Species-specific attribute validation

### Frontend Layer (Svelte 5)
- Loads attribute configuration from backend API
- Dynamic UI components adapt to species-specific attributes
- Separate rendering for behavioral vs appearance attributes
- Color-coded visualization for appearance gene effects
- Real-time attribute updates with reactive state management

## Current Species Support

### BeeWasp Species
- **Core Attributes**: Intelligence, Toughness, Friendliness, Ruggedness, Enthusiasm, Virility (in game order)
- **Behavioral Attributes**: Ferocity (🔥)
- **Appearance Attributes**: 13 attributes including:
  - Color system: body-color-hue, body-color-saturation, wing-color-hue, etc.
  - Scale system: body-scale, wing-scale, head-scale, tail-scale, antenna-scale
  - Special effects: particles, particle-location, glow
  - Deformities: leg-deformity, antenna-deformity
- **Recognition**: "beewasp", "bee", "wasp" (case-insensitive)

### Horse Species
- **Core Attributes**: Intelligence, Toughness, Friendliness, Ruggedness, Enthusiasm, Virility (in game order)
- **Behavioral Attributes**: Temperament (🐎)
- **Appearance Attributes**: 10 categories including:
  - Physical features: coat, hair, markings, face-markings, leg-markings
  - Magical elements: aura, magical, horn
  - Structure: scale, selector
  - General: attributes (breed-specific effects)
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
Returns behavioral attribute configuration for a species:
```json
{
    "species": "beewasp",
    "attributes": [
        {
            "key": "intelligence",
            "name": "Intelligence", 
            "icon": "🧠",
            "description": "Mental capacity and problem-solving ability"
        },
        {
            "key": "ferocity",
            "name": "Ferocity", 
            "icon": "🔥",
            "description": "Aggressive tendencies and combat intensity"
        }
    ],
    "all_attribute_names": ["intelligence", "toughness", "ferocity", ...],
    "core_attributes": ["intelligence", "toughness", "friendliness", ...],
    "species_attributes": ["ferocity"]
}
```

### `/api/appearance-config/{species}`
Returns appearance attribute configuration for a species:
```json
{
    "species": "beewasp", 
    "appearance_attributes": [
        {
            "key": "body-color-hue",
            "name": "Body Color Hue",
            "examples": "Color tone",
            "color_indicator": "linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1)"
        },
        {
            "key": "particles",
            "name": "Particles",
            "examples": "Special effects", 
            "color_indicator": "radial-gradient(circle, #fbbf24, #f59e0b)"
        }
    ],
    "appearance_attribute_names": ["body-color-hue", "body-scale", "particles", ...]
}
```

### `/api/effect-options`
Returns dynamically generated gene effect options (includes all attributes):
```json
[
    "None",
    "Appearance Only",
    "No Effect",
    "Intelligence+", "Intelligence-",
    "Ferocity+", "Ferocity-", 
    "Temperament+", "Temperament-",
    ...
]
```

## Usage Examples

### Working with Pet Attributes
```python
from gorgonetics.attribute_config import AttributeConfig

# Get attribute configuration
core_attrs = AttributeConfig.get_core_attributes()
species_attrs = AttributeConfig.get_species_attributes("beewasp")
appearance_attrs = AttributeConfig.get_appearance_attributes("beewasp")

# Check attribute availability
all_attrs = AttributeConfig.get_all_attribute_names("beewasp")
has_ferocity = "ferocity" in all_attrs  # True for BeeWasp
has_temperament = "temperament" in all_attrs  # False for BeeWasp

# Get attribute information
ferocity_info = AttributeConfig.get_attribute_info("ferocity", "beewasp")
print(f"Ferocity icon: {ferocity_info['icon']}")  # 🔥
print(f"Default value: {ferocity_info['default']}")  # 50.0

# Get default values for a species (returns integers 0-100)
defaults = AttributeConfig.get_default_values("beewasp")
print(f"Default ferocity: {defaults['ferocity']}")  # 50 (integer)

# Attribute values are always integers in range 0-100
print(f"Valid range: 0-100 integers")
print(f"Ferocity default: {ferocity_info['default']}")  # 50.0 (config) → 50 (database)
```

### Database Operations
```python
# Database schema has individual INTEGER columns for each attribute
from gorgonetics.ducklake_database import DuckLakeGeneDatabase
from gorgonetics.attribute_config import AttributeConfig

db = DuckLakeGeneDatabase()

# Table structure (auto-created):
# CREATE TABLE pets (
#     id INTEGER PRIMARY KEY,
#     name VARCHAR,
#     species VARCHAR,
#     user_id INTEGER,
#     genome_data JSON,
#     -- Individual columns for each attribute (0-100 integers):
#     intelligence INTEGER,
#     toughness INTEGER, 
#     friendliness INTEGER,
#     ruggedness INTEGER,
#     enthusiasm INTEGER,
#     virility INTEGER,
#     ferocity INTEGER,        -- BeeWasp only
#     temperament INTEGER,     -- Horse only
#     ...
# )

# Add pet - attributes passed as dict but stored as individual columns
pet_id = db.add_pet(
    name="Fire Bee",
    species="beewasp", 
    breeder="Player",
    genome_data=genome_json,
    content_hash=file_hash,
    user_id=user.id,
    attributes={
        "intelligence": 70,      # INTEGER column
        "ferocity": 95,         # INTEGER column (BeeWasp-specific)
        "toughness": 60         # INTEGER column
    }
)

# Update attributes - also updates individual columns
db.update_pet(pet_id, {"ferocity": 90, "intelligence": 75})
```

### Frontend Integration (Svelte 5)
```javascript
// Load pet data with attributes
import { apiClient } from '$lib/services/apiClient.js';
import { AttributeConfig } from '$lib/stores/appState.js';

// Get pet data
const pet = await apiClient.getPet(petId);
const species = pet.species;

// Get attribute configuration
const coreAttrs = AttributeConfig.getCoreAttributes();
const speciesAttrs = AttributeConfig.getSpeciesAttributes(species);
const appearanceAttrs = AttributeConfig.getAppearanceAttributes(species);

// Render behavioral attributes with icons
coreAttrs.forEach(attr => {
    const value = pet[attr.key] || attr.default;
    renderAttributeCard(attr.icon, attr.name, value, attr.description);
});

// Render appearance attributes with color indicators
appearanceAttrs.forEach(attr => {
    renderAppearanceEffect(attr.name, attr.color_indicator, pet.genome_data);
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
├── attribute_config.py        # ⭐ Central configuration
├── models.py                  # Pydantic models using config
├── ducklake_database.py       # DuckLake database with dynamic schema
├── database_config.py         # Database connection management
├── web_app.py                 # FastAPI endpoints with auth
├── auth/                      # Authentication module
│   ├── models.py             # User models
│   ├── utils.py              # JWT utilities
│   └── dependencies.py       # Auth dependencies
└── ...

src/svelte/
├── App.svelte                 # Main application
├── lib/
│   ├── components/
│   │   ├── GeneStatsTable.svelte     # Behavioral attribute display
│   │   ├── GeneVisualizer.svelte     # Appearance attribute visualization
│   │   ├── PetEditor.svelte          # Pet attribute editing
│   │   └── PetVisualization.svelte   # Complete pet display
│   ├── services/
│   │   └── apiClient.js              # API communication
│   └── stores/
│       ├── appState.js               # Application state
│       └── authStore.js              # Authentication state

tests/
├── test_attribute_config.py   # Comprehensive attribute config tests
├── integration/
│   └── test_api_integration.py # End-to-end API tests
└── client/
    └── test-client-api.js      # Frontend integration tests
```

## Summary

The new configuration-driven system achieves the goal of having attributes defined in only ONE place while maintaining full flexibility and extensibility. Adding new species or modifying existing attributes requires changes only to the central configuration, and everything else adapts automatically.

This design eliminates the previous hardcoding issues and makes the system much more maintainable and extensible.