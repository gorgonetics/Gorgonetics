/**
 * Utility functions for API calls and species handling.
 * In the native app, these delegate to configService and geneService
 * instead of making HTTP fetch calls.
 */

import * as configService from '$lib/services/configService.js';
import * as geneService from '$lib/services/geneService.js';

// Global cache for gene effects data
const geneEffectsCache = new Map();
const configCacheMap = new Map();

// Cache keys
const CACHE_KEYS = {
    GENE_EFFECTS: 'gene_effects_',
    ATTRIBUTE_CONFIG: 'attribute_config_',
    APPEARANCE_CONFIG: 'appearance_config_'
};

/**
 * Normalize species names for consistent usage
 */
export function normalizeSpecies(species) {
    return configService.normalizeSpecies(species) || "horse";
}

/**
 * Load attribute configuration for a species with caching
 */
export async function loadAttributeConfig(species) {
    const normalizedSpecies = normalizeSpecies(species);
    const cacheKey = CACHE_KEYS.ATTRIBUTE_CONFIG + normalizedSpecies;

    if (configCacheMap.has(cacheKey)) {
        return configCacheMap.get(cacheKey);
    }

    const data = configService.getAttributeConfig(normalizedSpecies);
    configCacheMap.set(cacheKey, data);
    return data;
}

/**
 * Load appearance configuration for a species with caching
 */
export async function loadAppearanceConfig(species) {
    const normalizedSpecies = normalizeSpecies(species);
    const cacheKey = CACHE_KEYS.APPEARANCE_CONFIG + normalizedSpecies;

    if (configCacheMap.has(cacheKey)) {
        return configCacheMap.get(cacheKey);
    }

    const data = configService.getAppearanceConfig(normalizedSpecies);
    configCacheMap.set(cacheKey, data);
    return data;
}

/**
 * Load gene effects for a species with caching
 */
export async function loadGeneEffects(species) {
    const normalizedSpecies = normalizeSpecies(species);
    const cacheKey = CACHE_KEYS.GENE_EFFECTS + normalizedSpecies;

    if (geneEffectsCache.has(cacheKey)) {
        return geneEffectsCache.get(cacheKey);
    }

    try {
        const data = await geneService.getGeneEffects(normalizedSpecies);
        geneEffectsCache.set(cacheKey, data);
        return data;
    } catch (error) {
        console.error(`Error loading gene effects for ${species}:`, error);
        return null;
    }
}

/**
 * Centralized fallback attributes (includes all core + common species-specific)
 */
export const FALLBACK_ATTRIBUTES = [
    "Temperament",
    "Ferocity",
    "Toughness",
    "Ruggedness",
    "Enthusiasm",
    "Friendliness",
    "Intelligence",
    "Virility",
];

/**
 * Centralized fallback attribute list with metadata
 */
export const FALLBACK_ATTRIBUTE_LIST = [
    { key: "Temperament", name: "Temperament", icon: "\uD83D\uDC0E" },
    { key: "Ferocity", name: "Ferocity", icon: "\uD83D\uDD25" },
    { key: "Toughness", name: "Toughness", icon: "\uD83D\uDCAA" },
    { key: "Ruggedness", name: "Ruggedness", icon: "\uD83C\uDFD4\uFE0F" },
    { key: "Enthusiasm", name: "Enthusiasm", icon: "\u2728" },
    { key: "Friendliness", name: "Friendliness", icon: "\uD83D\uDE0A" },
    { key: "Intelligence", name: "Intelligence", icon: "\uD83E\uDDE0" },
    { key: "Virility", name: "Virility", icon: "\uD83D\uDC9C" },
];

/**
 * Centralized fallback appearance attributes (BeeWasp format)
 */
export const FALLBACK_APPEARANCE_LIST = [
    { key: "body_color_hue", name: "Body Color Hue", examples: "Color tone" },
    { key: "body_color_saturation", name: "Body Color Saturation", examples: "Color intensity" },
    { key: "body_color_intensity", name: "Body Color Intensity", examples: "Brightness" },
    { key: "wing_color_hue", name: "Wing Color Hue", examples: "Wing tone" },
    { key: "wing_color_saturation", name: "Wing Color Saturation", examples: "Wing intensity" },
    { key: "wing_color_intensity", name: "Wing Color Intensity", examples: "Wing brightness" },
    { key: "body_scale", name: "Body Scale", examples: "Body size" },
    { key: "wing_scale", name: "Wing Scale", examples: "Wing size" },
    { key: "head_scale", name: "Head Scale", examples: "Head size" },
    { key: "tail_scale", name: "Tail Scale", examples: "Tail size" },
    { key: "antenna_scale", name: "Antenna Scale", examples: "Antenna size" },
    { key: "leg_deformity", name: "Leg Deformity", examples: "Leg shape" },
    { key: "antenna_deformity", name: "Antenna Deformity", examples: "Antenna shape" },
    { key: "particles", name: "Particles", examples: "Special effects" },
    { key: "particle_location", name: "Particle Location", examples: "Effect position" },
    { key: "glow", name: "Glow", examples: "Luminescence" },
];

/**
 * Get cached gene effects for a species (if available)
 */
export function getCachedGeneEffects(species) {
    const normalizedSpecies = normalizeSpecies(species);
    const cacheKey = CACHE_KEYS.GENE_EFFECTS + normalizedSpecies;
    return geneEffectsCache.get(cacheKey) || null;
}

/**
 * Check if gene effects are cached for a species
 */
export function hasGeneEffectsCache(species) {
    const normalizedSpecies = normalizeSpecies(species);
    const cacheKey = CACHE_KEYS.GENE_EFFECTS + normalizedSpecies;
    return geneEffectsCache.has(cacheKey);
}

/**
 * Clear all caches
 */
export function clearAllCaches() {
    geneEffectsCache.clear();
    configCacheMap.clear();
}

/**
 * Get cache stats for debugging
 */
export function getCacheStats() {
    return {
        geneEffects: {
            size: geneEffectsCache.size,
            keys: Array.from(geneEffectsCache.keys())
        },
        config: {
            size: configCacheMap.size,
            keys: Array.from(configCacheMap.keys())
        }
    };
}

/**
 * Generic fetch wrapper — kept for backward compatibility but warns on use.
 * Components should use service imports directly.
 */
export async function fetchWithErrorHandling(url) {
    console.warn(`fetchWithErrorHandling called for ${url} — this should use services directly`);
    const { apiClient } = await import('$lib/services/api.js');
    const response = await apiClient.fetchWithErrorHandling(url);
    return response.json();
}
