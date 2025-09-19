# Code Quality Improvements for Alpha Deployment

This document identifies areas for code quality improvement before the first alpha deployment of Gorgonetics. The analysis covers the Python backend, Svelte frontend, and identifies patterns that can be refactored for better maintainability.

## Executive Summary

The codebase shows good structure overall, but several areas could benefit from refactoring to improve maintainability, reduce duplication, and eliminate potential issues before deployment.

## 🔴 High Priority Issues

### 1. Hardcoded HTTP Status Codes in Python Backend

**File:** `src/gorgonetics/web_app.py`

**Issue:** HTTP status codes are hardcoded throughout the file, repeated dozens of times.

**Examples:**
```python
raise HTTPException(status_code=500, detail="Failed to update genes")
raise HTTPException(status_code=404, detail="Pet not found")
raise HTTPException(status_code=400, detail="Failed to update gene")
raise HTTPException(status_code=403, detail="Demo pets cannot be modified")
```

**Recommendation:** Create constants for status codes:
```python
# Add to top of web_app.py or separate constants file
class HTTPStatus(Enum):
    OK = 200
    BAD_REQUEST = 400
    UNAUTHORIZED = 401
    FORBIDDEN = 403
    NOT_FOUND = 404
    CONFLICT = 409
    INTERNAL_SERVER_ERROR = 500
```

### 2. Repeated Error Message Patterns

**Files:** `src/gorgonetics/web_app.py`, `src/gorgonetics/ducklake_database.py`

**Issue:** Similar error handling patterns repeated throughout the codebase.

**Examples:**
```python
# Pattern repeated 20+ times
except Exception as e:
    logger.error(f"Error getting X: {e}")
    raise HTTPException(status_code=500, detail="Failed to get X") from e
```

**Recommendation:** Create error handling decorators or utility functions:
```python
def handle_api_errors(operation_name: str, status_code: int = 500):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Error {operation_name}: {e}")
                raise HTTPException(status_code=status_code, detail=f"Failed to {operation_name}") from e
        return wrapper
    return decorator
```

### 3. Demo Pet User ID Magic Number

**Files:** `src/gorgonetics/web_app.py:532`, `src/gorgonetics/ducklake_database.py:770`

**Issue:** Demo pets use hardcoded `-1` user ID scattered throughout code.

**Examples:**
```python
user_id = -1  # Demo pets have user_id = -1
if pet_data.get("user_id") == -1:
```

**Recommendation:** Create constant:
```python
DEMO_USER_ID = -1
```

## 🟡 Medium Priority Issues

### 4. Repeated Species Name Mapping Logic

**File:** `src/gorgonetics/web_app.py:322-339`

**Issue:** Species normalization logic is duplicated.

**Current:**
```python
# Normalize species name to handle database vs config mismatches
normalized_species = species.lower()
species_mapping = {"beewasp": "beewasp", "bee": "beewasp", "wasp": "beewasp", "horse": "horse"}
config_species = species_mapping.get(normalized_species, normalized_species)
```

**Recommendation:** Extract to utility function in `attribute_config.py`:
```python
@classmethod
def normalize_species_name(cls, species: str) -> str:
    """Normalize species names for consistent internal use."""
    normalized = species.lower()
    mapping = {"bee": "beewasp", "wasp": "beewasp"}
    return mapping.get(normalized, normalized)
```

### 5. Repeated Update Dictionary Building

**Files:** `src/gorgonetics/web_app.py:114-135`, `src/gorgonetics/web_app.py:285-295`

**Issue:** Same pattern for building update dictionaries from request data.

**Current Pattern:**
```python
updates = {}
if request_data.field1 is not None:
    updates["field1"] = request_data.field1
if request_data.field2 is not None:
    updates["field2"] = request_data.field2
# ... repeated for each field
```

**Recommendation:** Create utility function:
```python
def build_update_dict(data: BaseModel, exclude_fields: set[str] = None) -> dict[str, Any]:
    """Build update dictionary from Pydantic model, excluding None values."""
    exclude_fields = exclude_fields or set()
    return {k: v for k, v in data.model_dump(exclude_unset=True).items()
            if k not in exclude_fields and v is not None}
```

### 6. Hardcoded API Endpoints in Frontend

**File:** `src/svelte/lib/services/apiClient.js`

**Issue:** API endpoints are hardcoded strings throughout the file.

**Examples:**
```javascript
"/api/animal-types"
"/api/effect-options"
"/api/pets/upload"
"/api/auth/login"
```

**Recommendation:** Create API endpoints configuration:
```javascript
const API_ENDPOINTS = {
  ANIMAL_TYPES: '/api/animal-types',
  EFFECT_OPTIONS: '/api/effect-options',
  PETS: {
    LIST: '/api/pets',
    UPLOAD: '/api/pets/upload',
    GET: (id) => `/api/pets/${id}`,
    DELETE: (id) => `/api/pets/${id}`
  },
  AUTH: {
    LOGIN: '/api/auth/login',
    REGISTER: '/api/auth/register',
    ME: '/api/auth/me',
    LOGOUT: '/api/auth/logout'
  }
};
```

### 7. Repeated Auth Header Pattern

**File:** `src/svelte/lib/services/apiClient.js`

**Issue:** Authentication header building is duplicated in several methods.

**Current:**
```javascript
headers: token ? { 'Authorization': `Bearer ${token}` } : {}
```

**Recommendation:** Already has `getAuthHeaders()` method - ensure it's used consistently.

## 🟢 Low Priority Issues

### 8. Console.log Statements in Production Code

**Files:** Various Svelte components and `apiClient.js`

