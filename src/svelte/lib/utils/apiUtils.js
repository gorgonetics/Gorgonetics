/**
 * Utility functions for API calls and species handling
 */

// Global cache for gene effects data
const geneEffectsCache = new Map();
const configCache = new Map();

// Cache keys
const CACHE_KEYS = {
    GENE_EFFECTS: 'gene_effects_',
    ATTRIBUTE_CONFIG: 'attribute_config_',
    APPEARANCE_CONFIG: 'appearance_config_'
};

/**
 * Normalize species names for consistent API usage
 * @param {string} species - The species name to normalize
 * @returns {string} - Normalized species name
 */
export function normalizeSpecies(species) {
    if (!species) return "";
    
    const speciesLower = species.toLowerCase();
    
    if (speciesLower === "horse") {
        return "horse";
    } else if (
        speciesLower === "beewasp" ||
        speciesLower === "bee" ||
        speciesLower === "wasp"
    ) {
        return "beewasp";
    } else {
        return "horse"; // Default fallback
    }
}

/**
 * Generic API fetch with error handling
 * @param {string} url - The API endpoint URL
 * @param {string} errorContext - Context for error messages
 * @returns {Promise<any|null>} - API response data or null on error
 */
export async function fetchWithErrorHandling(url, errorContext = "API call") {
    try {
        const response = await fetch(url);
        if (response.ok) {
            return await response.json();
        } else {
            console.warn(`Failed to ${errorContext}: ${response.status} ${response.statusText}`);
            return null;
        }
    } catch (error) {
        console.error(`Error during ${errorContext}:`, error);
        return null;
    }
}

/**
 * Load attribute configuration for a species with caching
 * @param {string} species - The species name
 * @returns {Promise<any|null>} - Attribute config or null
 */
export async function loadAttributeConfig(species) {
    const normalizedSpecies = normalizeSpecies(species);
    const cacheKey = CACHE_KEYS.ATTRIBUTE_CONFIG + normalizedSpecies;
    
    // Check cache first
    if (configCache.has(cacheKey)) {
        console.log(`🎯 Using cached attribute config for ${normalizedSpecies}`);
        return configCache.get(cacheKey);
    }
    
    console.log(`📥 Loading attribute config for ${normalizedSpecies} from API`);
    const data = await fetchWithErrorHandling(
        `/api/attribute-config/${normalizedSpecies}`,
        `loading attribute config for ${species}`
    );
    
    // Cache the result
    if (data !== null) {
        configCache.set(cacheKey, data);
        console.log(`💾 Cached attribute config for ${normalizedSpecies}`);
    }
    
    return data;
}

/**
 * Load appearance configuration for a species with caching
 * @param {string} species - The species name  
 * @returns {Promise<any|null>} - Appearance config or null
 */
export async function loadAppearanceConfig(species) {
    const normalizedSpecies = normalizeSpecies(species);
    const cacheKey = CACHE_KEYS.APPEARANCE_CONFIG + normalizedSpecies;
    
    // Check cache first
    if (configCache.has(cacheKey)) {
        console.log(`🎯 Using cached appearance config for ${normalizedSpecies}`);
        return configCache.get(cacheKey);
    }
    
    console.log(`📥 Loading appearance config for ${normalizedSpecies} from API`);
    const data = await fetchWithErrorHandling(
        `/api/appearance-config/${normalizedSpecies}`,
        `loading appearance config for ${species}`
    );
    
    // Cache the result
    if (data !== null) {
        configCache.set(cacheKey, data);
        console.log(`💾 Cached appearance config for ${normalizedSpecies}`);
    }
    
    return data;
}

/**
 * Load gene effects for a species with caching
 * @param {string} species - The species name
 * @returns {Promise<any|null>} - Gene effects or null
 */
export async function loadGeneEffects(species) {
    const normalizedSpecies = normalizeSpecies(species);
    const cacheKey = CACHE_KEYS.GENE_EFFECTS + normalizedSpecies;
    
    // Check cache first
    if (geneEffectsCache.has(cacheKey)) {
        console.log(`🎯 Using cached gene effects for ${normalizedSpecies}`);
        return geneEffectsCache.get(cacheKey);
    }
    
    console.log(`📥 Loading gene effects for ${normalizedSpecies} from API`);
    const data = await fetchWithErrorHandling(
        `/api/gene-effects/${normalizedSpecies}`,
        `loading gene effects for ${species}`
    );
    
    // Cache the result (including null results to avoid repeated failed requests)
    if (data !== null) {
        geneEffectsCache.set(cacheKey, data);
        console.log(`💾 Cached gene effects for ${normalizedSpecies} (${Object.keys(data.effects || {}).length} genes)`);
    }
    
    return data;
}

/**
 * Centralized fallback attributes (includes all core + common species-specific)
 */
export const FALLBACK_ATTRIBUTES = [
    "Intelligence",
    "Toughness", 
    "Friendliness",
    "Ruggedness",
    "Enthusiasm",
    "Virility",
    "Ferocity",      // BeeWasp specific
    "Temperament",   // Horse specific
];

/**
 * Centralized fallback attribute list with metadata
 */
export const FALLBACK_ATTRIBUTE_LIST = [
    { key: "Intelligence", name: "Intelligence", icon: "🧠" },
    { key: "Toughness", name: "Toughness", icon: "💪" },
    { key: "Friendliness", name: "Friendliness", icon: "😊" },
    { key: "Ruggedness", name: "Ruggedness", icon: "🏔️" },
    { key: "Enthusiasm", name: "Enthusiasm", icon: "✨" },
    { key: "Virility", name: "Virility", icon: "💜" },
    { key: "Ferocity", name: "Ferocity", icon: "🔥" },
    { key: "Temperament", name: "Temperament", icon: "🐎" },
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
 * @param {string} species - The species name
 * @returns {object|null} - Cached gene effects or null
 */
export function getCachedGeneEffects(species) {
    const normalizedSpecies = normalizeSpecies(species);
    const cacheKey = CACHE_KEYS.GENE_EFFECTS + normalizedSpecies;
    return geneEffectsCache.get(cacheKey) || null;
}

/**
 * Check if gene effects are cached for a species
 * @param {string} species - The species name
 * @returns {boolean} - True if cached
 */
export function hasGeneEffectsCache(species) {
    const normalizedSpecies = normalizeSpecies(species);
    const cacheKey = CACHE_KEYS.GENE_EFFECTS + normalizedSpecies;
    return geneEffectsCache.has(cacheKey);
}

/**
 * Clear all caches (useful for development/testing)
 */
export function clearAllCaches() {
    geneEffectsCache.clear();
    configCache.clear();
    console.log("🗑️ All caches cleared");
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
            size: configCache.size,
            keys: Array.from(configCache.keys())
        }
    };
}