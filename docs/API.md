# API Documentation

## Overview

The Gorgonetics API is built with FastAPI and provides RESTful endpoints for managing genetic data. All endpoints return JSON responses and follow standard HTTP status codes.

## Base URL

```
http://127.0.0.1:8000
```

## Interactive Documentation

FastAPI automatically generates interactive API documentation:
- **Swagger UI**: `http://127.0.0.1:8000/docs`
- **ReDoc**: `http://127.0.0.1:8000/redoc`

## Endpoints

### Animal Types

#### Get Animal Types
```http
GET /api/animal-types
```

Returns a list of available animal types.

**Response:**
```json
["beewasp", "horse"]
```

**Status Codes:**
- `200 OK` - Success

---

### Chromosomes

#### Get Chromosomes for Animal Type
```http
GET /api/chromosomes/{animal_type}
```

Returns available chromosomes for the specified animal type.

**Parameters:**
- `animal_type` (path): Animal type identifier (e.g., "beewasp", "horse")

**Response:**
```json
["chr01", "chr02", "chr03", ...]
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Animal type not found

---

### Genes

#### Get Genes for Chromosome
```http
GET /api/genes/{animal_type}/{chromosome}
```

Returns all genes for a specific chromosome of an animal type.

**Parameters:**
- `animal_type` (path): Animal type identifier
- `chromosome` (path): Chromosome identifier (e.g., "chr01")

**Response:**
```json
[
  {
    "animal_type": "beewasp",
    "chromosome": "chr01",
    "gene": "01A1",
    "effectDominant": "Intelligence+",
    "effectRecessive": "Intelligence-",
    "appearance": "Brighter antenna glow",
    "notes": "Observed in lab conditions",
    "created_at": "2025-01-01T00:00:00",
    "updated_at": "2025-01-01T00:00:00"
  }
]
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Animal type or chromosome not found

---

#### Get Single Gene
```http
GET /api/gene/{animal_type}/{gene}
```

Returns a single gene record.

**Parameters:**
- `animal_type` (path): Animal type identifier (e.g., "beewasp", "horse")
- `gene` (path): Gene identifier (e.g., "01A1")

**Response:**
```json
{
  "animal_type": "beewasp",
  "chromosome": "chr01",
  "gene": "01A1",
  "effectDominant": "Intelligence+",
  "effectRecessive": "Intelligence-",
  "appearance": "Brighter antenna glow",
  "notes": "Observed in lab conditions",
  "created_at": "2025-01-01T00:00:00"
}
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Gene not found
- `500 Internal Server Error` - Database error

---

#### Update Gene
```http
PUT /api/gene
```

Updates individual gene data.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "animal_type": "beewasp",
  "gene": "01A1",
  "effectDominant": "Intelligence+",
  "effectRecessive": "Intelligence-",
  "appearance": "Updated appearance",
  "notes": "Updated notes"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Gene updated successfully"
}
```

**Status Codes:**
- `200 OK` - Gene updated successfully
- `400 Bad Request` - Invalid request data
- `401 Unauthorized` - Not authenticated
- `404 Not Found` - Gene not found
- `500 Internal Server Error` - Database error

---

#### Bulk Update Genes (Admin Only)
```http
PUT /api/genes
```

Bulk update multiple genes for a chromosome. Requires admin role.

**Headers:** `Authorization: Bearer <admin-token>`

**Request Body:**
```json
{
  "animal_type": "beewasp",
  "chromosome": "chr01",
  "genes": [
    {
      "gene": "01A1",
      "effectDominant": "Intelligence+",
      "effectRecessive": "Intelligence-",
      "appearance": "Updated appearance",
      "notes": "Updated notes"
    }
  ]
}
```

**Response:**
```json
{
  "status": "success",
  "message": "5 genes updated"
}
```

**Status Codes:**
- `200 OK` - Genes updated successfully
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Admin role required
- `500 Internal Server Error` - Database error

---

### Effect Options

#### Get Effect Options
```http
GET /api/effect-options
```

Returns available effect options for gene editing.

**Response:**
```json
[
  "Intelligence+",
  "Intelligence-",
  "Toughness+",
  "Toughness-",
  "Metabolism+",
  "Metabolism-",
  "Appearance Only",
  "No Effect"
]
```

**Status Codes:**
- `200 OK` - Success

---

### Export

#### Export All Chromosomes
```http
GET /api/export/{animal_type}
```

Exports all chromosome data for an animal type as JSON.

**Parameters:**
- `animal_type` (path): Animal type identifier

