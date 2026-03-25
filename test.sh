#!/bin/bash
# Simple test runner for Gorgonetics
# This script provides quick commands to run integration tests

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Usage information
usage() {
    echo "🧬 Gorgonetics Complete Test Runner"
    echo ""
    echo "Usage: ./test.sh [command]"
    echo ""
    echo "Commands:"
    echo "  all         - Run all tests (integration + client) with full automation"
    echo "  quick       - Run Python integration tests only (fast)"
    echo "  api         - Test API endpoints only"
    echo "  genes       - Test gene endpoints"
    echo "  pets        - Test pet endpoints"
    echo "  consistency - Test data consistency"
    echo "  client      - Run JavaScript client tests (fully automated with server)"
    echo "  client-ui   - Run client tests with interactive UI"
    echo "  setup       - Set up test environment"
    echo "  clean       - Clean test artifacts"
    echo "  help        - Show this help"
    echo ""
    echo "✨ Features:"
    echo "  • Automatic server startup/shutdown for client tests"
    echo "  • Complete isolation between test runs"
    echo "  • Real HTTP testing with live Python server"
    echo "  • Comprehensive test result summaries"
    echo ""
    echo "Examples:"
    echo "  ./test.sh all        # Complete test suite (recommended)"
    echo "  ./test.sh quick      # Fast Python-only test run"
    echo "  ./test.sh client     # Full-stack JavaScript testing"
    echo "  ./test.sh genes      # Test specific gene APIs"
    echo "  ./test.sh setup      # Install all dependencies"
}

# Setup test environment
setup_tests() {
    print_status "Setting up test environment..."

    if ! command -v uv &> /dev/null; then
        print_error "uv not found. Please install uv first."
        exit 1
    fi

    print_status "Installing dependencies..."
    uv sync --dev

    print_status "Installing test dependencies..."
    uv pip install pytest pytest-cov pytest-timeout pytest-mock

    print_status "Installing client test dependencies..."
    pnpm install

    print_success "Test environment ready!"
}

# Clean test artifacts
clean_tests() {
    print_status "Cleaning test artifacts..."

    rm -rf .pytest_cache/
    rm -rf htmlcov/
    rm -rf .coverage
    rm -rf __pycache__/
    rm -rf src/**/__pycache__/
    rm -rf tests/**/__pycache__/
    rm -rf scripts/**/__pycache__/
    rm -rf *.db
    rm -rf *.sqlite
    rm -rf test_*.db
    rm -rf test_*.sqlite
    rm -rf test_data/
    rm -rf test_client_data/
    rm -f client_test_server.log

    print_success "Cleanup complete!"
}

# Run all integration tests
run_all_tests() {
    print_status "Running all integration tests..."
    uv run python scripts/run_integration_tests.py --categories
}

# Run quick tests
run_quick_tests() {
    print_status "Running quick integration tests..."
    uv run python scripts/run_integration_tests.py --quick
}

# Run all tests (integration + client)
run_all_tests_complete() {
    print_status "Running complete test suite..."

    print_status "1/2 Running integration tests..."
    if uv run python scripts/run_integration_tests.py --quick; then
        integration_result=0
        print_success "Integration tests passed!"
    else
        integration_result=1
        print_error "Integration tests failed!"
    fi

    print_status "2/2 Running client tests..."
    if run_client_tests; then
        client_result=0
    else
        client_result=1
    fi

    # Show summary
    echo ""
    echo -e "${BLUE}🧬 Test Results Summary${NC}"
    echo -e "${BLUE}=================================================${NC}"

    if [ $integration_result -eq 0 ]; then
        echo -e "✅ ${GREEN}Integration Tests: PASSED${NC}"
    else
        echo -e "❌ ${RED}Integration Tests: FAILED${NC}"
    fi

    if [ $client_result -eq 0 ]; then
        echo -e "✅ ${GREEN}Client Tests: PASSED${NC}"
    else
        echo -e "❌ ${RED}Client Tests: FAILED${NC}"
    fi

    echo ""

    if [ $integration_result -eq 0 ] && [ $client_result -eq 0 ]; then
        print_success "🎉 ALL TESTS PASSED! 🎉"
        echo ""
        echo -e "${GREEN}✅ Python API endpoints are working correctly${NC}"
        echo -e "${GREEN}✅ JavaScript client can communicate with the API${NC}"
        echo -e "${GREEN}✅ Frontend should work properly with the backend${NC}"
        echo ""
        return 0
    else
        print_error "Some tests failed!"
        echo ""
        if [ $integration_result -ne 0 ]; then
            echo -e "${RED}❌ Backend API has issues${NC}"
        fi
        if [ $client_result -ne 0 ]; then
            echo -e "${RED}❌ Frontend-backend communication has issues${NC}"
        fi
        echo ""
        return 1
    fi
}

# Run API tests
run_api_tests() {
    print_status "Running API endpoint tests..."
    uv run python -m pytest tests/integration/test_api_integration.py::TestGeneEndpoints -v
    uv run python -m pytest tests/integration/test_api_integration.py::TestConfigEndpoints -v
    uv run python -m pytest tests/integration/test_api_integration.py::TestDataConsistency -v
}

