/**
 * Minimal client test to debug issues
 */

import { describe, it, expect } from 'vitest';

describe('Minimal Test', () => {
  it('should pass basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should have access to fetch', () => {
    expect(typeof fetch).toBe('function');
  });

  it('should be able to make basic assertions', () => {
    const testObj = { name: 'test', value: 42 };
    expect(testObj.name).toBe('test');
    expect(testObj.value).toBe(42);
  });
});
