// Pet Upload Manager - Handles drag & drop genome file uploads

class PetUploadManager {
  constructor() {
    this.isUploading = false; // Prevent duplicate uploads
    this.setupEventListeners();
  }

  initializeElements() {
    this.dropZone = document.getElementById("dropZone");
    this.fileInput = document.getElementById("fileInput");
    this.petNameInput = document.getElementById("petName");
    this.statusDiv = null; // Will be created dynamically

    // Only set up if elements exist (pet management tool is active)
    if (!this.dropZone || !this.fileInput || !this.petNameInput) {
      return false;
    }
    return true;
  }

  setupEventListeners() {
    // Only set up if elements were found
    if (!this.initializeElements()) {
      return;
    }

    // Drag and drop events
    this.dropZone.addEventListener("click", () => this.fileInput.click());
    this.dropZone.addEventListener("dragover", (e) => this.handleDragOver(e));
    this.dropZone.addEventListener("dragleave", (e) => this.handleDragLeave(e));
    this.dropZone.addEventListener("drop", (e) => this.handleDrop(e));

    // File input change
    this.fileInput.addEventListener("change", (e) => this.handleFileSelect(e));

    // Prevent default drag behaviors on document
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("drop", (e) => e.preventDefault());
  }
  handleDragOver(e) {
    e.preventDefault();
    this.dropZone.classList.add("drag-over");
  }

  handleDragLeave(e) {
    e.preventDefault();
    this.dropZone.classList.remove("drag-over");
  }

  handleDrop(e) {
    e.preventDefault();
    this.dropZone.classList.remove("drag-over");

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      this.processFile(files[0]);
    }
  }

  handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
      this.processFile(files[0]);
    }
  }

  async processFile(file) {
    // Prevent duplicate uploads
    if (this.isUploading) {
      this.showStatus("Upload already in progress...", "loading");
      return;
    }

    // Validate file type
    if (!file.name.endsWith(".txt")) {
      this.showStatus("Please select a .txt genome file", "error");
      return;
    }

    this.isUploading = true;

    // Get pet name from input (optional - server will use genome name if empty)
    const petName = this.petNameInput.value.trim();

    this.showStatus("Uploading pet genome...", "loading");

    try {
      // Upload file using FormData
      const formData = new FormData();
      formData.append("file", file);
      if (petName) {
        formData.append("name", petName);
      }

      const response = await fetch("/api/pets/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.status === "success") {
        this.showStatus(
          `✅ ${result.name || "Pet"} added to collection!`,
          "success",
        );
        this.clearForm();

        // Refresh pets list if appController is available
        if (
          window.appController &&
          typeof window.appController.loadPets === "function"
        ) {
          window.appController.loadPets();
        }
      } else {
        throw new Error(result.message || "Upload failed");
      }
    } catch (error) {
      console.error("Upload error:", error);

      // Handle specific duplicate file error
      if (error.message.includes("already been uploaded")) {
        this.showStatus(
          `⚠️ Duplicate file: ${error.message.split(": ")[1]}`,
          "error",
        );
      } else {
        this.showStatus(`❌ Upload failed: ${error.message}`, "error");
      }
    } finally {
      // Always reset upload state
      this.isUploading = false;
    }
  }

  showStatus(message, type = "loading") {
    // Remove existing status if any
    if (this.statusDiv) {
      this.statusDiv.remove();
    }

    // Create new status div
    this.statusDiv = document.createElement("div");
    this.statusDiv.className = `upload-status ${type}`;
    this.statusDiv.textContent = message;

    // Insert after the pet name input
    this.petNameInput.parentNode.appendChild(this.statusDiv);

    // Auto-remove success/error messages after 5 seconds
    if (type !== "loading") {
      setTimeout(() => {
        if (this.statusDiv) {
          this.statusDiv.remove();
          this.statusDiv = null;
        }
      }, 5000);
    }
  }

  clearForm() {
    this.petNameInput.value = "";
    this.fileInput.value = "";
  }
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.petUploadManager = new PetUploadManager();
});