**Response:**
```json
{
  "animal_type": "beewasp",
  "export_date": "2025-01-01T00:00:00",
  "chromosomes": {
    "chr01": [
      {
        "gene": "01A1",
        "effectDominant": "Intelligence+",
        "effectRecessive": "Intelligence-",
        "appearance": "Brighter antenna glow",
        "notes": "Observed in lab conditions"
      }
    ]
  }
}
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Animal type not found



#### Download Chromosome File
```http
GET /api/download/{animal_type}/{chromosome}
```

Downloads chromosome data as a JSON file.

**Parameters:**
- `animal_type` (path): Animal type identifier
- `chromosome` (path): Chromosome identifier

**Response:**
- Content-Type: `application/json`
- Content-Disposition: `attachment; filename="{animal_type}_{chromosome}_genes.json"`

**Status Codes:**
- `200 OK` - File download initiated
- `404 Not Found` - Animal type or chromosome not found

---

### Authentication Endpoints

#### Register User (Admin-only)
```http
POST /api/auth/register
Authorization: Bearer <admin-access-token>
```

Create a new user account. Requires admin authentication (invite-only registration).

**Request Body:**
```json
{
  "username": "your_username",
  "password": "your_password"
}
```

**Response:**
```json
{
  "id": 1,
  "username": "your_username",
  "role": "user",
  "is_active": true,
  "created_at": "2025-01-01T00:00:00",
  "updated_at": "2025-01-01T00:00:00"
}
```

**Status Codes:**
- `200 OK` - User created successfully
- `400 Bad Request` - Username already exists
- `401 Unauthorized` - Not authenticated
- `403 Forbidden` - Not an admin
- `500 Internal Server Error` - Registration failed

---

#### Login User
```http
POST /api/auth/login
```

Authenticate user and receive access tokens.

**Request Body:**
```json
{
  "username": "your_username",
  "password": "your_password"
}
```

**Response:**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refresh_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "token_type": "bearer"
}
```

**Status Codes:**
- `200 OK` - Login successful
- `401 Unauthorized` - Invalid credentials
- `400 Bad Request` - Inactive user

---

#### Get Current User
```http
GET /api/auth/me
```

Get current authenticated user information.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "id": 1,
  "username": "your_username",
  "role": "user",
  "is_active": true,
  "created_at": "2025-01-01T00:00:00",
  "updated_at": "2025-01-01T00:00:00"
}
```

---

#### Logout User
```http
POST /api/auth/logout
```

Logout current user (client should discard tokens).

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "message": "Successfully logged out"
}
```

---

#### Refresh Token
```http
POST /api/auth/refresh
```

Exchange a valid refresh token for a new access/refresh token pair.

**Request Body:**
```json
{
  "refresh_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

**Response:**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refresh_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "token_type": "bearer"
}
```

**Status Codes:**
- `200 OK` - New token pair returned
- `401 Unauthorized` - Invalid or expired refresh token, or user inactive

---

### Pets

#### Get All Pets
```http
GET /api/pets
```

Returns pets for the current user. Admins can see all pets.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `limit` (integer, optional): Max pets to return (1--200). Omit for all.
- `offset` (integer, optional): Number of pets to skip (default: 0).

