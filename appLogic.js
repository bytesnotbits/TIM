// --- START OF FILE appLogic.js ---

// Check if required libraries are loaded
if (typeof Papa === 'undefined') {
    console.error("PapaParse library not found. Please include papaparse.min.js.");
    alert("Error: CSV library not loaded. CSV features will not work.");
}


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initializeApp().then(() => {
        setupEventListeners();
        console.log("App initialized and event listeners set up.");
    }).catch(error => {
        console.error("Caught initialization error at top level:", error);
        displayInitializationError("A critical error occurred during application startup. Some features might be unavailable. Please check the console for details.");
    });
});

// --- END OF FILE appLogic.js ---