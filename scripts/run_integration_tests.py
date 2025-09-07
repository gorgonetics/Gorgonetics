#!/usr/bin/env python3
"""
Integration test runner for Gorgonetics.

This script runs the integration tests that ensure API endpoints work correctly
and prevent regressions that would break UI functionality.
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path


def setup_test_environment():
    """Set up test environment variables and configuration."""
    # Set test database configuration to use in-memory/temp databases
    os.environ["GORGONETICS_DB_BACKEND"] = "ducklake"
    os.environ["GORGONETICS_CATALOG_TYPE"] = "sqlite"

    # Use temporary files for test database
    temp_dir = tempfile.mkdtemp(prefix="gorgonetics_test_")
    os.environ["GORGONETICS_CATALOG_PATH"] = os.path.join(temp_dir, "test_metadata.sqlite")
    os.environ["GORGONETICS_DATA_PATH"] = os.path.join(temp_dir, "test_data")
    os.environ["GORGONETICS_DUCKLAKE_NAME"] = "test_gorgonetics_lake"

    print("* Test environment configured:")
    print(f"   Database: {os.environ['GORGONETICS_DB_BACKEND']}")
    print(f"   Catalog: {os.environ['GORGONETICS_CATALOG_PATH']}")
    print(f"   Data: {os.environ['GORGONETICS_DATA_PATH']}")

    return temp_dir


def populate_test_database():
    """Populate test database with sample gene data."""
    print("📊 Populating test database with gene data...")

    try:
        # Run the populate command to load gene data
        result = subprocess.run(
            [sys.executable, "-m", "gorgonetics", "populate"], capture_output=True, text=True, timeout=120
        )

        if result.returncode == 0:
            print("* Test database populated successfully")
        else:
            print("* Failed to populate test database:")
            print(f"   stdout: {result.stdout}")
            print(f"   stderr: {result.stderr}")
            return False

    except subprocess.TimeoutExpired:
        print("* Database population timed out")
        return False
    except Exception as e:
        print(f"* Error populating database: {e}")
        return False

    return True


def run_integration_tests(test_args=None):
    """Run the integration tests with pytest."""
    print("🚀 Running integration tests...")

    # Base pytest command
    cmd = [
        sys.executable,
        "-m",
        "pytest",
        "tests/integration/",
        "-v",
        "--tb=short",
        "--color=yes",
        "-m",
        "not slow",  # Skip slow tests by default
    ]

    # Add any additional arguments
    if test_args:
        cmd.extend(test_args)

    try:
        result = subprocess.run(cmd, timeout=600)  # 10 minute timeout
        return result.returncode == 0

    except subprocess.TimeoutExpired:
        print("* Integration tests timed out")
        return False
    except Exception as e:
        print(f"* Error running tests: {e}")
        return False


def run_specific_test_categories():
    """Run specific categories of tests with detailed reporting."""
    test_categories = [
        ("🧬 Gene API Tests", "tests/integration/test_api_integration.py::TestGeneEndpoints"),
        ("🐾 Pet API Tests", "tests/integration/test_api_integration.py::TestPetEndpoints"),
        ("*  Config API Tests", "tests/integration/test_api_integration.py::TestConfigEndpoints"),
        ("🚨 Error Handling Tests", "tests/integration/test_api_integration.py::TestErrorHandling"),
        ("🔄 Data Consistency Tests", "tests/integration/test_api_integration.py::TestDataConsistency"),
    ]

    results = {}

    for category_name, test_path in test_categories:
        print(f"\n{category_name}")
        print("=" * 50)

        cmd = [sys.executable, "-m", "pytest", test_path, "-v", "--tb=line", "--color=yes"]

        try:
            result = subprocess.run(cmd, timeout=300)
            success = result.returncode == 0
            results[category_name] = success

            if success:
                print(f"* {category_name} passed")
            else:
                print(f"* {category_name} failed")

        except subprocess.TimeoutExpired:
            print(f"*  {category_name} timed out")
            results[category_name] = False
        except Exception as e:
            print(f"💥 {category_name} error: {e}")
            results[category_name] = False

    return results


def run_performance_tests():
    """Run performance-related tests."""
    print("\n⚡ Performance Tests")
    print("=" * 50)

    cmd = [
        sys.executable,
        "-m",
        "pytest",
        "tests/integration/test_api_integration.py::TestPerformance",
        "-v",
        "--tb=short",
        "--color=yes",
        "--durations=0",  # Show all test durations
    ]

    try:
        result = subprocess.run(cmd, timeout=300)
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print("*  Performance tests timed out")
        return False


def cleanup_test_environment(temp_dir):
    """Clean up test environment."""
    try:
        import shutil

        shutil.rmtree(temp_dir, ignore_errors=True)
        print(f"🧹 Cleaned up test directory: {temp_dir}")
    except Exception as e:
        print(f"*  Could not clean up test directory: {e}")


def main():
    """Main test runner function."""
    print("* Gorgonetics Integration Test Runner")
    print("=" * 50)

    # Change to project directory
    project_root = Path(__file__).parent.parent
    os.chdir(project_root)

    # Parse command line arguments
    import argparse

    parser = argparse.ArgumentParser(description="Run Gorgonetics integration tests")
    parser.add_argument("--quick", action="store_true", help="Run quick tests only (skip performance tests)")
    parser.add_argument("--categories", action="store_true", help="Run tests by category with detailed reporting")
    parser.add_argument("--performance", action="store_true", help="Run performance tests only")
    parser.add_argument("--coverage", action="store_true", help="Generate coverage report")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("test_filter", nargs="*", help="Additional pytest arguments/filters")

    args = parser.parse_args()

    # Set up test environment
    temp_dir = setup_test_environment()

    try:
        # Populate test database
        if not populate_test_database():
            print("* Failed to set up test database")
            return 1

        success = True

        if args.performance:
            # Run only performance tests
            success = run_performance_tests()

        elif args.categories:
            # Run tests by category
            results = run_specific_test_categories()

            # Print summary
            print("\n📊 Test Results Summary")
            print("=" * 50)
            passed = sum(1 for result in results.values() if result)
            total = len(results)

            for category, result in results.items():
                status = "* PASS" if result else "* FAIL"
                print(f"{status} {category}")

            print(f"\nOverall: {passed}/{total} categories passed")
            success = passed == total

        else:
            # Run all integration tests
            test_args = []

            if args.coverage:
                test_args.extend(["--cov=src/gorgonetics", "--cov-report=html"])

            if args.verbose:
                test_args.append("-vv")

            if args.quick:
                test_args.extend(["-m", "not (slow or performance)"])

            # Add any additional test filters
            test_args.extend(args.test_filter)

            success = run_integration_tests(test_args)

        if success:
            print("\n🎉 All integration tests passed!")
            print("* API endpoints are working correctly")
            print("* UI functionality should not be broken")
            return 0
        else:
            print("\n💥 Some integration tests failed!")
            print("* API endpoints may be broken")
            print("* UI functionality may be affected")
            return 1

    except KeyboardInterrupt:
        print("\n*  Tests interrupted by user")
        return 1

    finally:
        cleanup_test_environment(temp_dir)


if __name__ == "__main__":
    sys.exit(main())