**Issue:** Development console.log statements should be removed or controlled.

**Examples:**
```javascript
console.log("API Client initialized");
console.log(`🐾 Selected pet: ${pet ? pet.name : "none"}`);
```

**Recommendation:**
- Remove development logs or use a proper logging system
- Consider environment-based logging utility

### 9. Unused CSS Custom Properties

**File:** `src/svelte/public/styles.css`

**Issue:** Some CSS custom properties may not be used.

**Examples:**
```css
--gene-antenna-scale: #ba68c8;
--gene-leg-deformity: #e91e63;
--gene-antenna-deformity: #c2185b;
```

**Recommendation:** Audit CSS usage and remove unused custom properties.

### 10. Database Field Type Inconsistencies

**Files:** `src/gorgonetics/ducklake_database.py:197-208`

**Issue:** Dynamic column types determined by simple type checking.

**Current:**
```python
column_type = "VARCHAR" if attr_config.get("type") == "string" else "INTEGER"
```

**Recommendation:** Define explicit type mapping:
```python
TYPE_MAPPING = {
    "string": "VARCHAR",
    "integer": "INTEGER",
    "float": "REAL",
    "boolean": "BOOLEAN"
}
```

### 11. Unnamed SQL Parameter Placeholders

**Files:** `src/gorgonetics/auth/dependencies.py`, `src/gorgonetics/ducklake_database.py`

**Issue:** SQL queries use unnamed placeholders `(?, ?, ?, ?)` which are hard to read and maintain.

**Examples:**
```python
# Hard to read
db.conn.execute(
    """INSERT INTO users (id, username, password_hash, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'user', true, ?, ?)""",
    (next_id, user_create.username, password_hash, now, now),
)

# Parameter order confusion
user_data = db.conn.execute(
    "SELECT id, username, role, is_active, created_at, updated_at FROM users WHERE username = ? AND is_active = true",
    (token_data.username,),
).fetchone()
```

**Recommendation:** Use named parameters or explicit column mapping:
```python
# Better readability with named parameters
db.conn.execute(
    """INSERT INTO users (id, username, password_hash, role, is_active, created_at, updated_at)
       VALUES (:id, :username, :password_hash, :role, :is_active, :created_at, :updated_at)""",
    {
        "id": next_id,
        "username": user_create.username,
        "password_hash": password_hash,
        "role": "user",
        "is_active": True,
        "created_at": now,
        "updated_at": now
    },
)
```

### 12. Inconsistent Import Styles

**Files:** Throughout Python codebase

**Issue:** Mix of absolute and relative imports creates inconsistency and potential confusion.

**Examples:**
```python
# Mixed styles in the same codebase
from .attribute_config import AttributeConfig  # Relative
from gorgonetics.models import Genome          # Absolute
from ..constants import UserRole               # Relative parent
```

**Recommendation:** Standardize on absolute imports for better clarity:
```python
# Consistent absolute imports
from gorgonetics.attribute_config import AttributeConfig
from gorgonetics.models import Genome
from gorgonetics.constants import UserRole
from gorgonetics.auth.models import User
```

**Benefits:**
- Clearer module paths
- Better IDE support and refactoring
- Explicit dependencies
- Consistent style across codebase
- No confusion about import resolution

## 📊 Code Patterns Analysis

### Repeated Patterns That Could Be Refactored

1. **Error Handling Pattern** (23 occurrences in `web_app.py`)
   - Standard try/catch with logging and HTTPException
   - Could be extracted to decorator

2. **Database Connection Assertions** (15+ occurrences in `ducklake_database.py`)
   ```python
   assert self.conn is not None
   ```
   - Could be replaced with property or method

3. **Pet Genome Parsing** (2-3 different implementations)
   - Should be unified into single utility

4. **Species Name Normalization** (3 different implementations)
   - Should use single source of truth

5. **Unnamed SQL Parameters** (15+ occurrences across auth and database files)
   - Hard to read and maintain
   - Should use named parameters for clarity

6. **Inconsistent Import Styles** (Throughout Python codebase)
   - Mix of relative and absolute imports
   - Should standardize on absolute imports

## 🛠 Recommended Implementation Order

1. **Phase 1 (Pre-Alpha):**
   - ✅ Use FastAPI status constants consistently
   - ✅ Extract demo user ID constant
   - ✅ Create centralized constants for user roles and genders
   - ✅ Remove console.log statements
   - ✅ Replace unnamed SQL parameters with named parameters
   - ✅ Standardize on absolute imports

2. **Phase 2 (Post-Alpha):**
   - Create error handling decorators
   - Unify species normalization
   - Create API endpoints constants

3. **Phase 3 (Future Refactoring):**
   - Unified genome parsing utilities
   - Database type mapping improvements
   - CSS cleanup

## 💡 Additional Recommendations

### Code Organization
- Consider creating a `constants.py` file for shared constants
- Create `utils/` directory for shared utility functions
- Establish error handling patterns documentation

### Testing
- Add tests for the new utility functions
- Ensure error handling decorators are well-tested
- Validate API endpoint constants don't break existing functionality

### Documentation
- Document the species normalization logic
- Create API endpoint reference
- Add comments explaining magic numbers and special cases

## Conclusion

The codebase is well-structured overall but would benefit from reducing duplication and extracting common patterns. The identified improvements would make the code more maintainable and reduce the chance of bugs in production. Most issues are low-risk but addressing them proactively will pay dividends as the codebase grows.

**Estimated effort:** 1-2 days for Phase 1 improvements, which should be sufficient for alpha deployment readiness.