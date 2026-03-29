<script>
    import { onDestroy, onMount } from "svelte";
    import { SvelteSet, SvelteMap } from "svelte/reactivity";
    import GeneTooltip from "./GeneTooltip.svelte";
    import GeneCell from "./GeneCell.svelte";
    import { getPetGenome } from "$lib/services/petService.js";
    import {
        normalizeSpecies,
        loadAttributeConfig,
        loadAppearanceConfig as fetchAppearanceConfig,
        loadGeneEffects,
        getCacheStats,
        clearAllCaches,
        FALLBACK_ATTRIBUTES,
        FALLBACK_APPEARANCE_LIST,
    } from "$lib/utils/apiUtils.js";

    const FALLBACK_APPEARANCE_KEYS = FALLBACK_APPEARANCE_LIST.map(
        (a) => a.key.replace(/_/g, "-"),
    );

    const { pet, onStatsUpdated } = $props();

    let containerElement = $state();

    let loading = $state(false);
    let error = $state(null);
    let currentPet = $state(null);
    let currentView = $state("attribute");
    let geneEffectsDB = null;

    // Stats-related reactive variables
    let currentStats = $state(null);
    let totalGenes = $state(0);
    let neutralGenes = $state(0);
    let appearanceList = $state([]);
    let selectedAttributes = $state([]);
    let hiddenAttributes = $state([]);
    let selectedChromosomes = $state([]);
    let hiddenChromosomes = $state([]);

    // Filter states
    let currentEffectFilter = $state([]);
    let hiddenEffectFilters = $state([]);
    let currentValueFilter = $state([]);
    let hiddenValueFilters = $state([]);

    // Tooltip state
    let tooltipVisible = $state(false);
    let tooltipX = $state(0);
    let tooltipY = $state(0);
    let tooltipGeneId = $state("");
    let tooltipGeneType = $state("");

    // Template system state (disabled)
    let tooltipEffect = $state("");
    let tooltipPotentialEffects = $state([]);

    // Parsed gene data
    let headerStructure = $state(null);
    let chromosomeData = $state([]);

    // Cached attribute names for dynamic attribute detection
    let allAttributeNames = $state([]);

    // Global gene effects database - persists across pet selections
    const globalGeneEffectsDB = $state({});

    // DOM template cache - stores pre-built table structures per species
    const speciesTemplateCache = $state(new Map());
    let currentSpeciesTemplate = $state(null);
    let isUsingCachedTemplate = $state(false);

    onMount(async () => {
        // Preload gene effects for common species to improve performance
        await preloadGeneEffects();

        if (pet) {
            await loadPetData();
        }
    });

    async function preloadGeneEffects() {
        const commonSpecies = ["horse", "beewasp"];

        // Load in parallel for better performance
        const loadPromises = commonSpecies.map(async (species) => {
            try {
                const normalizedSpecies = normalizeSpecies(species);
                if (!globalGeneEffectsDB[normalizedSpecies]) {
                    const data = await loadGeneEffects(species);
                    if (data) {
                        globalGeneEffectsDB[normalizedSpecies] = data.effects;
                    }
                }
            } catch (error) {
                console.warn(
                    `Failed to preload gene effects for ${species}:`,
                    error,
                );
            }
        });

        await Promise.all(loadPromises);

        // Expose cache utilities to window for development debugging
        if (typeof window !== "undefined" && import.meta.env.DEV) {
            window.geneVisualizerCache = {
                stats: getCacheStats,
                clear: clearAllCaches,
                globalDB: () => globalGeneEffectsDB,
            };
        }
    }

    function createSpeciesTemplate(species, headerStructure, chromosomeCount) {
        const template = {
            species,
            chromosomeCount,
            blockCount: headerStructure.sortedBlocks.length,
            sortedBlocks: [...headerStructure.sortedBlocks],
            blockMaxGenes: new Map(headerStructure.blockMaxGenes),
            timestamp: Date.now(),
        };

        return template;
    }

    function getOrCreateSpeciesTemplate(
        species,
        headerStructure,
        chromosomeCount,
    ) {
        const cacheKey = `${species}_${chromosomeCount}_${headerStructure.sortedBlocks.length}`;

        if (speciesTemplateCache.has(cacheKey)) {
            const cached = speciesTemplateCache.get(cacheKey);
            isUsingCachedTemplate = true;
            return cached;
        }

        const template = createSpeciesTemplate(
            species,
            headerStructure,
            chromosomeCount,
        );
        speciesTemplateCache.set(cacheKey, template);
        isUsingCachedTemplate = false;
        return template;
    }

    onDestroy(() => {
        cleanup();
    });

    function cleanup() {
        currentPet = null;
        currentStats = null;
        totalGenes = 0;
        neutralGenes = 0;
        selectedAttributes = [];
        hiddenAttributes = [];
        selectedChromosomes = [];
        hiddenChromosomes = [];
        headerStructure = null;
        chromosomeData = [];
        allAttributeNames = [];
        // NOTE: We keep globalGeneEffectsDB intact for performance

        error = null;
    }

    async function loadPetData() {
        if (!pet || loading) {
            return;
        }

        try {
            loading = true;
            error = null;

            const genomeData = await getPetGenome(pet.id);
            if (!genomeData) {
                throw new Error("Failed to load pet genome");
            }

            currentPet = genomeData;

            // Load gene effects and appearance config in parallel for better performance
            await Promise.all([
                loadGeneEffectsForSpecies(currentPet.species),
                loadAppearanceConfig(currentPet.species),
            ]);

            // Static templates disabled - current dynamic rendering performance is sufficient

            await updateVisualization();
        } catch (err) {
            error = `Failed to load pet: ${err.message}`;
            console.error("❌ Error loading pet data:", err);
        } finally {
            loading = false;
        }
    }

    async function loadGeneEffectsForSpecies(species) {
        const normalizedSpecies = normalizeSpecies(species);

        // Check if we already have this species in our global cache
        if (globalGeneEffectsDB[normalizedSpecies]) {
            geneEffectsDB = globalGeneEffectsDB;
            return;
        }

        // Load from API (with caching)
        const data = await loadGeneEffects(species);
        if (data) {
            // Add to global cache and use it
            globalGeneEffectsDB[normalizedSpecies] = data.effects;
            geneEffectsDB = globalGeneEffectsDB;
        } else {
            geneEffectsDB = globalGeneEffectsDB; // Use what we have, even if empty
        }
    }

    async function loadAppearanceConfig(species) {
        if (!species) {
            appearanceList = [];
            return;
        }

        const config = await fetchAppearanceConfig(species);
        if (config) {
            // appearanceConfig = config; // Unused
            appearanceList = config.appearance_attributes || [];
        } else {
            appearanceList = [];
        }
    }

    function parseGenes(genesData) {
        const parsed = {};

        Object.entries(genesData).forEach(([chromosome, geneString]) => {
            const blockStrings = geneString.split(" ");
            const allGenes = [];
            const blocks = [];

            blockStrings.forEach((blockString, blockIndex) => {
                const blockLetter = generateBlockLetter(blockIndex);
                const blockGenes = [];

                for (let i = 0; i < blockString.length; i++) {
                    const gene = {
                        id: `${chromosome}${blockLetter}${i + 1}`,
                        type: blockString[i],
                        block: blockLetter,
                        position: i + 1,
                        globalPosition: allGenes.length + 1,
                    };
                    blockGenes.push(gene);
                    allGenes.push(gene);
                }

                blocks.push({
                    letter: blockLetter,
                    genes: blockGenes,
                });
            });

            parsed[chromosome] = { blocks, allGenes };
        });

        return parsed;
    }

    function generateBlockLetter(index) {
        if (index < 26) {
            return String.fromCharCode(65 + index);
        } else {
            const firstLetter = Math.floor(index / 26) - 1;
            const secondLetter = index % 26;
            return (
                String.fromCharCode(65 + firstLetter) +
                String.fromCharCode(65 + secondLetter)
            );
        }
    }

    async function initializeStats() {
        if (currentView === "attribute") {
            const stats = {
                positive: 0,
                negative: 0,
                neutral: 0,
                "potential-positive": 0,
                "potential-negative": 0,
            };

            // Load species-specific attributes from configuration
            if (currentPet?.species) {
                const config = await loadAttributeConfig(currentPet.species);
                if (config) {
                    // Cache attribute names for dynamic detection
                    allAttributeNames = config.all_attribute_names.map(
                        (name) => name.charAt(0).toUpperCase() + name.slice(1),
                    );

                    config.all_attribute_names.forEach((attrName) => {
                        const attrKey =
                            attrName.charAt(0).toUpperCase() +
                            attrName.slice(1);
                        stats[attrKey] = { positive: 0, negative: 0 };
                    });
                } else {
                    // Fallback to default attributes
                    allAttributeNames = FALLBACK_ATTRIBUTES;
                    FALLBACK_ATTRIBUTES.forEach((attr) => {
                        stats[attr] = { positive: 0, negative: 0 };
                    });
                }
            } else {
                // Default attributes if no species specified
                allAttributeNames = FALLBACK_ATTRIBUTES;
                FALLBACK_ATTRIBUTES.forEach((attr) => {
                    stats[attr] = { positive: 0, negative: 0 };
                });
            }

            return stats;
        } else {
            const stats = { "appearance-neutral": 0 };

            let attrNames = null;
            if (currentPet?.species) {
                try {
                    const config = await fetchAppearanceConfig(currentPet.species);
                    if (config) {
                        attrNames = config.appearance_attribute_names;
                    }
                } catch (err) {
                    console.error("Error loading appearance config:", err);
                }
            }

            (attrNames || FALLBACK_APPEARANCE_KEYS).forEach((attr) => {
                stats[attr] = 0;
            });

            return stats;
        }
    }

    function updateStats(stats, geneAnalysis) {
        if (currentView === "attribute") {
            stats[geneAnalysis.type]++;

            if (geneAnalysis.attribute && stats[geneAnalysis.attribute]) {
                // Normalize type for attribute-specific counting
                let normalizedType = geneAnalysis.type;
                if (normalizedType === "potential-positive") {
                    normalizedType = "positive";
                } else if (normalizedType === "potential-negative") {
                    normalizedType = "negative";
                }

                // Only increment if it's a positive/negative effect
                if (
                    normalizedType === "positive" ||
                    normalizedType === "negative"
                ) {
                    stats[geneAnalysis.attribute][normalizedType]++;
                }
            }
        } else {
            if (stats[geneAnalysis.type] !== undefined) {
                stats[geneAnalysis.type]++;
            }
        }
    }

    function getGeneEffect(species, geneId, geneType) {
        if (!geneEffectsDB) {
            return "No gene data found";
        }

        const speciesKey = normalizeSpecies(species);

        const geneData =
            geneEffectsDB[speciesKey] && geneEffectsDB[speciesKey][geneId];

        if (!geneData) {
            return "No gene data found";
        }

        if (geneType === "D" || geneType === "x") {
            const effect = geneData.effectDominant;
            if (
                !effect ||
                effect === "None" ||
                effect === null ||
                effect === "null"
            ) {
                return "No dominant effect";
            }
            return effect;
        } else if (geneType === "R") {
            const effect = geneData.effectRecessive;
            if (
                !effect ||
                effect === "None" ||
                effect === null ||
                effect === "null"
            ) {
                return "No recessive effect";
            }
            return effect;
        } else {
            return "Unknown gene type";
        }
    }

    function getGeneAppearance(species, geneId) {
        if (!geneEffectsDB) return "No appearance effect";

        const speciesKey = normalizeSpecies(species);

        const geneData =
            geneEffectsDB[speciesKey] && geneEffectsDB[speciesKey][geneId];

        if (
            !geneData ||
            !geneData.appearance ||
            geneData.appearance === "None" ||
            geneData.appearance.includes("String for me to fill")
        ) {
            return "No appearance effect";
        }

        return geneData.appearance;
    }

    function extractAttributeFromEffect(effectStr) {
        if (!effectStr || !allAttributeNames.length) return null;

        // Find which attribute name is mentioned in the effect string
        for (const attributeName of allAttributeNames) {
            if (effectStr.includes(attributeName)) {
                return attributeName;
            }
        }
        return null;
    }

    function extractAttributesFromEffect(effectStr) {
        if (!effectStr || !allAttributeNames.length) return [];

        // Find all attribute names mentioned in the effect string
        const foundAttributes = [];
        for (const attributeName of allAttributeNames) {
            if (effectStr.includes(attributeName)) {
                foundAttributes.push(attributeName);
            }
        }
        return foundAttributes;
    }

    function analyzeGeneEffect(species, geneId, geneType) {
        if (currentView === "attribute") {
            const effect = getGeneEffect(species, geneId, geneType);

            if (
                effect === "No gene data found" ||
                effect === "No dominant effect" ||
                effect === "No recessive effect" ||
                effect === "Unknown gene type"
            ) {
                return {
                    type: "neutral",
                    attribute: null,
                    effect: effect,
                };
            }

            // Robust potential/neutral/positive/negative detection
            let type = "neutral";
            const effectStr = effect || "";

            // Dynamic attribute detection using centralized config
            const attribute = extractAttributeFromEffect(effectStr);

            // Potential effect detection
            const isPotential =
                effectStr.includes("?") ||
                effectStr.toLowerCase().includes("potential");
            const hasPlus = effectStr.includes("+");
            const hasMinus = effectStr.includes("-");

            if (isPotential && hasPlus) type = "potential-positive";
            else if (isPotential && hasMinus) type = "potential-negative";
            else if (!isPotential && hasPlus) type = "positive";
            else if (!isPotential && hasMinus) type = "negative";
            // else remains "neutral"

            return {
                type,
                attribute: attribute,
                effect: effect,
            };
        } else {
            // Appearance mode
            const appearance = getGeneAppearance(species, geneId);
            let appearanceCategory = "appearance-neutral";

            // Species-specific appearance categorization
            if (species.toLowerCase() === "horse") {
                // Horse appearance categories - group by base attribute name
                if (appearance.startsWith("Scale")) {
                    appearanceCategory = "scale";
                } else if (appearance.startsWith("Attributes")) {
                    appearanceCategory = "attributes";
                } else if (appearance.startsWith("Selector")) {
                    appearanceCategory = "selector";
                } else if (appearance.startsWith("Horn")) {
                    appearanceCategory = "horn";
                } else if (appearance.startsWith("Aura")) {
                    appearanceCategory = "aura";
                } else if (appearance.startsWith("Coat")) {
                    appearanceCategory = "coat";
                } else if (
                    appearance.startsWith("Face Markings") ||
                    appearance.startsWith("Face markings") ||
                    appearance.startsWith("Face-markings")
                ) {
                    appearanceCategory = "face-markings";
                } else if (appearance.startsWith("Hair")) {
                    appearanceCategory = "hair";
                } else if (
                    appearance.startsWith("Leg Markings") ||
                    appearance.startsWith("Leg markings") ||
                    appearance.startsWith("Leg-markings")
                ) {
                    appearanceCategory = "leg-markings";
                } else if (appearance.startsWith("Magical")) {
                    appearanceCategory = "magical";
                } else if (appearance.startsWith("Markings")) {
                    appearanceCategory = "markings";
                }
                // Note: "None" appearances should remain as "appearance-neutral" (unstyled)
            } else {
                // BeeWasp appearance categories
                if (appearance.includes("Body Color Hue")) {
                    appearanceCategory = "body-color-hue";
                } else if (appearance.includes("Body Color Saturation")) {
                    appearanceCategory = "body-color-saturation";
                } else if (appearance.includes("Body Color Intensity")) {
                    appearanceCategory = "body-color-intensity";
                } else if (appearance.includes("Wing Color Hue")) {
                    appearanceCategory = "wing-color-hue";
                } else if (appearance.includes("Wing Color Saturation")) {
                    appearanceCategory = "wing-color-saturation";
                } else if (appearance.includes("Wing Color Intensity")) {
                    appearanceCategory = "wing-color-intensity";
                } else if (appearance.includes("Body Scale")) {
                    appearanceCategory = "body-scale";
                } else if (appearance.includes("Wing Scale")) {
                    appearanceCategory = "wing-scale";
                } else if (appearance.includes("Head Scale")) {
                    appearanceCategory = "head-scale";
                } else if (appearance.includes("Tail Scale")) {
                    appearanceCategory = "tail-scale";
                } else if (appearance.includes("Antenna Scale")) {
                    appearanceCategory = "antenna-scale";
                } else if (appearance.includes("Leg Deformity")) {
                    appearanceCategory = "leg-deformity";
                } else if (appearance.includes("Antenna Deformity")) {
                    appearanceCategory = "antenna-deformity";
                } else if (appearance.includes("Particles")) {
                    appearanceCategory = "particles";
                } else if (appearance.includes("Particle Location")) {
                    appearanceCategory = "particle-location";
                } else if (appearance.includes("Glow")) {
                    appearanceCategory = "glow";
                }
            }

            return {
                type: appearanceCategory,
                attribute: appearanceCategory,
                effect: appearance,
            };
        }
    }

    function hasAnyPotentialEffect(species, geneId) {
        if (currentView === "attribute") {
            const dominantEffect = getGeneEffect(species, geneId, "D");
            const recessiveEffect = getGeneEffect(species, geneId, "R");

            const dominantHasEffect =
                dominantEffect &&
                dominantEffect !== "No gene data found" &&
                dominantEffect !== "No dominant effect" &&
                dominantEffect !== "Unknown gene type" &&
                dominantEffect !== "None" &&
                dominantEffect !== "null" &&
                dominantEffect.trim() !== "";
            const recessiveHasEffect =
                recessiveEffect &&
                recessiveEffect !== "No gene data found" &&
                recessiveEffect !== "No recessive effect" &&
                recessiveEffect !== "Unknown gene type" &&
                recessiveEffect !== "None" &&
                recessiveEffect !== "null" &&
                recessiveEffect.trim() !== "";

            return dominantHasEffect || recessiveHasEffect;
        } else {
            const appearance = getGeneAppearance(species, geneId);
            return appearance !== "No appearance effect";
        }
    }

    function analyzePotentialEffectType(species, geneId) {
        const dominantEffect = getGeneEffect(species, geneId, "D");
        const recessiveEffect = getGeneEffect(species, geneId, "R");

        let hasPositive = false;
        let hasNegative = false;

        if (
            dominantEffect &&
            dominantEffect !== "No gene data found" &&
            dominantEffect !== "No dominant effect" &&
            dominantEffect !== "Unknown gene type"
        ) {
            if (dominantEffect.includes("+")) hasPositive = true;
            if (dominantEffect.includes("-")) hasNegative = true;
        }

        if (
            recessiveEffect &&
            recessiveEffect !== "No gene data found" &&
            recessiveEffect !== "No recessive effect" &&
            recessiveEffect !== "Unknown gene type"
        ) {
            if (recessiveEffect.includes("+")) hasPositive = true;
            if (recessiveEffect.includes("-")) hasNegative = true;
        }

        if (hasPositive) return "potential-positive";
        if (hasNegative) return "potential-negative";
        return null;
    }

    function isGeneVisible(chromosome, gene, geneAnalysis) {
        // Chromosome filter
        if (
            selectedChromosomes.length > 0 &&
            !selectedChromosomes.includes(chromosome)
        ) {
            return false;
        }

        // Hidden chromosomes
        if (hiddenChromosomes.includes(chromosome)) {
            return false;
        }

        // Attribute filter
        if (currentView === "attribute") {
            if (
                selectedAttributes.length > 0 &&
                !genePotentiallyAffectsSelectedAttributes(
                    currentPet.species,
                    gene.id,
                    selectedAttributes,
                )
            ) {
                return false;
            }
        } else {
            if (
                selectedAttributes.length > 0 &&
                !selectedAttributes.includes(geneAnalysis.attribute)
            ) {
                return false;
            }
        }

        // Hidden attributes
        if (hiddenAttributes.includes(geneAnalysis.attribute)) {
            return false;
        }

        // Effect filter
        if (currentEffectFilter.length > 0) {
            let effectType = geneAnalysis.type;

            // Handle potential effects for neutral genes
            if (
                geneAnalysis.type === "neutral" &&
                hasAnyPotentialEffect(currentPet.species, gene.id)
            ) {
                const potentialType = analyzePotentialEffectType(
                    currentPet.species,
                    gene.id,
                );
                if (potentialType) {
                    effectType = potentialType;
                }
            }

            const matchesEffect = currentEffectFilter.includes(effectType);
            if (!matchesEffect) return false;
        }

        // Hidden effects
        if (hiddenEffectFilters.length > 0) {
            let effectType = geneAnalysis.type;

            // Handle potential effects for neutral genes
            if (
                geneAnalysis.type === "neutral" &&
                hasAnyPotentialEffect(currentPet.species, gene.id)
            ) {
                const potentialType = analyzePotentialEffectType(
                    currentPet.species,
                    gene.id,
                );
                if (potentialType) {
                    effectType = potentialType;
                }
            }

            const isHidden = hiddenEffectFilters.includes(effectType);
            if (isHidden) return false;
        }

        // Value filter
        if (currentValueFilter.length > 0) {
            const geneTypeClass = `gene-${gene.type === "D" ? "dominant" : gene.type === "R" ? "recessive" : gene.type === "x" ? "mixed" : gene.type === "?" ? "unknown" : "recessive"}`;
            const matchesValue = currentValueFilter.some((value) =>
                geneTypeClass.includes(value),
            );
            if (!matchesValue) return false;
        }

        // Hidden values
        if (hiddenValueFilters.length > 0) {
            const geneTypeClass = `gene-${gene.type === "D" ? "dominant" : gene.type === "R" ? "recessive" : gene.type === "x" ? "mixed" : gene.type === "?" ? "unknown" : "recessive"}`;
            const isHidden = hiddenValueFilters.some((value) =>
                geneTypeClass.includes(value),
            );
            if (isHidden) return false;
        }

        return true;
    }

    function genePotentiallyAffectsSelectedAttributes(
        species,
        geneId,
        selectedAttributes,
    ) {
        if (selectedAttributes.length === 0) {
            return true;
        }

        const dominantEffect = getGeneEffect(species, geneId, "D");
        const recessiveEffect = getGeneEffect(species, geneId, "R");

        const allPotentialAttributes = [];

        if (
            dominantEffect &&
            dominantEffect !== "No gene data found" &&
            dominantEffect !== "No dominant effect" &&
            dominantEffect !== "Unknown gene type"
        ) {
            const dominantAttributes =
                extractAttributesFromEffect(dominantEffect);
            allPotentialAttributes.push(...dominantAttributes);
        }

        if (
            recessiveEffect &&
            recessiveEffect !== "No gene data found" &&
            recessiveEffect !== "No recessive effect" &&
            recessiveEffect !== "Unknown gene type"
        ) {
            const recessiveAttributes =
                extractAttributesFromEffect(recessiveEffect);
            allPotentialAttributes.push(...recessiveAttributes);
        }

        return allPotentialAttributes.some((attr) =>
            selectedAttributes.includes(attr),
        );
    }

    async function updateVisualization() {
        if (!currentPet) {
            return;
        }

        try {
            await createGeneVisualization();
        } catch (err) {
            console.error("Error updating visualization:", err);
            error = "Failed to update gene visualization";
        }
    }

    async function createGeneVisualization() {
        if (!currentPet || !currentPet.genes) {
            // Reset to empty state with proper structure
            headerStructure = null;
            chromosomeData = [];
            currentStats = null;
            totalGenes = 0;
            neutralGenes = 0;

            return;
        }

        try {
            console.time("🚀 Gene Visualization Processing");
            const pet = currentPet;
            const parsedGenes = parseGenes(pet.genes);

            if (!parsedGenes || Object.keys(parsedGenes).length === 0) {
                headerStructure = null;
                chromosomeData = [];
                return;
            }

            const allStats = await initializeStats();

            // OPTIMIZED SINGLE-PASS PROCESSING - Everything done in one loop!
            console.time("📊 Single-pass gene analysis");

            const allBlocks = new SvelteSet();
            const blockMaxGenes = new SvelteMap();
            const geneAnalysisCache = new SvelteMap(); // Cache gene analysis results
            let totalGenesCount = 0;

            // SINGLE PASS: Analyze genes, collect blocks, and update stats - all at once!
            Object.values(parsedGenes).forEach((chromosomeData) => {
                // Count genes per block for this chromosome
                const thisChromosomeBlockCount = new SvelteMap();

                chromosomeData.allGenes.forEach((gene) => {
                    allBlocks.add(gene.block);
                    totalGenesCount++;

                    // Track genes per block for this chromosome
                    const currentCount =
                        thisChromosomeBlockCount.get(gene.block) || 0;
                    thisChromosomeBlockCount.set(gene.block, currentCount + 1);

                    // Pre-compute and cache gene analysis once
                    const cacheKey = `${gene.id}_${gene.type}`;
                    if (!geneAnalysisCache.has(cacheKey)) {
                        const geneAnalysis = analyzeGeneEffect(
                            pet.species,
                            gene.id,
                            gene.type,
                        );

                        // Handle potential effects in the same pass
                        let effectType = geneAnalysis.type;
                        if (
                            geneAnalysis.type === "neutral" &&
                            hasAnyPotentialEffect(pet.species, gene.id)
                        ) {
                            const potentialType = analyzePotentialEffectType(
                                pet.species,
                                gene.id,
                            );
                            if (potentialType) {
                                effectType = potentialType;
                            }
                        }

                        const processedAnalysis = {
                            ...geneAnalysis,
                            type: effectType,
                        };

                        geneAnalysisCache.set(cacheKey, processedAnalysis);
                        updateStats(allStats, processedAnalysis);
                    }
                });

                // Update global max for each block based on this chromosome
                thisChromosomeBlockCount.forEach((count, block) => {
                    const currentMax = blockMaxGenes.get(block) || 0;
                    blockMaxGenes.set(block, Math.max(currentMax, count));
                });
            });

            console.timeEnd("📊 Single-pass gene analysis");

            // Calculate potential DOM elements to be rendered
            const chromosomeCount = Object.keys(parsedGenes).length;
            let totalDOMElements = 0;
            blockMaxGenes.forEach((maxGenes) => {
                totalDOMElements += chromosomeCount * maxGenes;
            });
            console.warn(
                `⚠️ About to render ${totalDOMElements} DOM elements (${chromosomeCount} chromosomes × blocks × genes)`,
            );
            if (totalDOMElements > 5000) {
                console.warn("🚨 This will likely cause DOM rendering delays!");
            }

            currentStats = allStats;
            totalGenes = totalGenesCount;

            if (currentView === "attribute") {
                neutralGenes = allStats.neutral;
            } else {
                neutralGenes = allStats["appearance-neutral"];
            }

            onStatsUpdated?.();

            const sortedBlocks = Array.from(allBlocks).sort((a, b) => {
                const numA = parseInt(a, 10);
                const numB = parseInt(b, 10);
                return numA - numB;
            });

            const sortedChromosomes = Object.entries(parsedGenes).sort(
                ([a], [b]) => {
                    const numA = parseInt(a, 10);
                    const numB = parseInt(b, 10);
                    return numA - numB;
                },
            );

            headerStructure = {
                sortedBlocks,
                blockMaxGenes,
            };

            // Create or reuse species template
            currentSpeciesTemplate = getOrCreateSpeciesTemplate(
                pet.species,
                headerStructure,
                chromosomeCount,
            );

            // Build chromosome data using cached analysis
            const buildTime = isUsingCachedTemplate
                ? "🔄 Updating chromosome data"
                : "🏗️ Building chromosome data";
            console.time(buildTime);
            chromosomeData = sortedChromosomes.map(([chromosome, data]) => {
                const processedBlocks = {};

                // Pre-group genes by block for efficiency
                const genesByBlock = new SvelteMap();
                data.allGenes.forEach((gene) => {
                    if (!genesByBlock.has(gene.block)) {
                        genesByBlock.set(gene.block, []);
                    }
                    genesByBlock.get(gene.block).push(gene);
                });

                sortedBlocks.forEach((block) => {
                    const genesInBlock = genesByBlock.get(block) || [];
                    processedBlocks[block] = [];

                    for (let i = 0; i < blockMaxGenes.get(block); i++) {
                        const gene = genesInBlock[i];
                        if (gene) {
                            const cacheKey = `${gene.id}_${gene.type}`;
                            const geneAnalysis =
                                geneAnalysisCache.get(cacheKey);

                            processedBlocks[block][i] = {
                                ...gene,
                                geneAnalysis,
                                isVisible: isGeneVisible(
                                    chromosome,
                                    gene,
                                    geneAnalysis,
                                ),
                            };
                        } else {
                            processedBlocks[block][i] = null;
                        }
                    }
                });

                return {
                    chromosome,
                    data,
                    processedBlocks,
                };
            });
            console.timeEnd(buildTime);

            console.time("🔄 State update (triggers DOM render)");
            // This assignment triggers Svelte's DOM update cycle
            // With template caching, DOM structure should be reused when possible
            console.timeEnd("🔄 State update (triggers DOM render)");

            // Performance optimization complete - using optimized dynamic rendering

            console.timeEnd("🚀 Gene Visualization Processing");
        } catch (err) {
            console.error("Error in createGeneVisualization:", err);
            error = `Failed to create gene visualization: ${err.message}`;
            headerStructure = null;
            chromosomeData = [];
        }
    }

    function handleTooltipShow(event) {
        const detail = event.detail;
        const geneId = detail.geneId;
        const geneType = detail.geneType;

        const effectInfo = detail.effect;

        const potentialEffects = [];
        if (currentPet) {
            const dominantEffect = getGeneEffect(
                currentPet.species,
                geneId,
                "D",
            );
            const recessiveEffect = getGeneEffect(
                currentPet.species,
                geneId,
                "R",
            );

            if (
                geneType !== "D" &&
                dominantEffect &&
                dominantEffect !== "No dominant effect" &&
                dominantEffect !== "No gene data found" &&
                dominantEffect !== "Unknown gene type"
            ) {
                const isPositive = dominantEffect.includes("+");
                const isNegative = dominantEffect.includes("-");
                const color = isPositive
                    ? "#4CAF50"
                    : isNegative
                      ? "#f44336"
                      : "#666";
                potentialEffects.push(
                    `If Dominant: <span style="color: ${color}">${dominantEffect}</span>`,
                );
            }

            if (
                geneType !== "R" &&
                recessiveEffect &&
                recessiveEffect !== "No recessive effect" &&
                recessiveEffect !== "No gene data found" &&
                recessiveEffect !== "Unknown gene type"
            ) {
                const isPositive = recessiveEffect.includes("+");
                const isNegative = recessiveEffect.includes("-");
                const color = isPositive
                    ? "#4CAF50"
                    : isNegative
                      ? "#f44336"
                      : "#666";
                potentialEffects.push(
                    `If Recessive: <span style="color: ${color}">${recessiveEffect}</span>`,
                );
            }
        }

        const mouseEvent = detail.event;

        // Calculate smart positioning to stay close to mouse cursor while avoiding edge cropping
        const tooltipWidth = 250; // max-width from CSS
        // Calculate actual height based on content
        const baseHeight = 45; // base height for gene ID and type
        const effectHeight = 20; // height per effect line
        const potentialEffectHeight = 15; // height per potential effect
        const tooltipHeight =
            baseHeight +
            (effectInfo &&
            effectInfo !== "No gene data found" &&
            effectInfo !== "No dominant effect" &&
            effectInfo !== "No recessive effect"
                ? effectHeight
                : 0) +
            potentialEffects.length * potentialEffectHeight;
        const offset = 12; // Small offset from cursor

        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Use viewport (fixed) coordinates — avoids all scroll offset issues
        let x = mouseEvent.clientX + offset;
        let y = mouseEvent.clientY + offset;

        // Keep tooltip within viewport
        if (x + tooltipWidth > viewportWidth) {
            x = mouseEvent.clientX - tooltipWidth - offset;
        }
        if (y + tooltipHeight > viewportHeight) {
            y = mouseEvent.clientY - tooltipHeight - offset;
        }
        if (y < 0) {
            y = mouseEvent.clientY + offset;
        }
        if (x < 0) {
            x = mouseEvent.clientX + offset;
        }

        tooltipX = x;
        tooltipY = y;

        tooltipGeneId = geneId;
        tooltipGeneType = geneType;
        tooltipEffect = effectInfo;
        tooltipPotentialEffects = potentialEffects;
        tooltipVisible = true;
    }

    function handleTooltipHide() {
        tooltipVisible = false;
    }

    function toggleFilterState(selectedArr, hiddenArr, key, action) {
        const isSelected = selectedArr.includes(key);
        const isHidden = hiddenArr.includes(key);

        if (
            (action === "select" && isHidden) ||
            (action === "hide" && isSelected) ||
            (action === "toggle-select" && isHidden) ||
            (action === "toggle-hide" && isSelected)
        ) {
            return {
                selected: selectedArr.filter((k) => k !== key),
                hidden: hiddenArr.filter((k) => k !== key),
            };
        }

        if (action === "select" || action === "toggle-select") {
            if (isSelected) {
                return {
                    selected: selectedArr.filter((k) => k !== key),
                    hidden: hiddenArr,
                };
            } else {
                return {
                    selected: [...selectedArr, key],
                    hidden: hiddenArr.filter((k) => k !== key),
                };
            }
        }

        if (action === "hide" || action === "toggle-hide") {
            if (isHidden) {
                return {
                    selected: selectedArr,
                    hidden: hiddenArr.filter((k) => k !== key),
                };
            } else {
                return {
                    selected: selectedArr.filter((k) => k !== key),
                    hidden: [...hiddenArr, key],
                };
            }
        }

        return { selected: selectedArr, hidden: hiddenArr };
    }

    export function handleAttributeFilter(event) {
        const { attribute, ctrlKey, altKey } = event.detail;

        let result;
        if (altKey) {
            result = toggleFilterState(
                selectedAttributes,
                hiddenAttributes,
                attribute,
                "toggle-hide",
            );
        } else if (ctrlKey) {
            result = toggleFilterState(
                selectedAttributes,
                hiddenAttributes,
                attribute,
                "toggle-select",
            );
        } else {
            if (hiddenAttributes.includes(attribute)) {
                result = toggleFilterState(
                    [],
                    hiddenAttributes,
                    attribute,
                    "toggle-select",
                );
            } else if (
                selectedAttributes.length === 1 &&
                selectedAttributes[0] === attribute
            ) {
                result = {
                    selected: [],
                    hidden: hiddenAttributes.filter((a) => a !== attribute),
                };
            } else {
                result = {
                    selected: [attribute],
                    hidden: hiddenAttributes.filter((a) => a !== attribute),
                };
            }
        }

        selectedAttributes = result.selected;
        hiddenAttributes = result.hidden;
        updateVisualization();
    }

    function toggleChromosomeFilter(
        chromosome,
        ctrlKey = false,
        altKey = false,
    ) {
        if (altKey) {
            const index = hiddenChromosomes.indexOf(chromosome);
            if (index === -1) {
                hiddenChromosomes = [...hiddenChromosomes, chromosome];
            } else {
                hiddenChromosomes = hiddenChromosomes.filter(
                    (c) => c !== chromosome,
                );
            }
        } else if (ctrlKey) {
            const index = selectedChromosomes.indexOf(chromosome);
            if (index === -1) {
                selectedChromosomes = [...selectedChromosomes, chromosome];
            } else {
                selectedChromosomes = selectedChromosomes.filter(
                    (c) => c !== chromosome,
                );
            }
        } else {
            if (
                selectedChromosomes.length === 1 &&
                selectedChromosomes[0] === chromosome
            ) {
                selectedChromosomes = [];
            } else {
                selectedChromosomes = [chromosome];
            }
        }
        updateVisualization();
    }

    function handleLegendFilterClick(filterType, event) {
        const isCtrlClick = event.ctrlKey || event.metaKey;
        const isAltClick = event.altKey;

        if (currentView === "attribute") {
            if (
                [
                    "positive",
                    "negative",
                    "neutral",
                    "potential-positive",
                    "potential-negative",
                ].includes(filterType)
            ) {
                handleEffectFilter(filterType, isCtrlClick, isAltClick);
            } else if (
                ["dominant", "recessive", "mixed", "unknown"].includes(
                    filterType,
                )
            ) {
                handleValueFilter(filterType, isCtrlClick, isAltClick);
            }
        } else {
            handleAppearanceFilter(filterType, isCtrlClick, isAltClick);
        }
    }

    function handleEffectFilter(
        effectType,
        isCtrlClick = false,
        isAltClick = false,
    ) {
        const newFilter = Array.isArray(currentEffectFilter)
            ? [...currentEffectFilter]
            : [];
        const newHidden = Array.isArray(hiddenEffectFilters)
            ? [...hiddenEffectFilters]
            : [];
        let result;

        if (isAltClick) {
            result = toggleFilterState(
                newFilter,
                newHidden,
                effectType,
                "toggle-hide",
            );
        } else if (isCtrlClick) {
            result = toggleFilterState(
                newFilter,
                newHidden,
                effectType,
                "toggle-select",
            );
        } else {
            if (newHidden.includes(effectType)) {
                result = toggleFilterState(
                    [],
                    newHidden,
                    effectType,
                    "toggle-select",
                );
            } else if (newFilter.length === 1 && newFilter[0] === effectType) {
                result = {
                    selected: [],
                    hidden: newHidden.filter((t) => t !== effectType),
                };
            } else {
                result = {
                    selected: [effectType],
                    hidden: newHidden.filter((t) => t !== effectType),
                };
            }
        }
        currentEffectFilter = result.selected;
        hiddenEffectFilters = result.hidden;
        updateVisualization();
    }

    function handleValueFilter(
        valueType,
        isCtrlClick = false,
        isAltClick = false,
    ) {
        const valueMap = {
            dominant: "gene-dominant",
            recessive: "gene-recessive",
            mixed: "gene-mixed",
            unknown: "gene-unknown",
        };
        const mappedValueType = valueMap[valueType] || valueType;

        const newValueFilter = Array.isArray(currentValueFilter)
            ? [...currentValueFilter]
            : [];
        const newHiddenValues = Array.isArray(hiddenValueFilters)
            ? [...hiddenValueFilters]
            : [];
        let result;

        if (isAltClick) {
            result = toggleFilterState(
                newValueFilter,
                newHiddenValues,
                mappedValueType,
                "toggle-hide",
            );
        } else if (isCtrlClick) {
            result = toggleFilterState(
                newValueFilter,
                newHiddenValues,
                mappedValueType,
                "toggle-select",
            );
        } else {
            if (newHiddenValues.includes(mappedValueType)) {
                result = toggleFilterState(
                    [],
                    newHiddenValues,
                    mappedValueType,
                    "toggle-select",
                );
            } else if (
                newValueFilter.length === 1 &&
                newValueFilter[0] === mappedValueType
            ) {
                result = {
                    selected: [],
                    hidden: newHiddenValues.filter(
                        (t) => t !== mappedValueType,
                    ),
                };
            } else {
                result = {
                    selected: [mappedValueType],
                    hidden: newHiddenValues.filter(
                        (t) => t !== mappedValueType,
                    ),
                };
            }
        }
        currentValueFilter = result.selected;
        hiddenValueFilters = result.hidden;
        updateVisualization();
    }

    function handleAppearanceFilter(
        appearanceType,
        isCtrlClick = false,
        isAltClick = false,
    ) {
        let attributeGroups = [];
        switch (appearanceType) {
            // BeeWasp appearance categories
            case "body-color":
                attributeGroups = [
                    "body-color-hue",
                    "body-color-saturation",
                    "body-color-intensity",
                ];
                break;
            case "wing-color":
                attributeGroups = [
                    "wing-color-hue",
                    "wing-color-saturation",
                    "wing-color-intensity",
                ];
                break;
            case "deformity":
                attributeGroups = ["leg-deformity", "antenna-deformity"];
                break;
            case "particles":
                attributeGroups = ["particles", "particle-location"];
                break;
            case "glow":
                attributeGroups = ["glow"];
                break;
            case "neutral":
                attributeGroups = ["appearance-neutral"];
                break;

            // Horse appearance categories
            case "scale":
                attributeGroups = ["scale"];
                break;
            case "attributes":
                attributeGroups = ["attributes"];
                break;
            case "selector":
                attributeGroups = ["selector"];
                break;
            case "horn":
                attributeGroups = ["horn"];
                break;
            case "aura":
                attributeGroups = ["aura"];
                break;
            case "coat":
                attributeGroups = ["coat"];
                break;
            case "face-markings":
                attributeGroups = ["face-markings"];
                break;
            case "hair":
                attributeGroups = ["hair"];
                break;
            case "leg-markings":
                attributeGroups = ["leg-markings"];
                break;
            case "magical":
                attributeGroups = ["magical"];
                break;
            case "markings":
                attributeGroups = ["markings"];
                break;

            // BeeWasp scale categories (keeping for compatibility)
            case "body-scale":
            case "wing-scale":
            case "head-scale":
            case "tail-scale":
            case "antenna-scale":
                attributeGroups = [
                    "body-scale",
                    "wing-scale",
                    "head-scale",
                    "tail-scale",
                    "antenna-scale",
                ];
                break;
        }

        attributeGroups.forEach((attr) => {
            if (isAltClick) {
                const index = hiddenAttributes.indexOf(attr);
                if (index === -1) {
                    hiddenAttributes = [...hiddenAttributes, attr];
                } else {
                    hiddenAttributes = hiddenAttributes.filter(
                        (a) => a !== attr,
                    );
                }
            } else if (isCtrlClick) {
                const index = selectedAttributes.indexOf(attr);
                if (index === -1) {
                    selectedAttributes = [...selectedAttributes, attr];
                } else {
                    selectedAttributes = selectedAttributes.filter(
                        (a) => a !== attr,
                    );
                }
            } else {
                const allSelected = attributeGroups.every((a) =>
                    selectedAttributes.includes(a),
                );
                if (allSelected) {
                    selectedAttributes = selectedAttributes.filter(
                        (a) => !attributeGroups.includes(a),
                    );
                } else {
                    const newSelected = [...selectedAttributes];
                    attributeGroups.forEach((a) => {
                        if (!newSelected.includes(a)) {
                            newSelected.push(a);
                        }
                    });
                    selectedAttributes = newSelected;
                }
            }
        });
        updateVisualization();
    }

    // Track the last processed pet ID to prevent loops
    let lastProcessedPetId = $state(null);

    // Use $effect for pet change detection
    $effect(() => {
        if (pet && pet.id !== lastProcessedPetId && !loading) {
            lastProcessedPetId = pet.id;
            loadPetData();
        } else if (!pet && lastProcessedPetId !== null) {
            lastProcessedPetId = null;
            cleanup();
        }
    });

    // Export functions for parent component
    export function handleViewChange(view) {
        currentView = view;
        updateVisualization();
    }

    export function getStatsData() {
        return {
            currentStats,
            currentView,
            selectedAttributes,
            hiddenAttributes,
            totalGenes,
            neutralGenes,
            petSpecies: currentPet?.species,
        };
    }
