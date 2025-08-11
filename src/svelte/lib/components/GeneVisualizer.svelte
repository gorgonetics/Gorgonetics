<script>
    import { onDestroy, onMount } from "svelte";
    import GeneStatsTable from "./GeneStatsTable.svelte";
    import GeneTooltip from "./GeneTooltip.svelte";
    import GeneCell from "./GeneCell.svelte";

    let { pet } = $props();

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
    let appearanceConfig = null;
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
    let tooltipEffect = $state("");
    let tooltipPotentialEffects = $state([]);

    // Parsed gene data
    let headerStructure = $state(null);
    let chromosomeData = $state([]);

    onMount(async () => {
        if (pet) {
            await loadPetData();
        }
    });

    onDestroy(() => {
        cleanup();
    });

    function cleanup() {
        console.log("🧹 cleanup() called - currentPet was:", currentPet?.name);
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

        error = null;
    }

    async function loadPetData() {
        if (!pet || loading) {
            console.log("🛑 Skipping loadPetData - no pet or already loading");
            return;
        }

        console.log("🚀 Starting loadPetData for:", pet.name);
        try {
            loading = true;
            error = null;

            const response = await fetch(`/api/pet-genome/${pet.id}`);
            if (!response.ok) {
                throw new Error("Failed to load pet genome");
            }

            currentPet = await response.json();
            console.log("✅ Pet data loaded:", currentPet.name);
            console.log(
                "🔍 currentPet set to:",
                currentPet.id,
                currentPet.name,
            );
            await loadGeneEffectsForSpecies(currentPet.species);
            await loadAppearanceConfig(currentPet.species);
            await updateVisualization();
            console.log("✅ Visualization complete");
        } catch (err) {
            error = `Failed to load pet: ${err.message}`;
            console.error("❌ Error loading pet data:", err);
        } finally {
            loading = false;
            console.log("🏁 loadPetData finished");
        }
    }

    async function loadGeneEffectsForSpecies(species) {
        try {
            const response = await fetch(`/api/gene-effects/${species}`);
            if (!response.ok) {
                throw new Error("Failed to load gene effects");
            }

            const data = await response.json();
            geneEffectsDB = { [species.toLowerCase()]: data.effects };
        } catch (err) {
            console.error("Error loading gene effects:", err);
            geneEffectsDB = null;
        }
    }

    async function loadAppearanceConfig(species) {
        if (!species) {
            appearanceList = [];
            return;
        }

        try {
            const response = await fetch(`/api/appearance-config/${species}`);
            if (response.ok) {
                appearanceConfig = await response.json();
                appearanceList = appearanceConfig.appearance_attributes || [];
            } else {
                console.warn(`Failed to load appearance config for ${species}`);
                appearanceList = [];
            }
        } catch (error) {
            console.error(
                `Error loading appearance config for ${species}:`,
                error,
            );
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
                try {
                    const response = await fetch(
                        `/api/attribute-config/${currentPet.species}`,
                    );
                    if (response.ok) {
                        const config = await response.json();
                        config.all_attribute_names.forEach((attrName) => {
                            const attrKey =
                                attrName.charAt(0).toUpperCase() +
                                attrName.slice(1);
                            stats[attrKey] = { positive: 0, negative: 0 };
                        });
                    } else {
                        // Fallback to default attributes
                        [
                            "Intelligence",
                            "Toughness",
                            "Friendliness",
                            "Ruggedness",
                            "Enthusiasm",
                            "Virility",
                            "Ferocity",
                        ].forEach((attr) => {
                            stats[attr] = { positive: 0, negative: 0 };
                        });
                    }
                } catch (error) {
                    console.error("Error loading attribute config:", error);
                    // Fallback to default attributes
                    [
                        "Intelligence",
                        "Toughness",
                        "Friendliness",
                        "Ruggedness",
                        "Enthusiasm",
                        "Virility",
                        "Ferocity",
                    ].forEach((attr) => {
                        stats[attr] = { positive: 0, negative: 0 };
                    });
                }
            } else {
                // Default attributes if no species specified
                [
                    "Intelligence",
                    "Toughness",
                    "Friendliness",
                    "Ruggedness",
                    "Enthusiasm",
                    "Virility",
                    "Ferocity",
                ].forEach((attr) => {
                    stats[attr] = { positive: 0, negative: 0 };
                });
            }

            return stats;
        } else {
            // Load species-specific appearance attributes from configuration
            const stats = {
                "appearance-neutral": 0,
            };

            if (currentPet?.species) {
                try {
                    const response = await fetch(
                        `/api/appearance-config/${currentPet.species}`,
                    );
                    if (response.ok) {
                        const config = await response.json();
                        config.appearance_attribute_names.forEach(
                            (attrName) => {
                                stats[attrName] = 0;
                            },
                        );
                    } else {
                        // Fallback appearance attributes
                        [
                            "body-color-hue",
                            "body-color-saturation",
                            "body-color-intensity",
                            "wing-color-hue",
                            "wing-color-saturation",
                            "wing-color-intensity",
                            "body-scale",
                            "wing-scale",
                            "head-scale",
                            "tail-scale",
                            "antenna-scale",
                            "leg-deformity",
                            "antenna-deformity",
                            "particles",
                            "particle-location",
                            "glow",
                        ].forEach((attr) => {
                            stats[attr] = 0;
                        });
                    }
                } catch (error) {
                    console.error("Error loading appearance config:", error);
                    // Fallback appearance attributes
                    [
                        "body-color-hue",
                        "body-color-saturation",
                        "body-color-intensity",
                        "wing-color-hue",
                        "wing-color-saturation",
                        "wing-color-intensity",
                        "body-scale",
                        "wing-scale",
                        "head-scale",
                        "tail-scale",
                        "antenna-scale",
                        "leg-deformity",
                        "antenna-deformity",
                        "particles",
                        "particle-location",
                        "glow",
                    ].forEach((attr) => {
                        stats[attr] = 0;
                    });
                }
            } else {
                // Fallback appearance attributes
                [
                    "body-color-hue",
                    "body-color-saturation",
                    "body-color-intensity",
                    "wing-color-hue",
                    "wing-color-saturation",
                    "wing-color-intensity",
                    "body-scale",
                    "wing-scale",
                    "head-scale",
                    "tail-scale",
                    "antenna-scale",
                    "leg-deformity",
                    "antenna-deformity",
                    "particles",
                    "particle-location",
                    "glow",
                ].forEach((attr) => {
                    stats[attr] = 0;
                });
            }

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

        let speciesKey = species.toLowerCase();
        if (speciesKey === "horse") {
            speciesKey = "horse";
        } else if (
            speciesKey === "beewasp" ||
            speciesKey === "bee" ||
            speciesKey === "wasp"
        ) {
            speciesKey = "beewasp";
        } else {
            speciesKey = "horse";
        }

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

        let speciesKey = species.toLowerCase();
        if (speciesKey === "horse") {
            speciesKey = "horse";
        } else if (
            speciesKey === "beewasp" ||
            speciesKey === "bee" ||
            speciesKey === "wasp"
        ) {
            speciesKey = "beewasp";
        } else {
            speciesKey = "horse";
        }

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
            let attribute = null;
            const effectStr = effect || "";

            // Attribute detection
            if (effectStr.includes("Intelligence")) attribute = "Intelligence";
            else if (effectStr.includes("Toughness")) attribute = "Toughness";
            else if (effectStr.includes("Friendliness"))
                attribute = "Friendliness";
            else if (effectStr.includes("Ruggedness")) attribute = "Ruggedness";
            else if (effectStr.includes("Ferocity")) attribute = "Ferocity";
            else if (effectStr.includes("Enthusiasm")) attribute = "Enthusiasm";
            else if (effectStr.includes("Virility")) attribute = "Virility";

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
                // Horse appearance categories
                if (appearance === "Scale (Kb)") {
                    appearanceCategory = "scale-kb";
                } else if (appearance === "Attributes (Kb)") {
                    appearanceCategory = "attributes-kb";
                } else if (appearance === "Selector (Sb)") {
                    appearanceCategory = "selector-sb";
                } else if (appearance === "Selector (Pt)") {
                    appearanceCategory = "selector-pt";
                } else if (appearance === "Selector (Po)") {
                    appearanceCategory = "selector-po";
                } else if (appearance === "Selector (Kb)") {
                    appearanceCategory = "selector-kb";
                } else if (appearance === "Selector (Bl)") {
                    appearanceCategory = "selector-bl";
                } else if (appearance === "Horn") {
                    appearanceCategory = "horn";
                } else if (appearance === "Horn (Kb)") {
                    appearanceCategory = "horn-kb";
                }
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
            if (dominantEffect.includes("Intelligence"))
                allPotentialAttributes.push("Intelligence");
            if (dominantEffect.includes("Toughness"))
                allPotentialAttributes.push("Toughness");
            if (dominantEffect.includes("Friendliness"))
                allPotentialAttributes.push("Friendliness");
            if (dominantEffect.includes("Ruggedness"))
                allPotentialAttributes.push("Ruggedness");
            if (dominantEffect.includes("Ferocity"))
                allPotentialAttributes.push("Ferocity");
            if (dominantEffect.includes("Enthusiasm"))
                allPotentialAttributes.push("Enthusiasm");
            if (dominantEffect.includes("Virility"))
                allPotentialAttributes.push("Virility");
        }

        if (
            recessiveEffect &&
            recessiveEffect !== "No gene data found" &&
            recessiveEffect !== "No recessive effect" &&
            recessiveEffect !== "Unknown gene type"
        ) {
            if (recessiveEffect.includes("Intelligence"))
                allPotentialAttributes.push("Intelligence");
            if (recessiveEffect.includes("Toughness"))
                allPotentialAttributes.push("Toughness");
            if (recessiveEffect.includes("Friendliness"))
                allPotentialAttributes.push("Friendliness");
            if (recessiveEffect.includes("Ruggedness"))
                allPotentialAttributes.push("Ruggedness");
            if (recessiveEffect.includes("Ferocity"))
                allPotentialAttributes.push("Ferocity");
            if (recessiveEffect.includes("Enthusiasm"))
                allPotentialAttributes.push("Enthusiasm");
            if (recessiveEffect.includes("Virility"))
                allPotentialAttributes.push("Virility");
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
            const pet = currentPet;
            const parsedGenes = parseGenes(pet.genes);

            if (!parsedGenes || Object.keys(parsedGenes).length === 0) {
                headerStructure = null;
                chromosomeData = [];
                return;
            }

            let totalGenesCount = 0;
            const allStats = await initializeStats();

            Object.values(parsedGenes).forEach((chromosomeData) => {
                chromosomeData.allGenes.forEach((gene) => {
                    const geneAnalysis = analyzeGeneEffect(
                        pet.species,
                        gene.id,
                        gene.type,
                    );
                    totalGenesCount++;
                    updateStats(allStats, geneAnalysis);
                });
            });

            currentStats = allStats;
            totalGenes = totalGenesCount;

            if (currentView === "attribute") {
                neutralGenes = allStats.neutral;
            } else {
                neutralGenes = allStats["appearance-neutral"];
            }

            // Prepare visualization data with pre-computed gene data
            const allBlocks = new Set();
            const blockMaxGenes = new Map();

            Object.values(parsedGenes).forEach((chromosomeData) => {
                chromosomeData.allGenes.forEach((gene) => {
                    allBlocks.add(gene.block);
                });
            });

            allBlocks.forEach((block) => {
                let maxGenesInBlock = 0;
                Object.values(parsedGenes).forEach((chromosomeData) => {
                    const genesInThisBlock = chromosomeData.allGenes.filter(
                        (g) => g.block === block,
                    ).length;
                    maxGenesInBlock = Math.max(
                        maxGenesInBlock,
                        genesInThisBlock,
                    );
                });
                blockMaxGenes.set(block, Math.max(1, maxGenesInBlock));
            });

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

            // Pre-compute all gene data with CSS classes - ALWAYS ensure processedBlocks exists
            chromosomeData = sortedChromosomes.map(([chromosome, data]) => {
                const processedBlocks = {};

                sortedBlocks.forEach((block) => {
                    const genesInBlock = data.allGenes.filter(
                        (g) => g.block === block,
                    );
                    processedBlocks[block] = [];

                    for (let i = 0; i < blockMaxGenes.get(block); i++) {
                        const gene = genesInBlock[i];
                        if (gene) {
                            const geneAnalysis = analyzeGeneEffect(
                                pet.species,
                                gene.id,
                                gene.type,
                            );

                            // Handle potential effects for neutral genes
                            let effectType = geneAnalysis.type;
                            if (
                                geneAnalysis.type === "neutral" &&
                                hasAnyPotentialEffect(pet.species, gene.id)
                            ) {
                                const potentialType =
                                    analyzePotentialEffectType(
                                        pet.species,
                                        gene.id,
                                    );
                                if (potentialType) {
                                    effectType = potentialType;
                                }
                            }

                            const processedGeneAnalysis = {
                                ...geneAnalysis,
                                type: effectType,
                            };

                            processedBlocks[block][i] = {
                                ...gene,
                                geneAnalysis: processedGeneAnalysis,
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

        const rect = detail.event.target.getBoundingClientRect();
        const containerRect = containerElement.getBoundingClientRect();
        tooltipX = rect.right - containerRect.left + 5;
        tooltipY = rect.top - containerRect.top - 5;

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

    function handleAttributeFilter(event) {
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
            case "scale":
                attributeGroups = [
                    "body-scale",
                    "wing-scale",
                    "head-scale",
                    "tail-scale",
                    "antenna-scale",
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
            console.log("🐾 Pet changed, loading:", pet.name, pet.id);
            lastProcessedPetId = pet.id;
            loadPetData();
        } else if (!pet && lastProcessedPetId !== null) {
            console.log("🐾 No pet selected, cleaning up");
            lastProcessedPetId = null;
            cleanup();
        }
    });

    // Export function for parent component
    export function handleViewChange(view) {
        currentView = view;
        updateVisualization();
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

                                {#each appearanceList as appearance}
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

                                <span
                                    class="legend-item appearance-legend-item {selectedAttributes.includes(
                                        'appearance-neutral',
                                    )
                                        ? 'selected'
                                        : ''} {hiddenAttributes.includes(
                                        'appearance-neutral',
                                    )
                                        ? 'hidden-effect'
                                        : ''}"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) =>
                                        handleLegendFilterClick(
                                            "appearance-neutral",
                                            e,
                                        )}
                                >
                                    <GeneCell
                                        gene={{ id: "sample", type: "D" }}
                                        geneAnalysis={{
                                            type: "appearance-neutral",
                                            attribute: "appearance-neutral",
                                        }}
                                        currentView="appearance"
                                        isVisible={true}
                                    />
                                    <span>Neutral</span>
                                </span>
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Gene Grid -->
                <div class="gene-grid-container">
                    {#if headerStructure && chromosomeData.length > 0}
                        <table class="gene-grid-table">
                            <thead class="gene-headers">
                                <tr>
                                    <th class="chromosome-header">Chr</th>
                                    {#each headerStructure.sortedBlocks as block}
                                        {#each Array.from({ length: headerStructure.blockMaxGenes.get(block) }, (_, i) => i) as i}
                                            <th
                                                class="position-header {i === 0
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
                                {#each chromosomeData as { chromosome, processedBlocks }}
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
                                        {#each headerStructure.sortedBlocks as block}
                                            {#each Array.from({ length: headerStructure.blockMaxGenes.get(block) }, (_, i) => i) as i}
                                                {@const gene =
                                                    processedBlocks?.[block]?.[
                                                        i
                                                    ] || null}
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
                    {/if}
                </div>
            </div>

            <!-- Stats section using existing component -->
            <GeneStatsTable
                {currentStats}
                {currentView}
                {selectedAttributes}
                {hiddenAttributes}
                {totalGenes}
                {neutralGenes}
                petSpecies={currentPet?.species}
                on:attributeFilter={handleAttributeFilter}
            />
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
    }

    .gene-visualizer {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: #ffffff;
        overflow: hidden;
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

    .visualizer-content {
        display: flex;
        flex: 1;
        overflow: hidden;
    }

    .gene-section {
        flex: 1;
        padding: 10px;
        border-right: 1px solid #e2e8f0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .gene-legend {
        margin-bottom: 20px;
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

    .legend-color {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 3px solid;
        flex-shrink: 0;
        display: inline-block;
    }

    .legend-color.gene-recessive {
        border-width: 4px;
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
        min-height: 300px;
        flex: 1;
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
        z-index: 1;
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
        z-index: 2;
        background: #f1f5f9;
        font-weight: bold;
        width: 32px;
        min-width: 32px;
        max-width: 32px;
    }

    .position-header {
        width: 23px;
        min-width: 23px;
        max-width: 23px;
        font-weight: normal;
    }

    .position-header.block-label {
        font-weight: bold;
    }

    .position-header.block-start {
        padding-left: 12px;
    }

    .position-header.block-start:first-of-type {
        padding-left: 8px;
    }

    .gene-rows {
        background: white;
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
        width: 23px;
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

    @media (max-width: 1200px) {
        .visualizer-content {
            flex-direction: column;
        }
    }
</style>
