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
    "effect_dominant": "Intelligence+",
    "effect_recessive": "Intelligence-",
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



#### Update Gene
```http
PUT /api/gene
```

Updates gene data.

**Request Body:**
```json
{
  "animal_type": "beewasp",
  "gene": "01A1",
  "effect_dominant": "Intelligence+",
  "effect_recessive": "Intelligence-",
  "appearance": "Updated appearance",
  "notes": "Updated notes"
}
```

**Response:**
```json
{
  "message": "Gene updated successfully"
}
```

**Status Codes:**
- `200 OK` - Gene updated successfully
- `400 Bad Request` - Invalid request data
- `404 Not Found` - Gene not found
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
  "Speed+",
  "Speed-",
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
        "effect_dominant": "Intelligence+",
        "effect_recessive": "Intelligence-",
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

### Pets

#### Get All Pets
```http
GET /api/pets
```

Returns a list of all uploaded pets.

**Response:**
```json
[
  {
    "id": 1,
    "name": "BabyFaeBee178",
    "species": "beewasp", 
    "breeder": "PlayerName",
    "created_at": "2025-01-01T00:00:00"
  }
]
```

**Status Codes:**
- `200 OK` - Success

#### Get Pet by ID
```http
GET /api/pets/{pet_id}
```

Returns data for a specific pet.

**Parameters:**
- `pet_id` (path): Pet identifier

**Response:**
```json
{
  "id": 1,
  "name": "BabyFaeBee178",
  "species": "beewasp",
  "breeder": "PlayerName", 
  "created_at": "2025-01-01T00:00:00"
}
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Pet not found

#### Update Pet
```http
PUT /api/pets/{pet_id}
```

Updates pet data.

**Parameters:**
- `pet_id` (path): Pet identifier

**Request Body:**
```json
{
  "name": "Updated Pet Name",
  "breeder": "Updated Breeder Name"
}
```

**Response:**
```json
{
  "message": "Pet updated successfully"
}
```

**Status Codes:**
- `200 OK` - Pet updated successfully
- `404 Not Found` - Pet not found
- `500 Internal Server Error` - Database error

#### Delete Pet
```http
DELETE /api/pets/{pet_id}
```

Deletes a pet.

**Parameters:**
- `pet_id` (path): Pet identifier

**Response:**
```json
{
  "message": "Pet deleted successfully"
}
```

**Status Codes:**
- `200 OK` - Pet deleted successfully
- `404 Not Found` - Pet not found
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
- `404 Not Found` - Resource not found
- `422 Unprocessable Entity` - Validation error
- `500 Internal Server Error` - Server error

## Rate Limiting

Currently no rate limiting is implemented. For production use, consider implementing rate limiting based on your requirements.

## Authentication

Currently no authentication is required. For production use, consider implementing appropriate authentication mechanisms.

## CORS

CORS is currently configured to allow all origins for development. For production, configure specific allowed origins.

## Examples

### Using curl

#### Get animal types:
```bash
curl -X GET "http://127.0.0.1:8000/api/animal-types"
```

#### Get genes for a chromosome:
```bash
curl -X GET "http://127.0.0.1:8000/api/genes/beewasp/chr01"
```

#### Update a gene:
```bash
curl -X PUT "http://127.0.0.1:8000/api/gene" \
  -H "Content-Type: application/json" \
  -d '{
    "animal_type": "beewasp",
    "gene": "01A1",
    "effect_dominant": "Intelligence+",
    "effect_recessive": "Intelligence-",
    "appearance": "Updated appearance",
    "notes": "Updated notes"
  }'
```

#### Export chromosome:
```bash
curl -X GET "http://127.0.0.1:8000/api/export/beewasp/chr01"
```

#### Get all pets:
```bash
curl -X GET "http://127.0.0.1:8000/api/pets"
```

#### Delete a pet:
```bash
curl -X DELETE "http://127.0.0.1:8000/api/pets/1"
```

### Using JavaScript

#### Fetch animal types:
```javascript
const response = await fetch('/api/animal-types');
const animalTypes = await response.json();
console.log(animalTypes);
```

#### Update a gene:
```javascript
const response = await fetch('/api/gene', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    animal_type: 'beewasp',
    gene: '01A1',
    effect_dominant: 'Intelligence+',
    effect_recessive: 'Intelligence-',
    appearance: 'Updated appearance',
    notes: 'Updated notes'
  })
});

if (response.ok) {
  const result = await response.json();
  console.log(result.message);
}
```

#### Get pets and select one:
```javascript
const response = await fetch('/api/pets');
const pets = await response.json();
if (pets.length > 0) {
  const petGenome = await fetch(`/api/pet-genome/${pets[0].id}`);
  const genomeData = await petGenome.json();
  console.log(genomeData);
}
```

## Versioning

The API currently does not implement versioning. Future versions may include versioning in the URL path (e.g., `/api/v1/`).

## Support

For API support and bug reports, please create an issue in the GitHub repository.
