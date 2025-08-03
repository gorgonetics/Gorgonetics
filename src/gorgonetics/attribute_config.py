"""
Centralized attribute configuration for Gorgonetics.

This module defines all pet attributes in one place and provides utilities
to work with them dynamically across the entire application.
"""

from __future__ import annotations

from typing import Any


class AttributeConfig:
    """Centralized configuration for pet attributes."""

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

    # Species name mappings (for flexible species recognition)
    SPECIES_MAPPINGS = {"beewasp": ["beewasp", "bee", "wasp"], "horse": ["horse"]}

    @classmethod
    def get_core_attribute_names(cls) -> list[str]:
        """Get list of core attribute names."""
        return list(cls.CORE_ATTRIBUTES.keys())

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
    def get_default_values(cls, species: str) -> dict[str, float]:
        """Get default values for all attributes of a species."""
        all_attrs = cls.get_all_attributes(species)
        return {name: info["default"] for name, info in all_attrs.items()}

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
        for attr_name, attr_info in all_attrs.items():
            effects.extend([f"{attr_info['name']}+", f"{attr_info['name']}-"])

        return sorted(effects)

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
