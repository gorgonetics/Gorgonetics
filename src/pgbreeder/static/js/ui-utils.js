/**
 * UI Utilities for PGBreeder web application.
 * Handles user feedback, loading states, and common UI operations.
 */

/**
 * Show a status message (success, error, loading, custom) in a target container.
 * type: "success" | "error" | "loading" | custom string
 * options: {
 *   container: HTMLElement (where to append, default: .container or body),
 *   after: HTMLElement (insert after this element, default: null),
 *   timeout: number (ms, auto-remove after this time, default: 3000 for success, 5000 for error, null for loading)
 * }
 * Returns the created status element.
 */
function showStatusMessage(message, type = "loading", options = {}) {
  // Remove existing status of same type in container
  const container =
    options.container || document.querySelector(".container") || document.body;
  const after = options.after || null;
  let timeout = options.timeout;
  if (timeout === undefined) {
    if (type === "success") timeout = 3000;
    else if (type === "error") timeout = 5000;
    else timeout = null;
  }
  // Remove previous status of same type in container
  container
    .querySelectorAll(`.status-message.${type}`)
    .forEach((el) => el.remove());

  const statusDiv = document.createElement("div");
  statusDiv.className = `status-message ${type}`;
  statusDiv.textContent = message;

  if (after && after.parentNode) {
    after.parentNode.insertBefore(statusDiv, after.nextSibling);
  } else {
    container.appendChild(statusDiv);
  }

  if (timeout) {
    window.setTimeout(() => {
      statusDiv.remove();
    }, timeout);
  }
  return statusDiv;
}

/**
 * Shared pet upload logic for use by both AppController and PetUploadManager.
 * Calls the provided callbacks for status updates and completion.
 *
 * @param {File} file - The file to upload
 * @param {string} petName - The pet name (optional)
 * @param {function} onStatus - (message, type) => void, called for status updates
 * @param {function} onSuccess - (result) => void, called on success
 * @param {function} onError - (error) => void, called on error
 */
// Removed unused function uploadPetFile

class UIUtils {
  /**
   * Show loading message in the genes container
   */
  static showLoading(message) {
    document.getElementById("genesContent").innerHTML =
      `<div class="loading">${message}</div>`;
    UIUtils.hideLegend();
  }

  /**
   * Show empty state message in the genes container
   */
  static showEmptyState(message) {
    document.getElementById("genesContent").innerHTML =
      `<div class="loading">${message}</div>`;
    UIUtils.hideLegend();
  }

  /**
   * Show the effect legend
   */
  static showLegend() {
    const legend = document.getElementById("effectLegend");
    if (legend) {
      legend.style.display = "block";
    }
  }

  /**
   * Hide the effect legend
   */
  static hideLegend() {
    const legend = document.getElementById("effectLegend");
    if (legend) {
      legend.style.display = "none";
    }
  }

  /**
   * Show error message to user
   */
  static showError(message) {
    showStatusMessage(message, "error", {
      container: document.querySelector(".container") || document.body,
      after: document.querySelector(".genes-container") || null,
      timeout: 5000,
    });
  }

  /**
   * Show success message to user
   */
  static showSuccess(message) {
    showStatusMessage(message, "success", {
      container: document.querySelector(".container"),
      after: document.querySelector(".genes-container"),
      timeout: 3000,
    });
  }

  /**
   * Enable/disable buttons based on state
   */
  static updateButtonStates(animalType, chromosome) {
    const loadBtn = document.getElementById("loadGenes");
    const exportChrBtn = document.getElementById("exportChromosome");
    const exportAllBtn = document.getElementById("exportAll");
    const chrSelect = document.getElementById("chromosome");

    if (animalType) {
      exportAllBtn.disabled = false;
      chrSelect.disabled = false;
    } else {
      chrSelect.disabled = true;
      exportAllBtn.disabled = true;
      exportChrBtn.disabled = true;
      loadBtn.disabled = true;
    }

    if (animalType && chromosome) {
      loadBtn.disabled = false;
      exportChrBtn.disabled = false;
    } else {
      loadBtn.disabled = true;
      exportChrBtn.disabled = true;
    }
  }

  /**
   * Populate select element with options
   */
  static populateSelect(
    selectId,
    options,
    valueKey = null,
    textKey = null,
    placeholder = "",
  ) {
    const select = document.getElementById(selectId);
    select.innerHTML = placeholder
      ? `<option value="">${placeholder}</option>`
      : "";

    options.forEach((option) => {
      const optionElement = document.createElement("option");
      optionElement.value = valueKey ? option[valueKey] : option;
      optionElement.textContent = textKey
        ? option[textKey]
        : typeof option === "string"
          ? option.charAt(0).toUpperCase() + option.slice(1)
          : option;
      select.appendChild(optionElement);
    });
  }

  /**
   * Create and trigger file download
   */
  static downloadFile(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }
  /**
   * Clear the gene display and hide legend
   */
  static clearGeneDisplay() {
    document.getElementById("genesContent").innerHTML = `
            <div class="loading">Select an animal type and chromosome to begin editing genes</div>
        `;
    UIUtils.hideLegend();
  }
}

// Export for use in other modules
window.UIUtils = UIUtils;
