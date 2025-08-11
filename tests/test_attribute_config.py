"""
Tests for the AttributeConfig centralized configuration system.
"""

from gorgonetics.attribute_config import AttributeConfig


class TestAttributeConfig:
    """Test the AttributeConfig class."""

    def test_core_attributes(self) -> None:
        """Test core attributes configuration."""
        core_attrs = AttributeConfig.get_core_attributes()

        # Check that we have the expected core attributes
        expected_core = {"intelligence", "toughness", "friendliness", "ruggedness", "enthusiasm", "virility"}
        assert set(core_attrs.keys()) == expected_core

        # Check that each attribute has required fields
        for _attr_name, attr_info in core_attrs.items():
            assert "name" in attr_info
            assert "icon" in attr_info
            assert "default" in attr_info
            assert "description" in attr_info
            assert isinstance(attr_info["default"], float)
            assert attr_info["default"] == 50.0

    def test_species_attributes(self) -> None:
        """Test species-specific attributes."""
        # Test BeeWasp attributes
        bee_attrs = AttributeConfig.get_species_attributes("BeeWasp")
        assert "ferocity" in bee_attrs
        assert bee_attrs["ferocity"]["name"] == "Ferocity"
        assert bee_attrs["ferocity"]["icon"] == "🔥"
        assert bee_attrs["ferocity"]["default"] == 50.0

        # Test Horse attributes
        horse_attrs = AttributeConfig.get_species_attributes("Horse")
        assert "temperament" in horse_attrs
        assert horse_attrs["temperament"]["name"] == "Temperament"
        assert horse_attrs["temperament"]["icon"] == "🐎"
        assert horse_attrs["temperament"]["default"] == 50.0

        # Test unknown species
        unknown_attrs = AttributeConfig.get_species_attributes("UnknownSpecies")
        assert len(unknown_attrs) == 0

    def test_species_normalization(self) -> None:
        """Test species name normalization."""
        # Test BeeWasp variants
        for variant in ["BeeWasp", "beewasp", "bee", "wasp", "BEEWASP"]:
            attrs = AttributeConfig.get_species_attributes(variant)
            assert "ferocity" in attrs

        # Test Horse variants
        for variant in ["Horse", "horse", "HORSE"]:
            attrs = AttributeConfig.get_species_attributes(variant)
            assert "temperament" in attrs

    def test_get_all_attributes(self) -> None:
        """Test getting all attributes for a species."""
        # Test BeeWasp
        bee_all = AttributeConfig.get_all_attributes("BeeWasp")
        expected_bee = {"intelligence", "toughness", "friendliness", "ruggedness", "enthusiasm", "virility", "ferocity"}
        assert set(bee_all.keys()) == expected_bee

        # Test Horse
        horse_all = AttributeConfig.get_all_attributes("Horse")
        expected_horse = {
            "intelligence",
            "toughness",
            "friendliness",
            "ruggedness",
            "enthusiasm",
            "virility",
            "temperament",
        }
        assert set(horse_all.keys()) == expected_horse

        # Test unknown species (should get core only)
        unknown_all = AttributeConfig.get_all_attributes("UnknownSpecies")
        expected_core = {"intelligence", "toughness", "friendliness", "ruggedness", "enthusiasm", "virility"}
        assert set(unknown_all.keys()) == expected_core

    def test_get_attribute_names(self) -> None:
        """Test getting attribute name lists."""
        # Test core attribute names
        core_names = AttributeConfig.get_core_attribute_names()
        expected_core = ["intelligence", "toughness", "friendliness", "ruggedness", "enthusiasm", "virility"]
        assert set(core_names) == set(expected_core)

        # Test species attribute names
        bee_species_names = AttributeConfig.get_species_attribute_names("BeeWasp")
        assert bee_species_names == ["ferocity"]

        horse_species_names = AttributeConfig.get_species_attribute_names("Horse")
        assert horse_species_names == ["temperament"]

        # Test all attribute names
        bee_all_names = AttributeConfig.get_all_attribute_names("BeeWasp")
        assert "ferocity" in bee_all_names
        assert "intelligence" in bee_all_names
        assert len(bee_all_names) == 7

    def test_default_values(self) -> None:
        """Test getting default values."""
        # Test BeeWasp defaults
        bee_defaults = AttributeConfig.get_default_values("BeeWasp")
        assert bee_defaults["intelligence"] == 50.0
        assert bee_defaults["ferocity"] == 50.0
        assert len(bee_defaults) == 7

        # Test Horse defaults
        horse_defaults = AttributeConfig.get_default_values("Horse")
        assert horse_defaults["intelligence"] == 50.0
        assert horse_defaults["temperament"] == 50.0
        assert len(horse_defaults) == 7

        # Test unknown species defaults
        unknown_defaults = AttributeConfig.get_default_values("UnknownSpecies")
        assert len(unknown_defaults) == 6  # Core attributes only

    def test_attribute_display_info(self) -> None:
        """Test getting attribute display information."""
        bee_display = AttributeConfig.get_attribute_display_info("BeeWasp")

        # Should have 7 attributes for BeeWasp
        assert len(bee_display) == 7

        # Check structure of display info
        for attr_info in bee_display:
            assert "key" in attr_info
            assert "name" in attr_info
            assert "icon" in attr_info
            assert "description" in attr_info

        # Check that Ferocity is included for BeeWasp
        ferocity_found = any(attr["name"] == "Ferocity" for attr in bee_display)
        assert ferocity_found

        # Check Horse display info
        horse_display = AttributeConfig.get_attribute_display_info("Horse")
        temperament_found = any(attr["name"] == "Temperament" for attr in horse_display)
        assert temperament_found

    def test_effect_options(self) -> None:
        """Test getting effect options for gene editing."""
        effects = AttributeConfig.get_effect_options()

        # Should include None
        assert "None" in effects

        # Should include core attribute effects
        assert "Intelligence+" in effects
        assert "Intelligence-" in effects
        assert "Toughness+" in effects
        assert "Toughness-" in effects

        # Should include species-specific effects
        assert "Ferocity+" in effects
        assert "Ferocity-" in effects
        assert "Temperament+" in effects
        assert "Temperament-" in effects

        # Should be sorted
        assert effects == sorted(effects)

    def test_effect_options_for_species(self) -> None:
        """Test getting effect options for specific species."""
        # Test BeeWasp effect options
        bee_effects = AttributeConfig.get_effect_options_for_species("BeeWasp")

        # Should include None
        assert "None" in bee_effects

        # Should include core attribute effects
        assert "Intelligence+" in bee_effects
        assert "Intelligence-" in bee_effects
        assert "Toughness+" in bee_effects
        assert "Toughness-" in bee_effects

        # Should include BeeWasp-specific effects
        assert "Ferocity+" in bee_effects
        assert "Ferocity-" in bee_effects

        # Should NOT include Horse-specific effects
        assert "Temperament+" not in bee_effects
        assert "Temperament-" not in bee_effects

        # Test Horse effect options
        horse_effects = AttributeConfig.get_effect_options_for_species("Horse")

        # Should include core attribute effects
        assert "Intelligence+" in horse_effects
        assert "Toughness+" in horse_effects

        # Should include Horse-specific effects
        assert "Temperament+" in horse_effects
        assert "Temperament-" in horse_effects

        # Should NOT include BeeWasp-specific effects
        assert "Ferocity+" not in horse_effects
        assert "Ferocity-" not in horse_effects

        # Should be sorted
        assert bee_effects == sorted(bee_effects)
        assert horse_effects == sorted(horse_effects)

        # Should be smaller than all options
        all_effects = AttributeConfig.get_effect_options()
        assert len(bee_effects) < len(all_effects)
        assert len(horse_effects) < len(all_effects)

    def test_attribute_validation(self) -> None:
        """Test attribute validation."""
        # Test valid attributes
        assert AttributeConfig.is_valid_attribute("intelligence", "BeeWasp")
        assert AttributeConfig.is_valid_attribute("ferocity", "BeeWasp")
        assert AttributeConfig.is_valid_attribute("temperament", "Horse")

        # Test invalid attributes
        assert not AttributeConfig.is_valid_attribute("temperament", "BeeWasp")
        assert not AttributeConfig.is_valid_attribute("ferocity", "Horse")
        assert not AttributeConfig.is_valid_attribute("invalid_attr", "BeeWasp")

    def test_validate_attribute_dict(self) -> None:
        """Test attribute dictionary validation."""
        # Test valid BeeWasp attributes
        valid_bee_attrs = {"intelligence": 70.0, "ferocity": 85.0, "toughness": 60.0}
        errors = AttributeConfig.validate_attribute_dict(valid_bee_attrs, "BeeWasp")
        assert len(errors) == 0

        # Test invalid attributes for species
        invalid_attrs = {
            "intelligence": 70.0,
            "temperament": 85.0,  # Invalid for BeeWasp
            "invalid_attr": 60.0,  # Invalid for any species
        }
        errors = AttributeConfig.validate_attribute_dict(invalid_attrs, "BeeWasp")
        assert len(errors) == 2
        assert "temperament" in errors
        assert "invalid_attr" in errors

        # Test invalid values
        invalid_values = {"intelligence": "not_a_number", "ferocity": None}
        errors = AttributeConfig.validate_attribute_dict(invalid_values, "BeeWasp")
        assert len(errors) == 2

    def test_database_columns(self) -> None:
        """Test getting database column names."""
        columns = AttributeConfig.get_database_columns()

        # Should include all core attributes
        assert "intelligence" in columns
        assert "toughness" in columns

        # Should include all species-specific attributes
        assert "ferocity" in columns
        assert "temperament" in columns

        # Should be a set (no duplicates)
        assert isinstance(columns, set)

    def test_supported_species(self) -> None:
        """Test getting supported species list."""
        species = AttributeConfig.get_supported_species()
        assert "beewasp" in species
        assert "horse" in species
        assert isinstance(species, list)

    def test_get_attribute_info(self) -> None:
        """Test getting specific attribute information."""
        # Test core attribute
        intel_info = AttributeConfig.get_attribute_info("intelligence", "BeeWasp")
        assert intel_info is not None
        assert intel_info["name"] == "Intelligence"
        assert intel_info["icon"] == "🧠"

        # Test species-specific attribute
        ferocity_info = AttributeConfig.get_attribute_info("ferocity", "BeeWasp")
        assert ferocity_info is not None
        assert ferocity_info["name"] == "Ferocity"
        assert ferocity_info["icon"] == "🔥"

        # Test invalid attribute
        invalid_info = AttributeConfig.get_attribute_info("invalid", "BeeWasp")
        assert invalid_info is None

        # Test attribute not valid for species
        temp_info = AttributeConfig.get_attribute_info("temperament", "BeeWasp")
        assert temp_info is None

    def test_appearance_attributes(self) -> None:
        """Test appearance attributes configuration."""
        # Test BeeWasp appearance attributes
        bee_appearance = AttributeConfig.get_appearance_attributes("BeeWasp")
        assert "body-color-hue" in bee_appearance
        assert "wing-color-hue" in bee_appearance
        assert "antenna-scale" in bee_appearance
        assert bee_appearance["body-color-hue"]["name"] == "Body Color Hue"

        # Test Horse appearance attributes
        horse_appearance = AttributeConfig.get_appearance_attributes("Horse")
        assert "scale-kb" in horse_appearance
        assert "horn" in horse_appearance
        assert "selector-pt" in horse_appearance
        assert horse_appearance["scale-kb"]["name"] == "Scale (Kb)"

        # Different from BeeWasp
        assert "wing-color-hue" not in horse_appearance
        assert "antenna-scale" not in horse_appearance

        # Test unknown species
        unknown_appearance = AttributeConfig.get_appearance_attributes("Dragon")
        assert len(unknown_appearance) == 0

    def test_appearance_attribute_names(self) -> None:
        """Test getting appearance attribute name lists."""
        # Test BeeWasp appearance attribute names
        bee_names = AttributeConfig.get_appearance_attribute_names("BeeWasp")
        expected_bee = {
            "body-color-hue",
            "body-color-saturation",
            "body-color-intensity",
            "wing-color-hue",
            "wing-color-saturation",
            "wing-color-intensity",
            "body-scale",
            "wing-scale",
            "head-scale",
            "tail-scale",
            "antenna-scale",
            "leg-deformity",
            "antenna-deformity",
            "particles",
            "particle-location",
            "glow",
        }
        assert set(bee_names) == expected_bee

        # Test Horse appearance attribute names
        horse_names = AttributeConfig.get_appearance_attribute_names("Horse")
        expected_horse = {
            "scale-kb",
            "attributes-kb",
            "selector-sb",
            "selector-pt",
            "selector-po",
            "selector-kb",
            "selector-bl",
            "horn",
            "horn-kb",
        }
        assert set(horse_names) == expected_horse

        # Test unknown species
        unknown_names = AttributeConfig.get_appearance_attribute_names("Unknown")
        assert len(unknown_names) == 0

    def test_appearance_display_info(self) -> None:
        """Test appearance attribute display information."""
        # Test BeeWasp appearance display info
        bee_display = AttributeConfig.get_appearance_display_info("BeeWasp")

        # Should have expected number of appearance attributes
        assert len(bee_display) == 16

        # Check structure of display info
        for attr_info in bee_display:
            assert "key" in attr_info
            assert "name" in attr_info
            assert "examples" in attr_info
            assert "color_indicator" in attr_info

        # Check specific attributes
        body_hue = next((attr for attr in bee_display if attr["name"] == "Body Color Hue"), None)
        assert body_hue is not None
        assert body_hue["examples"] == "Color tone"
        assert "gradient" in body_hue["color_indicator"]

        # Test Horse appearance display info
        horse_display = AttributeConfig.get_appearance_display_info("Horse")

        # Should have different number of appearance attributes
        assert len(horse_display) == 9

        # Check Horse-specific attribute
        scale_kb = next((attr for attr in horse_display if attr["name"] == "Scale (Kb)"), None)
        assert scale_kb is not None
        assert scale_kb["examples"] == "Body scaling"

    def test_appearance_attribute_validation(self) -> None:
        """Test appearance attribute validation."""
        # Test valid appearance attributes
        assert AttributeConfig.is_valid_appearance_attribute("body-color-hue", "BeeWasp")
        assert AttributeConfig.is_valid_appearance_attribute("scale-kb", "Horse")

        # Test invalid appearance attributes for species
        assert not AttributeConfig.is_valid_appearance_attribute("scale-kb", "BeeWasp")
        assert not AttributeConfig.is_valid_appearance_attribute("antenna-scale", "Horse")

        # Test invalid appearance attributes
        assert not AttributeConfig.is_valid_appearance_attribute("invalid-attr", "BeeWasp")