</script>

<div class="gene-visualizer" bind:this={containerElement}>
    {#if loading}
        <div class="loading-state">Loading gene data...</div>
    {:else if error}
        <div class="error-state">Error: {error}</div>
    {:else if !currentPet}
        <div class="empty-state">Select a pet to visualize its genes</div>
    {:else}
        <div class="visualizer-content">
            <div class="gene-section">
                <!-- Legend -->
                <div class="gene-legend">
                    <div class="legend-items">
                        {#if currentView === "attribute"}
                            <div class="legend-row">
                                <span class="legend-label legend-label-effect"
                                    >Effect:</span
                                >

                                <span
                                    class="legend-item effect-legend-item {currentEffectFilter.includes(
                                        'positive',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenEffectFilters.includes(
                                        'positive',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("positive", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("positive", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "positive",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Positive</span>
                                </span>

                                <span
                                    class="legend-item effect-legend-item {currentEffectFilter.includes(
                                        'potential-positive',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenEffectFilters.includes(
                                        'potential-positive',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick(
                                            "potential-positive",
                                            e,
                                        )}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("potential-positive", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "potential-positive",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Potential Positive</span>
                                </span>

                                <span
                                    class="legend-item effect-legend-item {currentEffectFilter.includes(
                                        'neutral',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenEffectFilters.includes(
                                        'neutral',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("neutral", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("neutral", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "neutral",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Neutral</span>
                                </span>

                                <span
                                    class="legend-item effect-legend-item {currentEffectFilter.includes(
                                        'potential-negative',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenEffectFilters.includes(
                                        'potential-negative',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick(
                                            "potential-negative",
                                            e,
                                        )}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("potential-negative", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "potential-negative",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Potential Negative</span>
                                </span>

                                <span
                                    class="legend-item effect-legend-item {currentEffectFilter.includes(
                                        'negative',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenEffectFilters.includes(
                                        'negative',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("negative", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("negative", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "negative",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Negative</span>
                                </span>
                                <span class="legend-label legend-label-value"
                                    >Value:</span
                                >

                                <span
                                    class="legend-item value-legend-item {currentValueFilter.includes(
                                        'gene-dominant',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenValueFilters.includes(
                                        'gene-dominant',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("dominant", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("dominant", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "neutral",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Dominant</span>
                                </span>

                                <span
                                    class="legend-item value-legend-item {currentValueFilter.includes(
                                        'gene-recessive',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenValueFilters.includes(
                                        'gene-recessive',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("recessive", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("recessive", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "R" }}
                                        geneAnalysis={{
                                            type: "neutral",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Recessive</span>
                                </span>

                                <span
                                    class="legend-item value-legend-item {currentValueFilter.includes(
                                        'gene-mixed',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenValueFilters.includes(
                                        'gene-mixed',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("mixed", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("mixed", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "x" }}
                                        geneAnalysis={{
                                            type: "neutral",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Mixed</span>
                                </span>

                                <span
                                    class="legend-item value-legend-item {currentValueFilter.includes(
                                        'gene-unknown',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenValueFilters.includes(
                                        'gene-unknown',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick("unknown", e)}
                                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick("unknown", e); }}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "?" }}
                                        geneAnalysis={{
                                            type: "neutral",
                                            attribute: null,
                                        }}
                                        currentView="attribute"
                                        isVisible={true}
                                    />
                                    <span>Unknown</span>
                                </span>
                            </div>
                        {:else}
                            <div class="legend-row">
                                <span
                                    class="legend-label legend-label-appearance"
                                    >Appearance:</span
                                >

                                {#each appearanceList as appearance (appearance.key)}
                                    {@const attrKey = appearance.key.replace(
                                        /_/g,
                                        "-",
                                    )}
                                    <span
                                        class="legend-item appearance-legend-item {selectedAttributes.includes(
                                            attrKey,
                                        )
                                            ? 'selected'
                                            : ''} {hiddenAttributes.includes(
                                            attrKey,
                                        )
                                            ? 'hidden-effect'
                                            : ''}"
                                        role="button"
                                        tabindex="0"
                                        onclick={(e) =>
                                            handleLegendFilterClick(attrKey, e)}
                                        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleLegendFilterClick(attrKey, e); }}
                                    >
                                        <GeneCell
                                            gene={{ id: "sample", type: "D" }}
                                            geneAnalysis={{
                                                type: attrKey,
                                                attribute: attrKey,
                                            }}
                                            currentView="appearance"
                                            isVisible={true}
                                        />
                                        <span>{appearance.name}</span>
                                    </span>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Gene Grid -->
                <div class="gene-grid-container">
                    {#if headerStructure && chromosomeData.length > 0}
                        <!-- Optimized dynamic rendering -->
                        {#key currentSpeciesTemplate ? currentSpeciesTemplate.species + "_" + currentSpeciesTemplate.chromosomeCount + "_" + currentSpeciesTemplate.blockCount : "initial"}
                            <table class="gene-grid-table">
                                <thead class="gene-headers">
                                    <tr>
                                        <th class="chromosome-header">Chr</th>
                                        {#each headerStructure.sortedBlocks as block (block)}
                                            {#each Array.from({ length: headerStructure.blockMaxGenes.get(block) }, (_, i) => i) as i (i)}
                                                <th
                                                    class="position-header {i ===
                                                    0
                                                        ? 'block-label block-start'
                                                        : ''}"
                                                >
                                                    {i === 0 ? block : ""}
                                                </th>
                                            {/each}
                                        {/each}
                                    </tr>
                                </thead>
                                <tbody class="gene-rows">
                                    {#each chromosomeData as { chromosome, processedBlocks } (chromosome)}
                                        <tr class="chromosome-row">
                                            <td
                                                class="chromosome-label {selectedChromosomes.includes(
                                                    chromosome,
                                                )
                                                    ? 'selected'
                                                    : ''} {hiddenChromosomes.includes(
                                                    chromosome,
                                                )
                                                    ? 'hidden-chromosome'
                                                    : ''}"
                                                data-chromosome={chromosome}
                                                onclick={(e) =>
                                                    toggleChromosomeFilter(
                                                        chromosome,
                                                        e.ctrlKey || e.metaKey,
                                                        e.altKey,
                                                    )}
                                            >
                                                {chromosome}
                                            </td>
                                            {#each headerStructure.sortedBlocks as block (block)}
                                                {#each Array.from({ length: headerStructure.blockMaxGenes.get(block) }, (_, i) => i) as i (i)}
                                                    {@const gene =
                                                        processedBlocks?.[
                                                            block
                                                        ]?.[i] || null}
                                                    <td
                                                        class="gene-cell-container {i ===
                                                        0
                                                            ? 'block-start'
                                                            : ''} {!gene
                                                            ? 'empty'
                                                            : ''}"
                                                    >
                                                        {#if gene}
                                                            <GeneCell
                                                                {gene}
                                                                {chromosome}
                                                                geneAnalysis={gene.geneAnalysis}
                                                                {currentView}
                                                                isVisible={gene.isVisible}
                                                                on:tooltip-show={handleTooltipShow}
                                                                on:tooltip-hide={handleTooltipHide}
                                                            />
                                                        {/if}
                                                    </td>
                                                {/each}
                                            {/each}
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        {/key}
                    {/if}
                </div>
            </div>
        </div>
    {/if}

    <!-- Tooltip using existing component -->
    <GeneTooltip
        visible={tooltipVisible}
        x={tooltipX}
        y={tooltipY}
        geneId={tooltipGeneId}
        geneType={tooltipGeneType}
        effect={tooltipEffect}
        potentialEffects={tooltipPotentialEffects}
    />
</div>

<style>
    /* CSS Custom Properties for Gene Colors */
    :global(:root) {
        --color-positive: #4caf50;
        --color-negative: #f44336;
        --color-neutral: #95a5a6;

        --gene-body-hue: #ff9800;
        --gene-body-saturation: #ff6f00;
        --gene-body-intensity: #ffcc02;
        --gene-wing-hue: #2196f3;
        --gene-wing-saturation: #1976d2;
        --gene-wing-intensity: #0d47a1;
        --gene-body-scale: #9c27b0;
        --gene-wing-scale: #7b1fa2;
        --gene-head-scale: #8e24aa;
        --gene-tail-scale: #ab47bc;
        --gene-antenna-scale: #ba68c8;
        --gene-leg-deformity: #e91e63;
        --gene-antenna-deformity: #c2185b;
        --gene-particles: #00bcd4;
        --gene-particle-location: #0097a7;
        --gene-glow: #8bc34a;
        --gene-appearance-neutral: #95a5a6;

        /* Horse appearance categories - using config color indicators */
        --gene-scale: #2980b9;
        --gene-attributes: #e74c3c;
        --gene-selector: #8e44ad;
        --gene-horn: #1abc9c;
        --gene-aura: #3498db;
        --gene-coat: #2ecc71;
        --gene-face-markings: #f39c12;
        --gene-hair: #9b59b6;
        --gene-leg-markings: #34495e;
        --gene-magical: #e67e22;
        --gene-markings: #16a085;
    }

    .gene-visualizer {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: #ffffff;
        min-height: 0;
    }

    .loading-state,
    .error-state,
    .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 300px;
        color: #666;
        font-size: 16px;
    }

    .error-state {
        color: #f44336;
    }

    .gene-visualizer {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .visualizer-content {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }

    .gene-section {
        padding: 10px;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }


    .gene-legend {
        margin-bottom: 10px;
        flex-shrink: 0;
    }

    .legend-items {
        width: 100%;
    }

    .legend-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5em;
    }

    .legend-label-effect {
        font-weight: 600;
        margin-right: 1em;
    }

    .legend-label-value {
        font-weight: 600;
        margin-left: 2em;
        margin-right: 1em;
    }

    .legend-item {
        display: flex;
        align-items: center;
        gap: 0.4em;
        font-size: 11px;
        color: #6b7280;
        white-space: nowrap;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        transition: background-color 0.2s ease;
    }

    .legend-item:hover {
        background-color: #f3f4f6;
    }

    /* Adjust legend item spacing for GeneCell components */
    .legend-item :global(.gene-cell) {
        margin: 0 4px 0 0;
    }

    /* Legend selection states */
    .effect-legend-item,
    .value-legend-item,
    .appearance-legend-item {
        cursor: pointer;
        transition:
            background 0.2s,
            box-shadow 0.2s,
            outline 0.2s;
    }

    .effect-legend-item.selected,
    .value-legend-item.selected,
    .appearance-legend-item.selected {
        background: rgba(59, 130, 246, 0.08) !important;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.08);
        outline: 2px solid #3b82f6;
        outline-offset: 2px;
    }

    .effect-legend-item.hidden-effect,
    .value-legend-item.hidden-effect,
    .appearance-legend-item.hidden-effect {
        opacity: 0.7;
        color: #b91c1c !important;
        text-decoration: line-through;
        filter: grayscale(0.7);
        pointer-events: auto;
        background: rgba(239, 68, 68, 0.1);
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(239, 68, 68, 0.1);
        outline: 2px solid #ef4444;
        outline-offset: 2px;
        transition:
            opacity 0.2s,
            color 0.2s,
            outline 0.2s;
    }

    .gene-grid-container {
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        background: #f9fafb;
    }

    .gene-grid-table {
        width: auto;
        border-collapse: collapse;
        table-layout: fixed;
    }

    .gene-headers {
        position: sticky;
        top: 0;
        z-index: 10;
        background: #f1f5f9;
    }

    .gene-headers th {
        background: #f1f5f9;
        border-bottom: 1px solid #e2e8f0;
        padding: 4px 8px;
        font-size: 10px;
        font-weight: normal;
        color: #374151;
        text-align: center;
        white-space: nowrap;
    }

    .chromosome-header {
        position: sticky;
        left: 0;
        z-index: 11;
        background: #f1f5f9;
        font-weight: bold;
        width: 32px;
        min-width: 32px;
        max-width: 32px;
    }

    .position-header {
        width: 19px;
        min-width: 19px;
        max-width: 19px;
        font-weight: normal;
    }

    .position-header.block-label {
        font-weight: bold;
    }

    .position-header.block-start {
        padding-left: 8px;
    }

    .position-header.block-start:first-of-type {
        padding-left: 4px;
    }

    .gene-rows {
        background: #f9fafb;
    }

    .chromosome-row {
        border-bottom: 1px solid #e2e8f0;
    }

    .chromosome-row:hover {
        background: #f8fafc;
    }

    .chromosome-label {
        position: sticky;
        left: 0;
        z-index: 1;
        background: #f9fafb;
        border-right: 1px solid #e2e8f0;
        padding: 8px 2px;
        font-size: 11px;
        font-weight: 600;
        color: #374151;
        text-align: center;
        cursor: pointer;
        transition: background-color 0.2s ease;
        user-select: none;
        width: 32px;
        min-width: 32px;
        max-width: 32px;
    }

    .chromosome-label:hover {
        background: #f3f4f6;
    }

    .chromosome-label.selected {
        background: #f3e8ff;
        color: #7c3aed;
        border-left: 3px solid #7c3aed;
        font-weight: 600;
    }

    .chromosome-label.hidden-chromosome {
        background: #fff7ed;
        color: #ea580c;
        border-left: 3px solid #ea580c;
        font-weight: 600;
    }

    .gene-cell-container {
        padding: 1px;
        text-align: center;
        vertical-align: middle;
        position: relative;
        width: 19px;
    }

    .gene-cell-container.empty {
        background: #fafafa;
    }

    .gene-cell-container.block-start {
        padding-left: 6px;
    }

    .gene-cell-container.block-start:first-of-type {
        padding-left: 2px;
    }

</style>
