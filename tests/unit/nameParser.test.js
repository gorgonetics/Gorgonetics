// tests/unit/nameParser.test.js
import { describe, expect, it } from 'vitest';
import { parseStructuredPetName } from '$lib/services/nameParser.js';

describe('parseStructuredPetName', () => {
  describe('valid Horse names', () => {
    it('parses a standard name with all 7 attributes', () => {
      const result = parseStructuredPetName('Kb F 60 70 65 80 90 100 55', 'Horse');
      expect(result).toEqual({
        breed: 'Kurbone',
        gender: 'Female',
        attributes: {
          temperament: 60,
          toughness: 70,
          ruggedness: 65,
          enthusiasm: 80,
          friendliness: 90,
          intelligence: 100,
          virility: 55,
        },
        label: null,
      });
    });

    it('parses a name with a single-word label', () => {
      const result = parseStructuredPetName('Sc M 50 60 70 80 90 55 65 Sparkle', 'Horse');
      expect(result).toEqual({
        breed: 'Satincoat',
        gender: 'Male',
        attributes: {
          temperament: 50,
          toughness: 60,
          ruggedness: 70,
          enthusiasm: 80,
          friendliness: 90,
          intelligence: 55,
          virility: 65,
        },
        label: 'Sparkle',
      });
    });

    it('parses a name with a multi-word label', () => {
      const result = parseStructuredPetName('Il F 40 50 60 70 80 90 100 My Best', 'Horse');
      expect(result).toEqual({
        breed: 'Ilmarian',
        gender: 'Female',
        attributes: {
          temperament: 40,
          toughness: 50,
          ruggedness: 60,
          enthusiasm: 70,
          friendliness: 80,
          intelligence: 90,
          virility: 100,
        },
        label: 'My Best',
      });
    });

    it('handles all breed shortcodes', () => {
      const shortcodes = ['Sb', 'Kb', 'Il', 'Po', 'Sc', 'St', 'Bl', 'Le', 'Pt', 'Cl'];
      const breeds = [
        'Standardbred',
        'Kurbone',
        'Ilmarian',
        'Plateau Pony',
        'Satincoat',
        'Statehelm',
        'Blanketed',
        'Leopard',
        'Paint',
        'Calico',
      ];
      for (let i = 0; i < shortcodes.length; i++) {
        const result = parseStructuredPetName(`${shortcodes[i]} M 50 50 50 50 50 50 50`, 'Horse');
        expect(result).not.toBeNull();
        expect(result.breed).toBe(breeds[i]);
      }
    });
  });

  describe('case insensitivity', () => {
    it('accepts lowercase breed shortcode', () => {
      const result = parseStructuredPetName('kb f 60 70 65 80 90 100 55', 'Horse');
      expect(result).not.toBeNull();
      expect(result.breed).toBe('Kurbone');
      expect(result.gender).toBe('Female');
    });

    it('accepts uppercase breed shortcode', () => {
      const result = parseStructuredPetName('KB M 60 70 65 80 90 100 55', 'Horse');
      expect(result).not.toBeNull();
      expect(result.breed).toBe('Kurbone');
      expect(result.gender).toBe('Male');
    });

    it('accepts mixed case gender', () => {
      const result = parseStructuredPetName('Kb m 60 70 65 80 90 100 55', 'Horse');
      expect(result).not.toBeNull();
      expect(result.gender).toBe('Male');
    });
  });

  describe('returns null for non-matching names', () => {
    it('returns null for non-Horse species', () => {
      expect(parseStructuredPetName('Kb F 60 70 65 80 90 100 55', 'BeeWasp')).toBeNull();
    });

    it('returns null for unknown breed shortcode', () => {
      expect(parseStructuredPetName('Zz F 60 70 65 80 90 100 55', 'Horse')).toBeNull();
    });

    it('returns null for invalid gender token', () => {
      expect(parseStructuredPetName('Kb X 60 70 65 80 90 100 55', 'Horse')).toBeNull();
    });

    it('returns null for too few tokens', () => {
      expect(parseStructuredPetName('Kb F 60 70 65', 'Horse')).toBeNull();
    });

    it('returns null for non-numeric attribute values', () => {
      expect(parseStructuredPetName('Kb F abc 70 65 80 90 100 55', 'Horse')).toBeNull();
    });

    it('returns null for negative attribute values', () => {
      expect(parseStructuredPetName('Kb F -5 70 65 80 90 100 55', 'Horse')).toBeNull();
    });

    it('returns null for attribute values above 100', () => {
      expect(parseStructuredPetName('Kb F 60 70 65 80 90 101 55', 'Horse')).toBeNull();
    });

    it('returns null for regular pet names', () => {
      expect(parseStructuredPetName('Sample Horse', 'Horse')).toBeNull();
      expect(parseStructuredPetName('Roach', 'Horse')).toBeNull();
    });

    it('returns null for empty name', () => {
      expect(parseStructuredPetName('', 'Horse')).toBeNull();
    });
  });
});
