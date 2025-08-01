/**
 * Export Manager for Gorgonetics web application.
 * Handles gene data export functionality.
 */

class ExportManager {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Export a specific chromosome to a JSON file
   */
  async exportChromosome() {
    const animalType = document.getElementById("animalType").value;
    const chromosome = document.getElementById("chromosome").value;

    if (!animalType || !chromosome) {
      window.UIUtils.showError(
        "Please select an animal type and chromosome first",
      );
      return;
    }

    try {
      const response = await this.apiClient.exportChromosome(
        animalType,
        chromosome,
      );
      const blob = await response.blob();
      const filename = `${animalType}_genes_chr${chromosome}.json`;

      window.UIUtils.downloadFile(blob, filename);
      window.UIUtils.showSuccess(
        `Chromosome ${chromosome} exported successfully!`,
      );
    } catch (error) {
      window.UIUtils.showError("Failed to export chromosome: " + error.message);
    }
  }

  /**
   * Export all chromosomes for the selected animal type
   */
  async exportAllChromosomes() {
    const animalType = document.getElementById("animalType").value;

    if (!animalType) {
      window.UIUtils.showError("Please select an animal type first");
      return;
    }

    try {
      window.UIUtils.showLoading("Exporting all chromosomes...");

      const result = await this.apiClient.exportAllChromosomes(animalType);
      window.UIUtils.showSuccess(
        `Exported ${result.files.length} chromosome files for ${animalType}!`,
      );

      // Reload current view if genes are displayed
      const currentChromosome = document.getElementById("chromosome").value;
      if (currentChromosome && window.appController) {
        window.appController.loadGenes(animalType, currentChromosome);
      }
    } catch (error) {
      window.UIUtils.showError(
        "Failed to export all chromosomes: " + error.message,
      );
    }
  }
}

// Export for use in other modules
window.ExportManager = ExportManager;
