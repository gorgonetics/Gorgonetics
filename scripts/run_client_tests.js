#!/usr/bin/env node
/**
 * Cross-platform client test runner for Gorgonetics
 * Handles server startup/shutdown and runs client tests
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, rmSync, renameSync, existsSync } from 'fs';
import path from 'path';
import process from 'process';

const execAsync = promisify(exec);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.blue) {
  console.log(`${color}[INFO]${colors.reset} ${message}`);
}

function success(message) {
  console.log(`${colors.green}[SUCCESS]${colors.reset} ${message}`);
}

function error(message) {
  console.log(`${colors.red}[ERROR]${colors.reset} ${message}`);
}

function warning(message) {
  console.log(`${colors.yellow}[WARNING]${colors.reset} ${message}`);
}

class ServerManager {
  constructor() {
    this.serverProcess = null;
    this.serverStartedByUs = false;
  }

  async isServerRunning() {
    try {
      const response = await fetch('http://localhost:8000/api/animal-types');
      return response.ok;
    } catch {
      return false;
    }
  }

  async waitForServer(maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
      if (await this.isServerRunning()) {
        success('Server is ready');
        return true;
      }
      await sleep(1000);
    }
    error('Server failed to start within 30 seconds');
    return false;
  }

  async startServer() {
    log('Starting test server for client tests...');
    
    // Clean up test files
    this.cleanupTestFiles();

    // Set test environment variables to isolate from production database
    process.env.GORGONETICS_DB_BACKEND = 'ducklake';
    process.env.GORGONETICS_CATALOG_TYPE = 'sqlite';
    process.env.GORGONETICS_CATALOG_PATH = 'test_client_metadata.sqlite';
    process.env.GORGONETICS_DATA_PATH = 'test_client_data';
    process.env.GORGONETICS_DUCKLAKE_NAME = 'test_client_gorgonetics_lake';

    // Populate test database with beewasp data only (faster for testing)
    log('Populating test database with beewasp data...');
    const horseDir = 'assets/horse';
    const horseBackupDir = 'assets/horse_backup';
    let horseDataMoved = false;
    
    try {
      // Temporarily move horse data aside so only beewasp data gets populated
      if (existsSync(horseDir)) {
        try {
          renameSync(horseDir, horseBackupDir);
          horseDataMoved = true;
          log('Temporarily moved horse data aside for faster testing');
        } catch (e) {
          warning(`Could not move horse data: ${e.message}`);
        }
      }
      
      await execAsync('uv run gorgonetics populate');
      
      // Restore horse data
      if (horseDataMoved && existsSync(horseBackupDir)) {
        try {
          renameSync(horseBackupDir, horseDir);
          log('Restored horse data');
        } catch (e) {
          warning(`Could not restore horse data: ${e.message}`);
        }
      }
    } catch (err) {
      // Make sure to restore horse data even if populate failed
      if (horseDataMoved && existsSync(horseBackupDir)) {
        try {
          renameSync(horseBackupDir, horseDir);
          log('Restored horse data after error');
        } catch (e) {
          warning(`Could not restore horse data after error: ${e.message}`);
        }
      }
      error(`Failed to populate database: ${err.message}`);
      return false;
    }

    // Start server
    this.serverProcess = spawn('uv', ['run', 'gorgonetics', 'web'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    this.serverProcess.stdout.on('data', (data) => {
      // Optionally log server output
    });

    this.serverProcess.stderr.on('data', (data) => {
      // Optionally log server errors
    });

    log(`Server started with PID: ${this.serverProcess.pid}`);
    
    return await this.waitForServer();
  }

  async stopServer() {
    if (this.serverProcess) {
      log(`Stopping test server (PID: ${this.serverProcess.pid})...`);
      
      // Try graceful shutdown first
      this.serverProcess.kill('SIGTERM');
      
      // Wait a bit, then force kill if needed
      await sleep(2000);
      if (!this.serverProcess.killed) {
        this.serverProcess.kill('SIGKILL');
      }
      
      this.serverProcess = null;
    }

    // Clean up test files
    this.cleanupTestFiles();
  }

  cleanupTestFiles() {
    const filesToClean = [
      'test_client_metadata.sqlite',
      'test_client_gorgonetics.db',
      'client_test_server.log'
    ];

    const dirsToClean = [
      'test_client_data'
    ];

    for (const file of filesToClean) {
      try {
        rmSync(file, { force: true });
      } catch (err) {
        // Ignore errors for missing files
      }
    }

    for (const dir of dirsToClean) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        // Ignore errors for missing directories
      }
    }
  }

  async ensureServerRunning() {
    if (await this.isServerRunning()) {
      log('Server already running');
      this.serverStartedByUs = false;
      return true;
    } else {
      this.serverStartedByUs = true;
      return await this.startServer();
    }
  }

  async cleanup() {
    if (this.serverStartedByUs) {
      await this.stopServer();
    }
  }
}

async function runTests(mode = 'run') {
  const serverManager = new ServerManager();
  let exitCode = 0;

  try {
    // Ensure server is running
    if (!await serverManager.ensureServerRunning()) {
      error('Failed to start server');
      return 1;
    }

    // Run client tests
    log('Running client-side API tests...');
    
    const vitestArgs = ['vitest'];
    
    switch (mode) {
      case 'run':
        vitestArgs.push('run', 'tests/client/');
        break;
      case 'watch':
        vitestArgs.push('watch', 'tests/client/');
        break;
      case 'ui':
        vitestArgs.push('--ui', 'tests/client/');
        break;
      case 'coverage':
        vitestArgs.push('run', '--coverage', 'tests/client/');
        break;
      default:
        vitestArgs.push('run', 'tests/client/');
    }

    const testProcess = spawn('pnpm', vitestArgs, {
      stdio: 'inherit',
      env: process.env
    });

    exitCode = await new Promise((resolve) => {
      testProcess.on('close', (code) => {
        resolve(code || 0);
      });
    });

    if (exitCode === 0) {
      success('Client tests passed!');
    } else {
      error('Client tests failed!');
    }

  } catch (err) {
    error(`Test execution failed: ${err.message}`);
    exitCode = 1;
  } finally {
    await serverManager.cleanup();
  }

  return exitCode;
}

function showUsage() {
  console.log('🧬 Gorgonetics Client Test Runner');
  console.log('');
  console.log('Usage: node scripts/run_client_tests.js [command]');
  console.log('');
  console.log('Commands:');
  console.log('  run       - Run client tests once (default)');
  console.log('  watch     - Run client tests in watch mode');
  console.log('  ui        - Open test UI');
  console.log('  coverage  - Run tests with coverage report');
  console.log('  help      - Show this help');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  process.exit(0);
});

// Parse command line arguments
const command = process.argv[2] || 'run';

if (command === 'help' || command === '--help' || command === '-h') {
  showUsage();
  process.exit(0);
}

// Run tests
runTests(command).then(exitCode => {
  process.exit(exitCode);
}).catch(err => {
  error(`Unexpected error: ${err.message}`);
  process.exit(1);
});