# Run gene endpoint tests
run_gene_tests() {
    print_status "Running gene endpoint tests..."
    uv run python -m pytest tests/integration/test_api_integration.py::TestGeneEndpoints -v
}

# Run pet endpoint tests
run_pet_tests() {
    print_status "Running pet endpoint tests..."
    uv run python -m pytest tests/integration/test_api_integration.py::TestPetEndpoints -v
}

# Run data consistency tests
run_consistency_tests() {
    print_status "Running data consistency tests..."
    uv run python -m pytest tests/integration/test_api_integration.py::TestDataConsistency -v
}

# Function to check if server is running
check_server() {
    curl -s http://localhost:8000/api/animal-types >/dev/null 2>&1
}

# Function to wait for server
wait_for_server() {
    local attempts=0
    local max_attempts=30

    while [ $attempts -lt $max_attempts ]; do
        if check_server; then
            print_success "Server is ready"
            return 0
        fi
        sleep 1
        attempts=$((attempts + 1))
    done

    print_error "Server failed to start within 30 seconds"
    return 1
}

# Function to start server for client tests
start_client_test_server() {
    print_status "Starting test server for client tests..."

    # Clean up any existing test files
    rm -f test_client_metadata.sqlite test_client_gorgonetics.db
    rm -rf test_client_data

    # Set environment variables for test server
    export GORGONETICS_DB_BACKEND=ducklake
    export GORGONETICS_CATALOG_TYPE=sqlite
    export GORGONETICS_CATALOG_PATH=test_client_metadata.sqlite
    export GORGONETICS_DATA_PATH=test_client_data
    export GORGONETICS_DUCKLAKE_NAME=test_client_gorgonetics_lake

    # Populate test database
    print_status "Populating test database..."
    uv run gorgonetics populate

    # Start server in background
    uv run gorgonetics web > client_test_server.log 2>&1 &
    CLIENT_SERVER_PID=$!

    print_status "Server started with PID: $CLIENT_SERVER_PID"

    # Wait for server to be ready
    wait_for_server
}

# Function to stop client test server
stop_client_test_server() {
    if [ ! -z "$CLIENT_SERVER_PID" ]; then
        print_status "Stopping test server (PID: $CLIENT_SERVER_PID)..."
        kill $CLIENT_SERVER_PID 2>/dev/null || true
        wait $CLIENT_SERVER_PID 2>/dev/null || true
    fi

    # Kill any remaining servers on port 8000
    pkill -f "gorgonetics web\|uvicorn.*8000" 2>/dev/null || true

    # Clean up test files
    rm -f test_client_metadata.sqlite test_client_gorgonetics.db client_test_server.log
    rm -rf test_client_data
}

# Run client-side API tests
run_client_tests() {
    print_status "Running client-side API tests..."

    # Check if server is running, start if needed
    if ! check_server; then
        start_client_test_server
        server_started_by_us=true
    else
        print_status "Server already running"
        server_started_by_us=false
    fi

    # Run the actual client tests
    if pnpm vitest run tests/client/test-simple-client.js; then
        print_success "Client tests passed!"
        test_result=0
    else
        print_error "Client tests failed!"
        test_result=1
    fi

    # Stop server if we started it
    if [ "$server_started_by_us" = true ]; then
        stop_client_test_server
    fi

    return $test_result
}

# Run client tests with UI
run_client_ui_tests() {
    print_status "Opening client test UI..."

    # Check if server is running, start if needed
    if ! check_server; then
        start_client_test_server
        server_started_by_us=true
    else
        print_status "Server already running"
        server_started_by_us=false
    fi

    print_status "Opening Vitest UI..."
    pnpm vitest --ui tests/client/test-simple-client.js

    # Stop server if we started it
    if [ "$server_started_by_us" = true ]; then
        stop_client_test_server
    fi
}

# Check if we're in the right directory
if [ ! -f "pyproject.toml" ]; then
    print_error "Please run this script from the Gorgonetics project root directory"
    exit 1
fi

# Make sure script is executable
if [ ! -x "$0" ]; then
    print_warning "Making test script executable..."
    chmod +x "$0"
fi

# Cleanup function for graceful shutdown
cleanup_on_exit() {
    stop_client_test_server 2>/dev/null || true
}

# Trap to ensure cleanup on exit
trap cleanup_on_exit EXIT

# Parse command line arguments
case "${1:-help}" in
    "all")
        run_all_tests_complete
        ;;
    "integration")
        run_all_tests
        ;;
    "quick")
        run_quick_tests
        ;;
    "api")
        run_api_tests
        ;;
    "genes")
        run_gene_tests
        ;;
    "pets")
        run_pet_tests
        ;;
    "consistency")
        run_consistency_tests
        ;;
    "client")
        run_client_tests
        ;;
    "client-ui")
        run_client_ui_tests
        ;;
    "setup")
        setup_tests
        ;;
    "clean")
        clean_tests
        ;;
    "help"|"--help"|"-h")
        usage
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        usage
        exit 1
        ;;
esac
