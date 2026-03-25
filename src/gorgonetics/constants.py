"""
Constants module for Gorgonetics application.

This module contains shared constants used across the application to avoid
hardcoded values and improve maintainability.
"""

from enum import StrEnum


class UserRole(StrEnum):
    """User roles in the system."""

    ADMIN = "admin"
    USER = "user"


class Gender(StrEnum):
    """Pet gender constants."""

    MALE = "Male"
    FEMALE = "Female"


# Demo user special ID
DEMO_USER_ID = -1

# Default attribute values
DEFAULT_ATTRIBUTE_VALUE = 50

# File format validation constants
GENOME_FILE_MARKERS = ["[Overview]", "Genome Type:"]
