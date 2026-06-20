import { describe, expect, it } from 'vitest';
import {
  ERROR_THRESHOLD,
  formatBytes,
  formatRow,
  SPARK_STORAGE_BYTES,
  statusFor,
  WARN_THRESHOLD,
} from '../../scripts/monitor-spark-usage.mjs';

// Covers the pure display/threshold logic of the Spark soft-cap monitor.
// The I/O paths (loadServiceAccount, summariseCollection, main) require a
// real Admin SDK + service-account key and stay manual / integration-only.

describe('statusFor', () => {
  it('reports OK below the warn threshold', () => {
    expect(statusFor(0)).toBe('OK');
    expect(statusFor(0.5)).toBe('OK');
    expect(statusFor(WARN_THRESHOLD - 0.0001)).toBe('OK');
  });

  it('reports WARN from the warn threshold up to (but not at) the error threshold', () => {
    expect(statusFor(WARN_THRESHOLD)).toBe('WARN');
    expect(statusFor(0.9)).toBe('WARN');
    expect(statusFor(ERROR_THRESHOLD - 0.0001)).toBe('WARN');
  });

  it('reports OVER at and beyond the error threshold', () => {
    expect(statusFor(ERROR_THRESHOLD)).toBe('OVER');
    expect(statusFor(1.5)).toBe('OVER');
  });
});

describe('formatBytes', () => {
  it('renders bytes below 1 KiB without a unit prefix', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('switches units at each 1024 boundary', () => {
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MiB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GiB');
  });

  it('uses one decimal for KiB/MiB and two for GiB', () => {
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(65.9 * 1024 * 1024)).toBe('65.9 MiB');
    expect(formatBytes(SPARK_STORAGE_BYTES + 512 * 1024 * 1024)).toBe('1.50 GiB');
  });
});

describe('formatRow', () => {
  it('pads the label to the column width', () => {
    expect(formatRow('Project:', 'gorgonetics')).toBe('Project:                gorgonetics');
  });

  it('does not truncate labels longer than the width', () => {
    const label = 'a-very-long-label-past-the-column-width:';
    expect(formatRow(label, 'x')).toBe(`${label}x`);
  });
});
