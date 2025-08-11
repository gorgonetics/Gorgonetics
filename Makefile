# Gorgonetics Project Makefile
# Provides convenient commands for development and testing

.PHONY: help install test test-integration test-client test-quick test-api test-performance lint format typecheck clean setup dev populate-db run-web coverage

# Default target
help:
	@echo "🧬 Gorgonetics Development Commands"
	@echo "================================="
	@echo ""
	@echo "Setup & Installation:"
	@echo "  make setup          - Set up development environment"
	@echo "  make install        - Install dependencies"
	@echo "  make dev            - Install dev dependencies"
	@echo ""
	@echo "Testing:"
	@echo "  make test           - Run all tests (integration + client)"
	@echo "  make test-integration - Run Python integration tests"
	@echo "  make test-client    - Run JavaScript client tests"
	@echo "  make test-quick     - Run quick tests (no performance)"
	@echo "  make test-api       - Test API endpoints only"
	@echo "  make test-performance - Run performance tests"
	@echo "  make coverage       - Generate coverage report"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint           - Check code with ruff"
	@echo "  make format         - Format code with ruff"
	@echo "  make typecheck      - Type check with mypy"
	@echo ""
	@echo "Database:"
	@echo "  make populate-db    - Populate database with gene data"
	@echo ""
	@echo "Development:"
	@echo "  make run-web        - Start web application"
	@echo "  make clean          - Clean build artifacts"

# Setup and installation
setup: install dev
	@echo "✅ Development environment ready!"

install:
	@echo "📦 Installing dependencies..."
	uv sync

dev:
	@echo "🛠️  Installing development dependencies..."
	uv sync --dev
	uv pip install pytest pytest-cov pytest-timeout pytest-mock
	npm install

# Testing commands
test: lint typecheck test-integration test-client
	@echo "🎉 All tests completed!"

test-integration:
	@echo "🧪 Running integration tests..."
	uv run python scripts/run_integration_tests.py --categories

test-client:
	@echo "🌐 Running client-side API tests..."
	node scripts/run_client_tests.js run

test-quick:
	@echo "⚡ Running quick tests..."
	uv run python scripts/run_integration_tests.py --quick

test-api:
	@echo "🌐 Testing API endpoints..."
	uv run pytest tests/integration/test_api_integration.py::TestGeneEndpoints -v
	uv run pytest tests/integration/test_api_integration.py::TestPetEndpoints -v
	uv run pytest tests/integration/test_api_integration.py::TestConfigEndpoints -v

test-performance:
	@echo "⚡ Running performance tests..."
	uv run python scripts/run_integration_tests.py --performance

coverage:
	@echo "📊 Generating coverage report..."
	uv run python scripts/run_integration_tests.py --coverage
	@echo "📋 Coverage report generated in htmlcov/"

# Code quality
lint:
	@echo "🔍 Checking code with ruff..."
	uv run ruff check src/ tests/ scripts/
	@echo "✅ Linting passed!"

format:
	@echo "✨ Formatting code with ruff..."
	uv run ruff format src/ tests/ scripts/
	@echo "✅ Code formatted!"

typecheck:
	@echo "🔬 Type checking with mypy..."
	uv run mypy src/
	@echo "✅ Type checking passed!"

# Database operations
populate-db:
	@echo "📊 Populating database with gene data..."
	uv run python scripts/populate_database.py
	@echo "✅ Database populated!"

# Development commands
run-web:
	@echo "🚀 Starting web application..."
	@echo "🌐 Open your browser to: http://127.0.0.1:8000"
	uv run python scripts/run_web_app.py

# Cleanup
clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf .pytest_cache/
	rm -rf htmlcov/
	rm -rf .coverage
	rm -rf __pycache__/
	rm -rf src/**/__pycache__/
	rm -rf tests/**/__pycache__/
	rm -rf scripts/**/__pycache__/
	rm -rf .mypy_cache/
	rm -rf .ruff_cache/
	rm -rf *.db
	rm -rf *.sqlite
	rm -rf test_*.db
	rm -rf test_*.sqlite
	rm -rf test_data/
	rm -rf test_client_*
	rm -rf node_modules/.cache/
	@echo "✅ Cleanup complete!"

# CI/CD simulation
ci-test: clean setup test
	@echo "🤖 CI/CD pipeline simulation complete!"

# Quick development workflow
dev-check: format lint typecheck test-quick test-client
	@echo "🚀 Development check complete - ready to commit!"

# Full quality gate
quality-gate: format lint typecheck test coverage
	@echo "🎯 Quality gate passed - ready for production!"

# Client-specific commands
test-client-watch:
	@echo "👀 Running client tests in watch mode..."
	node scripts/run_client_tests.js watch

test-client-ui:
	@echo "🎨 Opening client test UI..."
	node scripts/run_client_tests.js ui

test-client-coverage:
	@echo "📊 Running client tests with coverage..."
	node scripts/run_client_tests.js coverage
