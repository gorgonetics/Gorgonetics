#!/bin/bash
# Test script for Docker containerization

echo "Testing Gorgonetics Docker setup..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not in PATH"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo "❌ Docker daemon is not running"
    echo "Please start Docker Desktop or Docker daemon"
    exit 1
fi

echo "✅ Docker is available"

# Build the image
echo "Building Docker image..."
docker build -t gorgonetics:latest . || {
    echo "❌ Docker build failed"
    exit 1
}

echo "✅ Docker image built successfully"

# Test with docker compose
echo "Testing with docker compose..."
docker compose up -d || {
    echo "❌ docker compose up failed"
    exit 1
}

# Wait for health check
echo "Waiting for application to be healthy..."
sleep 10

# Test health endpoint
if curl -f http://localhost:8000/health &> /dev/null; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    docker compose logs
    docker compose down
    exit 1
fi

# Cleanup
echo "Cleaning up..."
docker compose down

echo "✅ All tests passed! Container setup is working correctly."