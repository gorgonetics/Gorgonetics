#!/usr/bin/env python3
"""Quick script to check if sample pets exist in the database."""

from gorgonetics.database_config import create_database_instance


def check_pets():
    """Check if sample pets are loaded."""
    db = create_database_instance()

    try:
        # Check for demo pets (user_id = -1)
        result = db.conn.execute("SELECT id, name, species FROM pets WHERE user_id = -1").fetchall()

        if result:
            print(f"Found {len(result)} sample pets:")
            for pet in result:
                print(f"  ID: {pet[0]}, Name: {pet[1]}, Species: {pet[2]}")
        else:
            print("No sample pets found")

        # Check total pets
        total = db.conn.execute("SELECT COUNT(*) FROM pets").fetchone()
        print(f"Total pets in database: {total[0] if total else 0}")

    except Exception as e:
        print(f"Error checking pets: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    check_pets()