**Response:**
```json
{
  "items": [
    {
      "id": 1,
      "name": "BabyFaeBee178",
      "species": "beewasp",
      "breeder": "PlayerName",
      "user_id": 1,
      "gender": "Male",
      "created_at": "2025-01-01T00:00:00",
      "notes": "My favorite pet"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

**Status Codes:**
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated

#### Upload Pet Genome
```http
POST /api/pets/upload
```

Upload a pet genome file to create a new pet.

**Headers:** `Authorization: Bearer <token>`

**Request Body:** (multipart/form-data)
- `file` (file): Genome file (.txt format)
- `name` (string, optional): Override pet name
- `gender` (string, optional): Pet gender (default: "Male")
- `notes` (string, optional): Additional notes

**Response:**
```json
{
  "status": "success",
  "message": "Pet created successfully",
  "pet_id": 1,
  "name": "BabyFaeBee178"
}
```

**Status Codes:**
- `200 OK` - Pet created successfully
- `400 Bad Request` - Invalid file format
- `401 Unauthorized` - Not authenticated
- `409 Conflict` - File already uploaded
- `500 Internal Server Error` - Upload failed

---

#### Get Pet by ID
```http
GET /api/pets/{pet_id}
```

Returns data for a specific pet.

**Headers:** `Authorization: Bearer <token>`

**Parameters:**
- `pet_id` (path): Pet identifier

**Response:**
```json
{
  "id": 1,
  "name": "BabyFaeBee178",
  "species": "beewasp",
  "breeder": "PlayerName",
  "user_id": 1,
  "gender": "Male",
  "created_at": "2025-01-01T00:00:00",
  "notes": "My favorite pet",
  "attributes": {
    "intelligence": 75,
    "toughness": 60,
    "friendliness": 80
  }
}
```

**Status Codes:**
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `404 Not Found` - Pet not found

#### Update Pet
```http
PUT /api/pets/{pet_id}
```

Updates pet data and attributes.

**Headers:** `Authorization: Bearer <token>`

**Parameters:**
- `pet_id` (path): Pet identifier

**Request Body:**
```json
{
  "name": "Updated Pet Name",
  "gender": "Female",
  "breed": "Standardbred",
  "notes": "Updated notes",
  "attributes": {
    "intelligence": 85,
    "toughness": 70,
    "friendliness": 90
  }
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Pet updated successfully"
}
```

**Status Codes:**
- `200 OK` - Pet updated successfully
- `401 Unauthorized` - Not authenticated
- `404 Not Found` - Pet not found
- `500 Internal Server Error` - Database error

#### Delete Pet
```http
DELETE /api/pets/{pet_id}
```

Deletes a pet.

**Headers:** `Authorization: Bearer <token>`

**Parameters:**
- `pet_id` (path): Pet identifier

**Response:**
```json
{
  "status": "success",
  "message": "Pet deleted successfully"
}
```

**Status Codes:**
- `200 OK` - Pet deleted successfully
- `401 Unauthorized` - Not authenticated
- `404 Not Found` - Pet not found
- `500 Internal Server Error` - Database error

---

#### Get Pets by Species
```http
GET /api/pets/species/{species}
```

Get pets of a specific species. Admins see all pets, users see only their own.

**Headers:** `Authorization: Bearer <token>`

**Parameters:**
- `species` (path): Species identifier (e.g., "beewasp", "horse")

**Response:**
```json
[
  {
    "id": 1,
    "name": "BabyFaeBee178",
    "species": "beewasp",
    "breeder": "PlayerName",
    "user_id": 1
  }
]
```

**Status Codes:**
- `200 OK` - Success
- `401 Unauthorized` - Not authenticated
- `500 Internal Server Error` - Database error

#### Get Pet Genome
```http
GET /api/pet-genome/{pet_id}
```

Returns genome data for visualization.

**Parameters:**
- `pet_id` (path): Pet identifier

**Response:**
```json
{
  "pet_id": 1,
  "name": "BabyFaeBee178", 
  "species": "beewasp",
  "genes": {
    "chr01": [
      {
        "gene": "01A1",
        "dominant": "Intelligence+",
        "recessive": "Intelligence-",
        "type": "positive"
      }
    ]
  }
}
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Pet not found

---

### Configuration

#### Get Attribute Config

```http
GET /api/attribute-config/{species}
```

Returns the attribute configuration for a species (e.g., attribute names, defaults).

**Parameters:**
- `species` (path) - Species name (e.g., `beewasp`, `horse`)

**Status Codes:**
- `200 OK` - Success

---

#### Get Appearance Config

```http
GET /api/appearance-config/{species}
```

Returns the appearance attribute configuration for a species.

**Parameters:**
- `species` (path) - Species name

**Status Codes:**
- `200 OK` - Success

---

#### Get Species-Specific Effect Options

```http
GET /api/effect-options/{species}
```

Returns effect options filtered for a specific species.

**Parameters:**
- `species` (path) - Species name

**Status Codes:**
- `200 OK` - Success

---

#### Get Gene Effects for Visualization

```http
GET /api/gene-effects/{species}
```

Returns all gene effects for a species, keyed by gene ID. Used by the visualization component to render gene effect data without N+1 queries.

**Parameters:**
- `species` (path): Species name (e.g., "beewasp", "horse")

**Response:**
```json
{
  "effects": {
    "01A1": {
      "effectDominant": "Intelligence+",
      "effectRecessive": "Intelligence-",
      "appearance": "Brighter antenna glow",
      "notes": "Observed in lab conditions"
    },
    "01A2": {
      "effectDominant": "Toughness+",
      "effectRecessive": "None",
      "appearance": "",
      "notes": ""
    }
  }
}
```

**Status Codes:**
- `200 OK` - Success
- `500 Internal Server Error` - Database error

---

### Health

#### Health Check

```http
GET /health
```

Returns application health status.

**Response:**
```json
{
  "status": "healthy"
}
```

---

## Error Responses

All error responses follow this format:

```json
{
  "detail": "Error message description"
}
```

### Common Status Codes

