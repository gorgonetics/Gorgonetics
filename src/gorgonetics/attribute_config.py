"""
Centralized attribute configuration for Gorgonetics.

This module defines all pet attributes in one place and provides utilities
to work with them dynamically across the entire application.
"""

from __future__ import annotations

from typing import Any


class AttributeConfig:
    """Centralized configuration for pet attributes."""

    # Ordered list of core attributes (matches game order)
    CORE_ATTRIBUTE_ORDER = [
        "toughness", "ruggedness", "enthusiasm",
        "friendliness", "intelligence", "virility"
    ]

    # Core attributes shared by all pet species
    CORE_ATTRIBUTES = {
        "intelligence": {
            "name": "Intelligence",
            "icon": "🧠",
            "default": 50.0,
            "description": "Mental capacity and problem-solving ability",
        },
        "toughness": {
            "name": "Toughness",
            "icon": "💪",
            "default": 50.0,
            "description": "Physical durability and resistance to damage",
        },
        "friendliness": {
            "name": "Friendliness",
            "icon": "😊",
            "default": 50.0,
            "description": "Social disposition and approachability",
        },
        "ruggedness": {
            "name": "Ruggedness",
            "icon": "🏔️",
            "default": 50.0,
            "description": "Ability to withstand harsh conditions",
        },
        "enthusiasm": {
            "name": "Enthusiasm",
            "icon": "✨",
            "default": 50.0,
            "description": "Energy level and eagerness to engage",
        },
        "virility": {
            "name": "Virility",
            "icon": "💜",
            "default": 50.0,
            "description": "Reproductive capability and vigor",
        },
    }

    # Species-specific additional attributes
    SPECIES_ATTRIBUTES = {
        "beewasp": {
            "ferocity": {
                "name": "Ferocity",
                "icon": "🔥",
                "default": 50.0,
                "description": "Aggressive tendencies and combat intensity",
            }
        },
        "horse": {
            "temperament": {
                "name": "Temperament",
                "icon": "🐎",
                "default": 50.0,
                "description": "Behavioral disposition and emotional stability",
            }
        },
    }

    # Species-specific appearance attributes
    SPECIES_APPEARANCE_ATTRIBUTES = {
        "beewasp": {
            "body-color-hue": {
                "name": "Body Color Hue",
                "examples": "Color tone",
                "color_indicator": "linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1)",
            },
            "body-color-saturation": {
                "name": "Body Color Saturation",
                "examples": "Color intensity",
                "color_indicator": "linear-gradient(90deg, #f8f9fa, #ff6b6b)",
            },
            "body-color-intensity": {
                "name": "Body Color Intensity",
                "examples": "Brightness",
                "color_indicator": "linear-gradient(90deg, #343a40, #f8f9fa)",
            },
            "wing-color-hue": {
                "name": "Wing Color Hue",
                "examples": "Wing tone",
                "color_indicator": "linear-gradient(45deg, #ffd93d, #6bcf7f, #4d72aa)",
            },
            "wing-color-saturation": {
                "name": "Wing Color Saturation",
                "examples": "Wing intensity",
                "color_indicator": "linear-gradient(90deg, #e9ecef, #ffd93d)",
            },
            "wing-color-intensity": {
                "name": "Wing Color Intensity",
                "examples": "Wing brightness",
                "color_indicator": "linear-gradient(90deg, #495057, #fff3cd)",
            },
            "body-scale": {"name": "Body Scale", "examples": "Body size", "color_indicator": "#8b5cf6"},
            "wing-scale": {"name": "Wing Scale", "examples": "Wing size", "color_indicator": "#06b6d4"},
            "head-scale": {"name": "Head Scale", "examples": "Head size", "color_indicator": "#f59e0b"},
            "tail-scale": {"name": "Tail Scale", "examples": "Tail size", "color_indicator": "#84cc16"},
            "antenna-scale": {"name": "Antenna Scale", "examples": "Antenna size", "color_indicator": "#ec4899"},
            "leg-deformity": {"name": "Leg Deformity", "examples": "Leg shape", "color_indicator": "#ef4444"},
            "antenna-deformity": {
                "name": "Antenna Deformity",
                "examples": "Antenna shape",
                "color_indicator": "#f97316",
            },
            "particles": {
                "name": "Particles",
                "examples": "Special effects",
                "color_indicator": "radial-gradient(circle, #fbbf24, #f59e0b)",
            },
            "particle-location": {
                "name": "Particle Location",
                "examples": "Effect position",
                "color_indicator": "conic-gradient(#8b5cf6, #ec4899, #06b6d4, #8b5cf6)",
            },
            "glow": {
                "name": "Glow",
                "examples": "Luminescence",
                "color_indicator": "radial-gradient(circle, #fef3c7, #f59e0b)",
            },
        },
        "horse": {
            "scale-kb": {
                "name": "Scale (Kb)",
                "examples": "Body scaling",
                "color_indicator": "#8b5cf6",
            },
            "attributes-kb": {
                "name": "Attributes (Kb)",
                "examples": "Physical attributes",
                "color_indicator": "#06b6d4",
            },
            "selector-sb": {
                "name": "Selector (Sb)",
                "examples": "Sable selector",
                "color_indicator": "#8b4513",
            },
            "selector-pt": {
                "name": "Selector (Pt)",
                "examples": "Point selector",
                "color_indicator": "#f59e0b",
            },
            "selector-po": {
                "name": "Selector (Po)",
                "examples": "Pony selector",
                "color_indicator": "#84cc16",
            },
            "selector-kb": {
                "name": "Selector (Kb)",
                "examples": "Kabuki selector",
                "color_indicator": "#ec4899",
            },
            "selector-bl": {
                "name": "Selector (Bl)",
                "examples": "Blue selector",
                "color_indicator": "#3b82f6",
            },
            "horn": {
                "name": "Horn",
                "examples": "Horn presence",
                "color_indicator": "#ef4444",
            },
            "horn-kb": {
                "name": "Horn (Kb)",
                "examples": "Kabuki horn",
                "color_indicator": "#f97316",
            },
        },
    }

    # Species name mappings (for flexible species recognition)
    SPECIES_MAPPINGS = {"beewasp": ["beewasp", "bee", "wasp"], "horse": ["horse"]}

    @classmethod
    def get_core_attribute_names(cls) -> list[str]:
        """Get list of core attribute names in game order."""
        return [attr for attr in cls.CORE_ATTRIBUTE_ORDER if attr in cls.CORE_ATTRIBUTES]

    @classmethod
    def get_core_attributes(cls) -> dict[str, dict[str, Any]]:
        """Get core attributes configuration."""
        return cls.CORE_ATTRIBUTES.copy()

    @classmethod
    def get_species_attribute_names(cls, species: str) -> list[str]:
        """Get list of additional attribute names for a species."""
        normalized_species = cls._normalize_species(species)
        if normalized_species in cls.SPECIES_ATTRIBUTES:
            return list(cls.SPECIES_ATTRIBUTES[normalized_species].keys())
        return []

    @classmethod
    def get_species_attributes(cls, species: str) -> dict[str, dict[str, Any]]:
        """Get species-specific attributes configuration."""
        normalized_species = cls._normalize_species(species)
        if normalized_species in cls.SPECIES_ATTRIBUTES:
            return cls.SPECIES_ATTRIBUTES[normalized_species].copy()
        return {}

    @classmethod
    def get_all_attribute_names(cls, species: str) -> list[str]:
        """Get list of all attribute names for a species (core + species-specific)."""
        core_attrs = cls.get_core_attribute_names()
        species_attrs = cls.get_species_attribute_names(species)
        return core_attrs + species_attrs

    @classmethod
    def get_all_attributes(cls, species: str) -> dict[str, dict[str, Any]]:
        """Get all attributes for a species (core + species-specific)."""
        all_attrs = cls.get_core_attributes()
        all_attrs.update(cls.get_species_attributes(species))
        return all_attrs

    @classmethod
    def get_attribute_info(cls, attribute_name: str, species: str = "") -> dict[str, Any] | None:
        """Get information about a specific attribute."""
        all_attrs = cls.get_all_attributes(species)
        return all_attrs.get(attribute_name.lower())

    @classmethod
    def get_default_values(cls, species: str) -> dict[str, int]:
        """Get default values for all attributes of a species."""
        all_attrs = cls.get_all_attributes(species)
        return {name: int(info["default"]) for name, info in all_attrs.items()}

    @classmethod
    def get_attribute_display_info(cls, species: str) -> list[dict[str, Any]]:
        """Get attribute display information for frontend use."""
        all_attrs = cls.get_all_attributes(species)
        return [
            {
                "key": name.title(),  # Capitalize for frontend consistency
                "name": info["name"],
                "icon": info["icon"],
                "description": info.get("description", ""),
            }
            for name, info in all_attrs.items()
        ]

    @classmethod
    def get_effect_options(cls) -> list[str]:
        """Get all possible gene effect options."""
        effects = ["None"]

        # Add core attribute effects
        for _attr_name, attr_info in cls.CORE_ATTRIBUTES.items():
            effects.extend([f"{attr_info['name']}+", f"{attr_info['name']}-"])

        # Add species-specific attribute effects
        for species_attrs in cls.SPECIES_ATTRIBUTES.values():
            for _attr_name, attr_info in species_attrs.items():
                effects.extend([f"{attr_info['name']}+", f"{attr_info['name']}-"])

        return sorted(effects)

    @classmethod
    def get_effect_options_for_species(cls, species: str) -> list[str]:
        """Get gene effect options for a specific species."""
        effects = ["None"]

        # Get all attributes for this species
        all_attrs = cls.get_all_attributes(species)

        # Add effects for each attribute
        for _attr_name, attr_info in all_attrs.items():
            effects.extend([f"{attr_info['name']}+", f"{attr_info['name']}-"])

        return sorted(effects)

    @classmethod
    def get_appearance_attribute_names(cls, species: str) -> list[str]:
        """Get list of appearance attribute names for a species."""
        normalized_species = cls._normalize_species(species)
        if normalized_species in cls.SPECIES_APPEARANCE_ATTRIBUTES:
            return list(cls.SPECIES_APPEARANCE_ATTRIBUTES[normalized_species].keys())
        return []

    @classmethod
    def get_appearance_attributes(cls, species: str) -> dict[str, dict[str, Any]]:
        """Get appearance attributes configuration for a species."""
        normalized_species = cls._normalize_species(species)
        if normalized_species in cls.SPECIES_APPEARANCE_ATTRIBUTES:
            return cls.SPECIES_APPEARANCE_ATTRIBUTES[normalized_species].copy()
        return {}

    @classmethod
    def get_appearance_display_info(cls, species: str) -> list[dict[str, Any]]:
        """Get appearance attribute display information for frontend use."""
        appearance_attrs = cls.get_appearance_attributes(species)
        return [
            {
                "key": name.replace("-", "_"),  # Convert to underscore for frontend consistency
                "name": info["name"],
                "examples": info["examples"],
                "color_indicator": info.get("color_indicator", "#6b7280"),
            }
            for name, info in appearance_attrs.items()
        ]

    @classmethod
    def is_valid_attribute(cls, attribute_name: str, species: str = "") -> bool:
        """Check if an attribute is valid for a given species."""
        all_attrs = cls.get_all_attribute_names(species)
        return attribute_name.lower() in [attr.lower() for attr in all_attrs]

    @classmethod
    def get_supported_species(cls) -> list[str]:
        """Get list of supported species names."""
        return list(cls.SPECIES_ATTRIBUTES.keys())

    @classmethod
    def is_valid_appearance_attribute(cls, attribute_name: str, species: str = "") -> bool:
        """Check if an appearance attribute is valid for a given species."""
        appearance_attrs = cls.get_appearance_attribute_names(species)
        return attribute_name.lower() in [attr.lower() for attr in appearance_attrs]

    @classmethod
    def _normalize_species(cls, species: str) -> str:
        """Normalize species name to standard form."""
        if not species:
            return ""

        species_lower = species.lower()

        # Check each species mapping
        for normalized, variants in cls.SPECIES_MAPPINGS.items():
            for variant in variants:
                if variant in species_lower:
                    return normalized

        return ""

    @classmethod
    def get_database_columns(cls) -> set[str]:
        """Get all possible database column names for attributes."""
        columns = set(cls.get_core_attribute_names())

        # Add all possible species-specific attributes
        for species_attrs in cls.SPECIES_ATTRIBUTES.values():
            columns.update(species_attrs.keys())

        return columns

    @classmethod
    def validate_attribute_dict(cls, attributes: dict[str, Any], species: str) -> dict[str, str]:
        """Validate an attribute dictionary and return any errors."""
        errors = {}
        valid_attrs = cls.get_all_attribute_names(species)
        valid_attrs_lower = [attr.lower() for attr in valid_attrs]

        for attr_name, value in attributes.items():
            # Check if attribute is valid for species
            if attr_name.lower() not in valid_attrs_lower:
                errors[attr_name] = f"Invalid attribute '{attr_name}' for species '{species}'"
                continue

            # Check if value is numeric
            try:
                float(value)
            except (ValueError, TypeError):
                errors[attr_name] = f"Attribute '{attr_name}' must be a numeric value"

        return errors
