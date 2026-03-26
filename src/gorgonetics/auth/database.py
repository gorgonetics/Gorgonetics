"""SQLite-backed authentication database for user and session management."""

import logging
import sqlite3
from datetime import datetime
from typing import Any

from gorgonetics.auth.models import User, UserInDB

logger = logging.getLogger(__name__)


class AuthDatabase:
    """Transactional SQLite store for users and sessions.

    Separated from the DuckLake analytical store so auth operations
    get proper ACID transactions without creating Parquet snapshot bloat.
    """

    def __init__(self, db_path: str = "users.sqlite") -> None:
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self._create_tables()

    def _create_tables(self) -> None:
        """Create auth tables if they don't exist."""
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token_jti TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        self.conn.commit()

    @staticmethod
    def _row_to_user(row: sqlite3.Row) -> User:
        """Convert a Row to a User model."""
        return User(
            id=row["id"],
            username=row["username"],
            role=row["role"],
            is_active=bool(row["is_active"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _row_to_user_in_db(row: sqlite3.Row) -> UserInDB:
        """Convert a Row to a UserInDB model (includes password_hash)."""
        return UserInDB(
            id=row["id"],
            username=row["username"],
            password_hash=row["password_hash"],
            role=row["role"],
            is_active=bool(row["is_active"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def create_user(self, username: str, password_hash: str, role: str = "user") -> User:
        """Create a new user. Returns the created User."""
        now = datetime.now().isoformat()
        cursor = self.conn.execute(
            "INSERT INTO users (username, password_hash, role, is_active, created_at, updated_at) VALUES (:username, :password_hash, :role, 1, :created_at, :updated_at)",
            {"username": username, "password_hash": password_hash, "role": role, "created_at": now, "updated_at": now},
        )
        self.conn.commit()
        row = self.conn.execute("SELECT * FROM users WHERE id = :id", {"id": cursor.lastrowid}).fetchone()
        return self._row_to_user(row)

    def get_user_by_username(self, username: str) -> UserInDB | None:
        """Get user by username including password_hash (for auth verification)."""
        row = self.conn.execute("SELECT * FROM users WHERE username = :username", {"username": username}).fetchone()
        if not row:
            return None
        return self._row_to_user_in_db(row)

    def get_active_user_by_username(self, username: str) -> User | None:
        """Get an active user by username (no password_hash)."""
        row = self.conn.execute(
            "SELECT * FROM users WHERE username = :username AND is_active = 1", {"username": username}
        ).fetchone()
        if not row:
            return None
        return self._row_to_user(row)

    def get_user_by_id(self, user_id: int) -> User | None:
        """Get user by ID (no password_hash)."""
        row = self.conn.execute("SELECT * FROM users WHERE id = :id", {"id": user_id}).fetchone()
        if not row:
            return None
        return self._row_to_user(row)

    def get_all_users(self) -> list[User]:
        """Return all users (no password_hashes)."""
        rows = self.conn.execute("SELECT * FROM users ORDER BY id").fetchall()
        return [self._row_to_user(row) for row in rows]

    def update_user(self, user_id: int, **fields: Any) -> User | None:
        """Update user fields (role, is_active). Returns updated User or None."""
        allowed = {"role", "is_active"}
        updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
        if not updates:
            return self.get_user_by_id(user_id)

        updates["updated_at"] = datetime.now().isoformat()
        set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
        updates["id"] = user_id
        self.conn.execute(f"UPDATE users SET {set_clauses} WHERE id = :id", updates)
        self.conn.commit()
        return self.get_user_by_id(user_id)

    def delete_user(self, user_id: int) -> bool:
        """Delete a user and their sessions. Returns True if user existed."""
        row = self.conn.execute("SELECT id FROM users WHERE id = :id", {"id": user_id}).fetchone()
        if not row:
            return False
        # CASCADE handles user_sessions deletion
        self.conn.execute("DELETE FROM users WHERE id = :id", {"id": user_id})
        self.conn.commit()
        return True

    def close(self) -> None:
        """Close database connection."""
        if self.conn:
            self.conn.close()

    def __enter__(self) -> "AuthDatabase":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()
