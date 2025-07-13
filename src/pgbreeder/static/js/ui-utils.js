/**
 * UI Utilities for PGBreeder web application.
 * Handles user feedback, loading states, and common UI operations.
 */

class UIUtils {
    /**
     * Show loading message in the genes container
     */
    static showLoading(message) {
        document.getElementById('genesContent').innerHTML = `<div class="loading">${message}</div>`;
    }

    /**
     * Show error message to user
     */
    static showError(message) {
        const existing = document.querySelector('.error');
        if (existing) existing.remove();

        const error = document.createElement('div');
        error.className = 'error';
        error.textContent = message;
        document.querySelector('.container').insertBefore(error, document.querySelector('.genes-container'));

        setTimeout(() => error.remove(), 5000);
    }

    /**
     * Show success message to user
     */
    static showSuccess(message) {
        const existing = document.querySelector('.success');
        if (existing) existing.remove();

        const success = document.createElement('div');
        success.className = 'success';
        success.textContent = message;
        document.querySelector('.container').insertBefore(success, document.querySelector('.genes-container'));

        setTimeout(() => success.remove(), 3000);
    }

    /**
     * Enable/disable buttons based on state
     */
    static updateButtonStates(animalType, chromosome) {
        const loadBtn = document.getElementById('loadGenes');
        const exportChrBtn = document.getElementById('exportChromosome');
        const exportAllBtn = document.getElementById('exportAll');
        const chrSelect = document.getElementById('chromosome');

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
    static populateSelect(selectId, options, valueKey = null, textKey = null, placeholder = '') {
        const select = document.getElementById(selectId);
        select.innerHTML = placeholder ? `<option value="">${placeholder}</option>` : '';

        options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = valueKey ? option[valueKey] : option;
            optionElement.textContent = textKey ? option[textKey] : (typeof option === 'string' ? option.charAt(0).toUpperCase() + option.slice(1) : option);
            select.appendChild(optionElement);
        });
    }

    /**
     * Create and trigger file download
     */
    static downloadFile(blob, filename) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }
}

// Export for use in other modules
window.UIUtils = UIUtils;
