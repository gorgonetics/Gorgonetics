#!/usr/bin/env node
/**
 * Cross-platform test cleanup script
 * Removes test artifacts and temporary files
 */

import { rmSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = colors.blue) {
  console.log(`${color}[INFO]${colors.reset} ${message}`);
}

function success(message) {
  console.log(`${colors.green}[SUCCESS]${colors.reset} ${message}`);
}

function warning(message) {
  console.log(`${colors.yellow}[WARNING]${colors.reset} ${message}`);
}

function error(message) {
  console.log(`${colors.red}[ERROR]${colors.reset} ${message}`);
}

// Test artifacts to clean up
const artifacts = [
  'test_client_metadata.sqlite',
  'test_client_data',
  'test-results',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache', 
  'htmlcov',
  '.coverage',
  'node_modules/.cache',
  '.vite',
];

// Simple patterns for additional cleanup (no glob needed)
const filePatterns = [
  /^test_.*\.db$/,
  /^test_.*\.sqlite$/,
];

function cleanupArtifact(artifactPath, dryRun = false) {
  if (!existsSync(artifactPath)) {
    return false;
  }

  if (dryRun) {
    log(`Would remove: ${artifactPath}`);
    return true;
  }

  try {
    rmSync(artifactPath, { recursive: true, force: true });
    success(`Removed: ${artifactPath}`);
    return true;
  } catch (err) {
    error(`Failed to remove ${artifactPath}: ${err.message}`);
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  log('Starting test artifact cleanup...');
  
  if (dryRun) {
    warning('DRY RUN: No files will actually be removed');
  }

  let removedCount = 0;

  // Clean up direct artifacts
  for (const artifact of artifacts) {
    if (cleanupArtifact(artifact, dryRun)) {
      removedCount++;
    }
  }

  // Clean up files matching patterns in root directory
  try {
    const files = readdirSync('.');
    for (const file of files) {
      for (const pattern of filePatterns) {
        if (pattern.test(file)) {
          if (cleanupArtifact(file, dryRun)) {
            removedCount++;
          }
          break;
        }
      }
    }
  } catch (err) {
    error(`Failed to scan directory: ${err.message}`);
  }

  if (dryRun) {
    warning(`Dry run completed. Found ${removedCount} items to remove.`);
    log('Run without --dry-run to actually remove files.');
  } else {
    if (removedCount > 0) {
      success(`Cleanup completed! Removed ${removedCount} artifacts.`);
    } else {
      success('No test artifacts found to clean up.');
    }
  }
}

// Handle command line usage
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('🧹 Test Artifact Cleanup Tool');
  console.log('');
  console.log('Usage: node scripts/clean_test_artifacts.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --dry-run    Show what would be removed without actually removing');
  console.log('  --help, -h   Show this help message');
  console.log('');
  console.log('Removes test artifacts including:');
  console.log('  - Test databases (test_*.db, test_*.sqlite)');
  console.log('  - Test data directories');
  console.log('  - Cache directories (.pytest_cache, .mypy_cache, etc.)');
  console.log('  - Coverage reports');
  process.exit(0);
}

main();