- `200 OK` - Request successful
- `400 Bad Request` - Invalid request data
- `401 Unauthorized` - Authentication required or invalid token
- `403 Forbidden` - Insufficient permissions (admin role required)
- `404 Not Found` - Resource not found
- `409 Conflict` - Resource already exists (duplicate upload)
- `422 Unprocessable Entity` - Validation error
- `500 Internal Server Error` - Server error

## Rate Limiting

Currently no rate limiting is implemented. For production use, consider implementing rate limiting based on your requirements.

## Authentication

The API uses JWT (JSON Web Token) based authentication with Bearer tokens.

### Authentication Flow

1. **Register** or **Login** to receive access and refresh tokens
2. **Include Bearer token** in Authorization header for protected endpoints
3. **Refresh tokens** when access token expires

### Protected Endpoints

Most endpoints require authentication. Public endpoints:
- `/api/animal-types`
- `/api/chromosomes/{animal_type}`  
- `/api/genes/{animal_type}/{chromosome}`
- `/api/effect-options`

All pet management and gene editing endpoints require authentication.

### Admin Endpoints

The following endpoints require admin role:
- User registration (`POST /api/auth/register`) — invite-only
- Bulk gene updates (`PUT /api/genes`)
- Single gene updates (`PUT /api/gene`)
- List users (`GET /api/admin/users`)
- Get user (`GET /api/admin/users/{user_id}`)
- Update user role/status (`PATCH /api/admin/users/{user_id}`)
- Delete user (`DELETE /api/admin/users/{user_id}`)

### Authentication Headers

```http
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

## Examples

### Using curl

#### Register a user:
```bash
curl -X POST "http://127.0.0.1:8000/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "password": "testpassword"}'
```

#### Login and get tokens:
```bash
curl -X POST "http://127.0.0.1:8000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "password": "testpassword"}'
```

#### Get animal types (public):
```bash
curl -X GET "http://127.0.0.1:8000/api/animal-types"
```

#### Get genes for a chromosome (public):
```bash
curl -X GET "http://127.0.0.1:8000/api/genes/beewasp/chr01"
```

#### Update a gene (authenticated):
```bash
curl -X PUT "http://127.0.0.1:8000/api/gene" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "animal_type": "beewasp",
    "gene": "01A1",
    "effectDominant": "Intelligence+",
    "effectRecessive": "Intelligence-",
    "appearance": "Updated appearance",
    "notes": "Updated notes"
  }'
```

#### Get all pets (authenticated):
```bash
curl -X GET "http://127.0.0.1:8000/api/pets" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

#### Upload pet genome (authenticated):
```bash
curl -X POST "http://127.0.0.1:8000/api/pets/upload" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "file=@genome.txt" \
  -F "name=MyPet" \
  -F "gender=Female"
```

#### Delete a pet (authenticated):
```bash
curl -X DELETE "http://127.0.0.1:8000/api/pets/1" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Using JavaScript

#### Login and store token:
```javascript
const loginResponse = await fetch('/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    username: 'testuser',
    password: 'testpassword'
  })
});

const tokens = await loginResponse.json();
const accessToken = tokens.access_token;

// Store token for subsequent requests
localStorage.setItem('access_token', accessToken);
```

#### Fetch animal types (public):
```javascript
const response = await fetch('/api/animal-types');
const animalTypes = await response.json();
console.log(animalTypes);
```

#### Update a gene (authenticated):
```javascript
const token = localStorage.getItem('access_token');

const response = await fetch('/api/gene', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    animal_type: 'beewasp',
    gene: '01A1',
    effectDominant: 'Intelligence+',
    effectRecessive: 'Intelligence-',
    appearance: 'Updated appearance',
    notes: 'Updated notes'
  })
});

if (response.ok) {
  const result = await response.json();
  console.log(result.message);
}
```

#### Get pets (authenticated):
```javascript
const token = localStorage.getItem('access_token');

const response = await fetch('/api/pets', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const { items: pets, total } = await response.json();

// Get genome for first pet
if (pets.length > 0) {
  const petGenome = await fetch(`/api/pet-genome/${pets[0].id}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const genomeData = await petGenome.json();
  console.log(genomeData);
}
```

#### Upload pet genome (authenticated):
```javascript
const token = localStorage.getItem('access_token');
const fileInput = document.getElementById('genome-file');
const formData = new FormData();

formData.append('file', fileInput.files[0]);
formData.append('name', 'MyPet');
formData.append('gender', 'Female');

const response = await fetch('/api/pets/upload', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});

if (response.ok) {
  const result = await response.json();
  console.log('Pet uploaded:', result.name);
}
```

## Versioning

The API currently does not implement versioning. Future versions may include versioning in the URL path (e.g., `/api/v1/`).

## Support

For API support and bug reports, please create an issue in the GitHub repository.
