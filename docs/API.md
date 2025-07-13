# API Documentation

## Overview

The PGBreeder API is built with FastAPI and provides RESTful endpoints for managing genetic data. All endpoints return JSON responses and follow standard HTTP status codes.

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

#### Get Specific Gene
```http
GET /api/gene/{animal_type}/{gene}
```

Returns data for a specific gene.

**Parameters:**
- `animal_type` (path): Animal type identifier
- `gene` (path): Gene identifier (e.g., "01A1")

**Response:**
```json
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
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Gene not found

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

#### Export Specific Chromosome
```http
GET /api/export/{animal_type}/{chromosome}
```

Exports data for a specific chromosome as JSON.

**Parameters:**
- `animal_type` (path): Animal type identifier
- `chromosome` (path): Chromosome identifier

**Response:**
```json
{
  "animal_type": "beewasp",
  "chromosome": "chr01",
  "export_date": "2025-01-01T00:00:00",
  "genes": [
    {
      "gene": "01A1",
      "effect_dominant": "Intelligence+",
      "effect_recessive": "Intelligence-",
      "appearance": "Brighter antenna glow",
      "notes": "Observed in lab conditions"
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Animal type or chromosome not found

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

## Versioning

The API currently does not implement versioning. Future versions may include versioning in the URL path (e.g., `/api/v1/`).

## Support

For API support and bug reports, please create an issue in the GitHub repository.
