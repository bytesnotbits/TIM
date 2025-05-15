// --- Filter UI Update ---
// --- Helper to update UI filter controls ---
function updateFilterControlsUI() {
    const locationInput = document.getElementById('locationFilterInput');
    const statusSelect = document.getElementById('statusFilterSelect');
    const searchInput = document.getElementById('searchInput');

    if (locationInput) locationInput.value = currentFilters.location || '';
    if (statusSelect) statusSelect.value = currentFilters.status || 'all'; // Default to 'all' if status isn't set
    if (searchInput) searchInput.value = currentFilters.searchTerm || '';
} // --- End of Filter UI Update ---

// --- Helper function to apply default values or migrate data structures ---
// (Needs access to DB.generateSimpleId from offlineDB.js)
function applyDataDefaults(inventoryItems) {
    if (!Array.isArray(inventoryItems)) {
        console.error("applyDataDefaults received non-array:", inventoryItems);
        return []; // Return empty array to avoid downstream errors
    }
    inventoryItems.forEach(item => {
        if (!item || typeof item !== 'object') return; // Skip invalid items

        // --- Unique Item ID ---
        item.itemId = item.itemId ?? DB.generateSimpleId(); // Ensure every item has a persistent ID

        // --- Core Count Fields ---
        item.counted = item.counted ?? null;
        if (item.isUncounted === undefined || item.isUncounted === null) {
            item.isUncounted = (item.counted === null);
        }

        // --- Cable Footage Fields ---
        item.isReel = item.isReel ?? false; // Default to not a reel
        item.reelNumber = item.reelNumber ?? ''; // NEW: Reel number identifier
        item.isTwoWayReel = item.isReel && (item.isTwoWayReel ?? false); // Can only be two-way if it's a reel
        item.innerSequence = item.innerSequence ?? '';
        item.outerSequence = item.outerSequence ?? '';
        item.innerSequence2 = item.innerSequence2 ?? '';
        item.outerSequence2 = item.outerSequence2 ?? '';
        item.calculatedFootage = item.calculatedFootage ?? null;
        item.footageFactor = item.footageFactor ?? null;

        // --- Metadata & Status ---
        item.notes = item.notes ?? ''; // Default notes to empty string
        item.isActive = item.isActive ?? true; // Default to active
        item.lastCountTimestamp = item.lastCountTimestamp ?? null;
        item.capturedQuantity = item.capturedQuantity ?? null; // Expected quantity (optional)
        item.toCount = item.toCount ?? false; // NEW: Flag for current count cycle, default false
        // --- NEW: Recount Tracking ---
        item.currentRecountBatchId = item.currentRecountBatchId ?? null; // Track which recount batch item belongs to (if any)

        // --- Basic Info ---
        item.SKU = item.SKU ?? 'UNKNOWN_SKU';
        item.Description = item.Description ?? 'No Description';
        item.location = item.location ?? 'No Location';
    });
    console.log("Applied data defaults (including toCount, reelNumber, currentRecountBatchId) to inventory items.");
    return inventoryItems; // Return the processed array
} // end of applyDataDefaults

// --- Helper function to generate Cycle ID ---
/**
 * Generates a cycle ID in YYYY.Q format from a date string.
 * @param {string} dateString - Date string in YYYY-MM-DD format.
 * @returns {string|null} Cycle ID (e.g., "2024.3") or null if date is invalid.
 */
function getCycleIdFromDate(dateString) {
    try {
        // Basic validation - ensure it looks like YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            throw new Error("Invalid date format. Use YYYY-MM-DD.");
        }
        const date = new Date(dateString + 'T00:00:00Z'); // Use UTC to avoid timezone shifts affecting date/quarter
        if (isNaN(date.getTime())) {
            throw new Error("Invalid date value.");
        }
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth(); // 0-11
        const quarter = Math.floor(month / 3) + 1; // Calculate quarter (1-4)
        return `${year}.${quarter}`;
    } catch (error) {
        console.error("Error generating cycle ID:", error.message);
        alert(`Error with Cut-off Date: ${error.message}`);
        return null;
    }
}

// --- Core Data Access ---
// (Needs access to database state from stateManager.js)
// Finds a specific item-location record by its unique ID
async function findInventoryItemByItemId(itemId) {
    if (!itemId) {
        console.warn("findInventoryItemByItemId called with null or undefined itemId.");
        return null;
    }
    // In-memory find is usually sufficient as 'database.inventory' should be up-to-date
    const item = database.inventory.find(item => item.itemId === itemId);
    // Add a check against DB only if necessary or for debugging staleness issues
    // if (!item) { console.warn(`Item ${itemId} not in memory. Checking DB...`); /* DB lookup? */ }
    return item || null;
} // end of findInventoryItemByItemId

// Finds all item-location records for a given SKU (less common now with itemId)
function findInventoryItemsBySKU(sku) {
    if (sku === null || sku === undefined) {
        console.warn("findInventoryItemsBySKU called with null or undefined SKU.");
        return [];
    }
    const searchSKU = String(sku).trim();
     if (!searchSKU) {
        console.warn("findInventoryItemsBySKU called with empty SKU.");
        return [];
    }
    return database.inventory.filter(item => String(item.SKU).trim() === searchSKU);
} // end of findInventoryItemsBySKU

// Finds a specific item by non-reel SKU + location combo OR by reel number
// Used primarily during CSV import to match incoming rows to existing DB records.
function findExistingItemRecord(sku, location = null, reelNumber = null) {
    if (!sku) return null;
    const searchSKU = String(sku).trim();
    const searchLoc = location ? String(location).trim().toLowerCase() : null;
    const searchReel = reelNumber ? String(reelNumber).trim() : null;

    if (searchReel) {
        // Reels are uniquely identified by reelNumber (assumption)
        const found = database.inventory.find(item => item.isReel && item.reelNumber === searchReel);
        // console.log(`findExistingItemRecord (Reel: ${searchReel}): Found?`, !!found);
        return found;
    } else if (searchLoc) {
        // Non-reels are unique by SKU + Location
        const found = database.inventory.find(item =>
            !item.isReel && // Important: only match non-reels this way
            String(item.SKU).trim() === searchSKU &&
            String(item.location).trim().toLowerCase() === searchLoc
        );
        // console.log(`findExistingItemRecord (SKU: ${searchSKU}, Loc: ${searchLoc}): Found?`, !!found);
        return found;
    } else {
         console.warn(`findExistingItemRecord called for SKU ${searchSKU} without location or reelNumber. Cannot reliably find unique item.`);
         return null; // Cannot reliably find a unique non-reel without location
    }
} // end of findExistingItemRecord

// --- Filtering Logic ---
// (Needs access to database and currentFilters state from stateManager.js)
// (Needs access to renderInventoryList and updateSummaryCards from uiRenderer.js)
function applyCurrentFilters() {
    try {
        console.log("Applying filters:", currentFilters);

        // --- Primary Filtering (Location, Status, ToCountStatus) ---
        let filteredInventory = database.inventory.filter(item => {
            // Location Filter
            const locationMatch = !currentFilters.location || (item.location && item.location.toLowerCase().includes(currentFilters.location));

            // Status Filter (isActive property)
            const statusMatch = currentFilters.status === 'all' ||
                                (currentFilters.status === 'active' && item.isActive) ||
                                (currentFilters.status === 'inactive' && !item.isActive);

            // ToCount Filter (based on filterByToCountStatus)
            let toCountMatch = false;
            switch (currentFilters.filterByToCountStatus) {
                case 'all':
                    toCountMatch = true; // Show all regardless of toCount flag
                    break;
                case 'counted': // Show 'finished' items (toCount is false)
                    toCountMatch = item.toCount === false;
                    break;
                case 'to_count': // Show items marked 'to count' (toCount is true) - default
                default:
                    toCountMatch = item.toCount === true;
                    break;
            }

            return locationMatch && statusMatch && toCountMatch;
        });

        // --- Secondary Filtering (Search Term) ---
        if (currentFilters.searchTerm) {
            const searchTermLower = currentFilters.searchTerm.toLowerCase();
            filteredInventory = filteredInventory.filter(item => {
                const skuMatch = item.SKU && item.SKU.toLowerCase().includes(searchTermLower);
                const descMatch = item.Description && item.Description.toLowerCase().includes(searchTermLower);
                const reelNumMatch = item.reelNumber && item.reelNumber.toLowerCase().includes(searchTermLower);
                // Add itemId match?
                const itemIdMatch = item.itemId && item.itemId.toLowerCase().includes(searchTermLower);
                return skuMatch || descMatch || reelNumMatch || itemIdMatch;
            });
            console.log(`Applied search term "${currentFilters.searchTerm}", ${filteredInventory.length} items remain.`);
        }

        // Assign to currentInventory and sort
        currentInventory = filteredInventory;
        currentInventory.sort((a, b) => {
            // Primary sort by location, secondary by SKU
             const locA = a.location || '';
             const locB = b.location || '';
             const skuA = a.SKU || '';
             const skuB = b.SKU || '';
             if (locA < locB) return -1;
             if (locA > locB) return 1;
             // Locations are same, sort by SKU
             if (skuA < skuB) return -1;
             if (skuA > skuB) return 1;
             return 0;
        });

        // Re-render the list
        renderInventoryList();
        // Summary cards are updated separately, often after data changes,
        // but maybe call it here too for consistency after filtering?
        // updateSummaryCards(); // Let's keep this where data actually changes.

    } catch (error) {
        console.error("Error applying filters:", error);
        currentInventory = []; // Fallback to empty on error
        renderInventoryList(); // Render the empty state or error message
    }
} // end of applyCurrentFilters

function clearAllFilters() {
    // Reset filter state to defaults
    currentFilters.location = null;
    currentFilters.status = 'active'; // Default status
    currentFilters.searchTerm = '';
    currentFilters.filterByToCountStatus = 'to_count'; // Default count status view

    // Update UI elements to reflect cleared state
    updateFilterControlsUI();

    // Re-apply default filters and render
    applyCurrentFilters();
} // end of clearAllFilters

// --- NEW Helper to update UI filter controls ---
// (Moved here as it directly manipulates UI based on filter state)
function updateFilterControlsUI() {
    const locationInput = document.getElementById('locationFilterInput');
    const statusSelect = document.getElementById('statusFilterSelect');
    const searchInput = document.getElementById('searchInput');

    if (locationInput) locationInput.value = currentFilters.location || '';
    if (statusSelect) statusSelect.value = currentFilters.status || 'all';
    if (searchInput) searchInput.value = currentFilters.searchTerm || '';
} // end of updateFilterControlsUI

// --- Apply filters from UI interactions ---
// --- Reads UI and calls core filter logic ---
function applyCurrentFiltersFromUI() {
    // Read values from UI elements and update currentFilters state
    const locationInput = document.getElementById('locationFilterInput');
    console.log("locationFilterInput element:", locationInput);
    const statusSelect = document.getElementById('statusFilterSelect');
    console.log("statusFilterSelect element:", statusSelect);
    const searchInput = document.getElementById('searchInput');
    console.log("searchInput element:", searchInput);

    currentFilters.location = locationInput ? locationInput.value.trim().toLowerCase() : null;
    currentFilters.status = statusSelect ? statusSelect.value : 'active';
    currentFilters.searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    // When applying manual filters (location, status, search), generally reset the
    // view to the 'items to count' within that filter scope. If the user wants
    // 'finished' items within that scope, they'd use the card click first, then filter.
    // Exception: If 'All' status is selected, show all items (finished or not).
    if (currentFilters.status === 'all') {
        currentFilters.filterByToCountStatus = 'all';
    } else {
        currentFilters.filterByToCountStatus = 'to_count';
    }

    console.log("Applying filters from UI:", currentFilters);
    applyCurrentFilters(); // Call the core filter logic function
} // End applyFiltersFromUI

// Records the physical count OR updates count via adjustment, logs, saves
async function recordOrUpdateCount(itemId, newQuantity, source, details = {}) {
    // source: 'manual_count', 'sequence_calc', 'recount_adjustment', 'import_update'
    // details: object containing relevant info like old value, notes, adjustmentTxId, etc.
    if (itemId === null || itemId === undefined) {
        console.error("recordOrUpdateCount: itemId is missing.");
        return null;
    }
    if (newQuantity === null || newQuantity === undefined || typeof newQuantity !== 'number' || isNaN(newQuantity) || newQuantity < 0) {
        console.error(`recordOrUpdateCount: Invalid newQuantity (${newQuantity}) for itemId ${itemId}.`);
        return null; // Reject invalid quantity
    }

    try {
        const item = await findInventoryItemByItemId(itemId);
        if (!item) {
            console.error(`Item with itemId ${itemId} not found for recording count.`);
            return null;
        }
        // Don't allow updates on inactive items (except potentially reactivation?)
        if (!item.isActive) {
            console.warn(`Attempted to update count for inactive item ${itemId} (SKU: ${item.SKU}, Loc: ${item.location}).`);
            return null;
        }
        // Don't allow direct count updates on items finished for the cycle (use adjustments or new cycle)
         if (!item.toCount && source !== 'recount_adjustment') {
             console.warn(`Attempted to update count for finished item ${itemId} (source: ${source}). Use adjustment or start new cycle.`);
             // Optionally provide feedback to user?
             // alert(`Item ${item.SKU} at ${item.location} is already finished for this cycle. Count not updated.`);
             return null;
         }


        const previousCount = item.counted;
        const previousFlag = item.isUncounted;
        const isCurrentlyRecount = item.currentRecountBatchId !== null;

        // No change needed if quantity is identical AND state isn't changing from uncounted
        if (previousCount === newQuantity && previousFlag === false && source !== 'recount_adjustment') {
            // Still allow recount adjustments even if quantity doesn't change overall count
            console.log(`Count for ${itemId} is already ${newQuantity}. No change recorded (source: ${source}).`);
            return item; // Return the item, but indicate no change was made
        }

        // Update item state
        item.counted = newQuantity;
        item.isUncounted = false; // Explicitly has a count value now
        item.lastCountTimestamp = new Date().toISOString();
        // If the update source was sequence calculation, store that result
        if (source === 'sequence_calc') {
            item.calculatedFootage = newQuantity;
        } else if (source !== 'recount_adjustment') {
            // Clear calculated footage if manually counted or imported without sequences
            item.calculatedFootage = null;
        }

        // Log the transaction
        const logEntry = {
            type: 'update_count', // Default type
            itemId: item.itemId,
            SKU: item.SKU,
            location: item.location,
            user: getUserIdentifier(),
            timestamp: item.lastCountTimestamp,
            details: {
                source: source,
                oldValue: previousCount,
                newValue: newQuantity,
                wasUncounted: previousFlag,
                ...details // Add any source-specific details
            }
        };

        // Adjust log type if it's part of a recount
        if (isCurrentlyRecount) {
            logEntry.type = source === 'recount_adjustment' ? 'recount_adjustment_update' : 'recount_physical_update';
            logEntry.details.recountBatchId = item.currentRecountBatchId;
        }

        try {
            await logTransaction(logEntry); // Use the unified logging function
            console.log(`Recorded count change for ${item.itemId} (SKU: ${item.SKU}, Loc: ${item.location}): ${previousCount} -> ${newQuantity}. Source: ${source}`);
        } catch (logError) {
            console.error(`Failed to log transaction for ${item.itemId}:`, logError);
            // Continue with auto-save even if logging fails? Yes, state is updated.
        }

        // Trigger autosave (no need to await here unless critical)
        autoSave().catch(e => console.error("Autosave failed after recording count:", e));

        return item; // Return the updated item object

    } catch (error) {
        console.error(`Error in recordOrUpdateCount for itemId ${itemId}:`, error);
        return null;
    }
} // end of recordOrUpdateCount

// Flags an item-location as uncounted
async function flagUncounted(itemId) {
    if (!itemId) { console.error("flagUncounted: itemId is missing."); return; }
    try {
        const item = await findInventoryItemByItemId(itemId);
        if (!item) { console.error(`Item ${itemId} not found for flagging.`); return; }
        if (!item.isActive) { console.warn(`Attempted to flag inactive item ${itemId}.`); return; }
        // Cannot flag if not marked 'toCount'
        if (!item.toCount) { console.warn(`Attempted to flag finished item ${itemId}.`); return; }
        if (item.isUncounted === true && item.counted === null) { console.log(`Item ${itemId} already flagged.`); return; } // No change needed

        const previousState = { counted: item.counted, isUncounted: item.isUncounted };
        const timestamp = new Date().toISOString();

        item.isUncounted = true;
        item.counted = null;
        item.lastCountTimestamp = timestamp;
        // Clear sequences/calculated footage when flagged
        item.innerSequence = ''; item.outerSequence = '';
        item.innerSequence2 = ''; item.outerSequence2 = '';
        item.calculatedFootage = null;

        // Log transaction
        const logEntry = {
            type: 'flag_uncounted',
            itemId: item.itemId,
            SKU: item.SKU,
            location: item.location,
            user: getUserIdentifier(),
            timestamp: timestamp,
            details: { previousState: previousState }
        };
        // Add recount info if applicable
        if (item.currentRecountBatchId) {
            logEntry.type = 'recount_flag_uncounted';
            logEntry.details.recountBatchId = item.currentRecountBatchId;
        }

        try {
            await logTransaction(logEntry); // Use unified logging
            console.log(`Flagged ${item.itemId} (SKU: ${item.SKU}, Loc: ${item.location}) as uncounted.`);
        } catch (logError) {
             console.error(`Failed to log flag_uncounted for ${item.itemId}:`, logError);
        }

        // Trigger UI update and save
        autoSave().catch(e => console.error("Autosave failed after flagging:", e));
        applyCurrentFilters(); // Re-apply filters which triggers re-render
        updateSummaryCards(); // Update summary

    } catch (error) {
        console.error(`Error in flagUncounted for itemId ${itemId}:`, error);
        alert(`Failed to flag item ${item?.SKU || itemId}. See console.`);
    }
} // end of flagUncounted

// updateCount calls recordOrUpdateCount and UI updates
async function updateCount(itemId, quantityStr) {
    const quantity = Number(quantityStr);
    if (isNaN(quantity) || quantity < 0) {
        alert("Invalid quantity entered. Please enter a non-negative number.");
        const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
        const inputElement = itemDiv?.querySelector('input[data-type="count-input"]');
        if (inputElement) {
            findInventoryItemByItemId(itemId).then(item => { // findInventoryItemByItemId is already async
                if (item) inputElement.value = (item.counted === null || item.counted === undefined) ? '' : item.counted;
            });
        }
        return;
    }

    // recordOrUpdateCount ALREADY DOES NOT CHANGE item.toCount for 'manual_count'
    const updatedItem = await recordOrUpdateCount(itemId, quantity, 'manual_count');

    if (updatedItem) {
        // DO NOT call applyCurrentFilters() here. The item should remain visible.
        // Its visual state (e.g. color, if we add it) might change, but not its presence in "to_count".
        if (typeof updateSummaryCards === 'function') {
            updateSummaryCards();
        } else {
            console.error("updateSummaryCards function not found after count update.");
        }
        // autoSave is in stateManager.js
        autoSave().catch(e => console.error("Autosave failed after updating count:", e));
        console.log(`Count updated for ${itemId} to ${quantity} (manual_count), item remains 'toCount=${updatedItem.toCount}'. Background save triggered.`);
    } else {
        console.warn(`Update count for ${itemId} did not result in a saved change or was disallowed.`);
         const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
         const inputElement = itemDiv?.querySelector('input[data-type="count-input"]');
         if (inputElement) {
            findInventoryItemByItemId(itemId).then(item => { // findInventoryItemByItemId is already async
                 if (item) inputElement.value = (item.counted === null || item.counted === undefined) ? '' : item.counted;
            });
         }
    }
} // end of updateCount

// Calculate footage
function calculateFootageForItem(item, sequences) {
    // sequences = { inner1, outer1, inner2, outer2 }
    console.log(`[calculateFootageForItem] Called for itemId: ${item?.itemId}, sequences:`, sequences); // Log entry

    if (!item || !item.isReel) {
        console.log(`[calculateFootageForItem] Not a reel or item missing.`);
        return null; // Not a reel
    }

    let anyInputEntered = false;
    let errorPresent = false;

    // Helper to parse, treating blank as 0, checking for validity
    const parseSequence = (valueStr) => {
        const trimmedStr = String(valueStr || '').trim(); // Ensure it's a string and trim

        if (trimmedStr === '') {
            return 0; // Treat blank as 0
        }

        anyInputEntered = true; // Mark that at least one field has content

        const num = Number(trimmedStr);

        if (isNaN(num) || num < 0) {
             console.warn(`[calculateFootageForItem] Invalid sequence value detected: '${trimmedStr}' for itemId ${item.itemId}`);
             errorPresent = true;
             return null; // Return null to indicate error for this value
        }
        return num; // Return the valid, non-negative number
    };

    // Parse all sequence values
    const parsed_inner1 = parseSequence(sequences.inner1);
    const parsed_outer1 = parseSequence(sequences.outer1);
    const parsed_inner2 = parseSequence(sequences.inner2);
    const parsed_outer2 = parseSequence(sequences.outer2);

    // If any invalid non-blank value was entered, calculation is invalid
    if (errorPresent) {
         console.log(`[calculateFootageForItem] Invalid input detected. Returning null.`);
         return null;
    }

    // If no fields had any input, return null (no calculation needed/possible)
    if (!anyInputEntered) {
         console.log(`[calculateFootageForItem] No sequences entered. Returning null.`);
         return null;
    }

    // Calculate difference for pair 1
    const diff1 = Math.abs(parsed_outer1 - parsed_inner1);
    console.log(`[calculateFootageForItem] Pair 1: inner=${parsed_inner1}, outer=${parsed_outer1}, diff1=${diff1}`);

    // Calculate difference for pair 2 (only if two-way reel)
    let diff2 = 0;
    if (item.isTwoWayReel) {
        diff2 = Math.abs(parsed_outer2 - parsed_inner2);
        console.log(`[calculateFootageForItem] Pair 2 (Two-Way): inner=${parsed_inner2}, outer=${parsed_outer2}, diff2=${diff2}`);
    } else {
        console.log(`[calculateFootageForItem] Not a two-way reel, diff2=0.`);
    }

    // Calculate total quantity
    const totalQty = diff1 + diff2;
    console.log(`[calculateFootageForItem] Calculated Total Qty: ${totalQty}`);

    // Return the calculated total quantity (which might be 0 if differences cancel out or inputs were 0)
    return totalQty;

} // end of calculateFootageForItem

// Update sequences and potentially the count
async function updateSequences(itemId) {
    if (!itemId) { console.error("updateSequences: itemId missing"); return; }
    console.log(`[updateSequences] Triggered for itemId: ${itemId}`); // Add entry log
    let item = null; // Define item variable in the outer scope

    try {
        item = await findInventoryItemByItemId(itemId); // Assign to outer scope variable
        if (!item || !item.isActive || !item.toCount) {
             console.warn(`Cannot update sequences: Item ${itemId} not found, inactive, or already finished.`);
             // Visually reset inputs if needed, without full re-render
             const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
             if (itemDiv && item) {
                 itemDiv.querySelector('input[data-sequence="inner"]').value = item.toCount ? '' : item.innerSequence ?? '';
                 itemDiv.querySelector('input[data-sequence="outer"]').value = item.toCount ? '' : item.outerSequence ?? '';
                 if (item.isTwoWayReel) {
                     itemDiv.querySelector('input[data-sequence="inner2"]').value = item.toCount ? '' : item.innerSequence2 ?? '';
                     itemDiv.querySelector('input[data-sequence="outer2"]').value = item.toCount ? '' : item.outerSequence2 ?? '';
                 }
             }
            return;
        }

        const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
        if (!itemDiv) {
             console.error(`Could not find item div for itemId ${itemId} to read/update sequence inputs.`);
             return;
        }

         // Get sequence values directly from the inputs
         const sequenceValues = {
            inner1: itemDiv.querySelector('input[data-sequence="inner"]')?.value ?? '',
            outer1: itemDiv.querySelector('input[data-sequence="outer"]')?.value ?? '',
            inner2: itemDiv.querySelector('input[data-sequence="inner2"]')?.value ?? '',
            outer2: itemDiv.querySelector('input[data-sequence="outer2"]')?.value ?? '',
         };
         console.log(`[updateSequences] Read sequence values from inputs:`, sequenceValues);

        // Store raw input values in the item model
        item.innerSequence = sequenceValues.inner1;
        item.outerSequence = sequenceValues.outer1;
        if (item.isTwoWayReel) {
            item.innerSequence2 = sequenceValues.inner2;
            item.outerSequence2 = sequenceValues.outer2;
        } else {
            item.innerSequence2 = ''; item.outerSequence2 = '';
        }

        // Calculate footage based on the updated sequences
        const calculatedFootage = calculateFootageForItem(item, sequenceValues);
        item.calculatedFootage = calculatedFootage; // Update model's calculation result
        console.log(`[updateSequences] Calculated footage: ${calculatedFootage}`);

        let countUpdated = false;
        // Update the main count only if calculation is valid
        if (calculatedFootage !== null) {
            console.log(`[updateSequences] Valid calculation. Calling recordOrUpdateCount with ${calculatedFootage}`);
            const updatedItemResult = await recordOrUpdateCount(itemId, calculatedFootage, 'sequence_calc', {
                 sequences: sequenceValues // Log the sequences used
            });
            if (updatedItemResult) {
                countUpdated = true;
                console.log(`[updateSequences] recordOrUpdateCount successful. Item count updated in model to ${calculatedFootage}.`);
            } else {
                 console.warn(`[updateSequences] Sequence calculation successful, but recordOrUpdateCount failed or was disallowed (e.g., item finished).`);
            }
        } else {
            console.log(`[updateSequences] Calculation invalid or incomplete. Saving sequence data only.`);
            // Leave main 'counted' field as is. User must explicitly flag or enter 0.
        }

        // ***** MODIFIED: Direct DOM Manipulation *****
        const countInput = itemDiv.querySelector('input[data-type="count-input"]');
        const totalFootageDisplay = itemDiv.querySelector('.calculated-footage-display.total-footage');

        if (countInput && totalFootageDisplay) {
            console.log(`[updateSequences] Updating DOM elements directly...`);
            if (calculatedFootage !== null) {
                // --- Update count input value and disable it ---
                console.log(`[updateSequences] Setting countInput value to ${calculatedFootage} and disabling.`);
                countInput.value = calculatedFootage; // ***** KEY FIX: Ensure this updates visually *****
                countInput.disabled = true; // Disable manual count when calculated
                countInput.readOnly = false; // Ensure not readonly if it became valid calc
                countInput.title = "Quantity calculated from footage";

                // --- Update footage display span ---
                totalFootageDisplay.textContent = `Total: ${calculatedFootage.toFixed(2)} ft`;
                totalFootageDisplay.style.color = '';
                totalFootageDisplay.title = '';
            } else {
                // --- Calculation invalid or no valid sequences entered ---
                // Re-enable count input if it was disabled *by calculation*
                const allowManualInput = item.isActive && item.toCount;
                console.log(`[updateSequences] Invalid calculation. Setting countInput disabled: ${!allowManualInput}`);
                countInput.disabled = !allowManualInput;
                countInput.readOnly = !allowManualInput; // Readonly if finished/inactive
                countInput.title = allowManualInput ? "Enter current count" : (item.isActive ? "Item finished for this cycle (view only)" : "Item is inactive");

                // --- Update footage display span to show invalid state ---
                const hasPartialSequenceInput = sequenceValues.inner1 || sequenceValues.outer1 || (item.isTwoWayReel && (sequenceValues.inner2 || sequenceValues.outer2));
                 if (hasPartialSequenceInput) {
                    totalFootageDisplay.textContent = 'Total: Invalid';
                    totalFootageDisplay.style.color = 'var(--danger-color)';
                    totalFootageDisplay.title = 'Incomplete or invalid sequence values entered.';
                 } else {
                    totalFootageDisplay.textContent = 'Total: ---';
                    totalFootageDisplay.style.color = '';
                    totalFootageDisplay.title = '';
                 }
                 // Leave the countInput.value as it was (user must explicitly clear/flag)
            }
            console.log(`[updateSequences] DOM updates applied for count input and footage display.`);
        } else {
             console.error(`[updateSequences] Could not find count input or footage display for item ${itemId} during DOM update.`);
        }
        // ***** END: Direct DOM Manipulation *****

        // Trigger autosave regardless (saves sequence changes even if count didn't update)
        autoSave().catch(e => console.error("Autosave failed after updating sequences:", e));
        console.log(`[updateSequences] Sequences updated for ${itemId}, background save triggered.`);

        // No full re-render needed. Update summary cards as count might have changed.
        updateSummaryCards();

    } catch (error) {
        console.error(`Error updating sequences for itemId ${itemId}:`, error);
        alert(`Failed to update sequences for ${item?.SKU || itemId}. See console.`);
        // Attempt to reset sequence inputs visually on error without full re-render
         const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
         if (itemDiv && item) {
             itemDiv.querySelector('input[data-sequence="inner"]').value = item.toCount ? '' : item.innerSequence ?? '';
             itemDiv.querySelector('input[data-sequence="outer"]').value = item.toCount ? '' : item.outerSequence ?? '';
             if (item.isTwoWayReel) {
                 itemDiv.querySelector('input[data-sequence="inner2"]').value = item.toCount ? '' : item.innerSequence2 ?? '';
                 itemDiv.querySelector('input[data-sequence="outer2"]').value = item.toCount ? '' : item.outerSequence2 ?? '';
             }
            // Also reset calculated display and count input state based on last known *good* state (item object)
             const countInput = itemDiv.querySelector('input[data-type="count-input"]');
             const totalFootageDisplay = itemDiv.querySelector('.calculated-footage-display.total-footage');
             if (countInput) {
                  // Reset count input based on item's last known state
                 countInput.value = item.toCount ? '' : (item.counted === null || item.counted === undefined) ? '' : item.counted;
                 const isCalculated = item.isReel && item.footageFactor > 0 && item.calculatedFootage !== null;
                 countInput.disabled = !item.isActive || isCalculated;
                 countInput.readOnly = !item.isActive || !item.toCount;
                 countInput.title = !item.isActive ? "Item is inactive" : isCalculated ? "Quantity calculated from footage" : !item.toCount ? "Item finished for cycle (view only)" : "Enter current count";
             }
             if (totalFootageDisplay) {
                 totalFootageDisplay.textContent = (item.calculatedFootage !== null) ? `Total: ${item.calculatedFootage.toFixed(2)} ft` : 'Total: ---';
                 totalFootageDisplay.style.color = '';
                 totalFootageDisplay.title = '';
             }
         }
    }
} // end of updateSequences

// Update item notes
async function updateItemNotes(itemId, notes) {
    if (!itemId) { console.error("updateItemNotes: itemId missing"); return; }
    try {
        const item = await findInventoryItemByItemId(itemId);
        // Allow updating notes even if inactive? Yes. But not if finished? Yes.
        // Allow notes update even if finished for the cycle.
        if (!item /*|| !item.isActive || !item.toCount*/) { // Removed checks preventing notes on finished/inactive items
             console.warn(`Cannot update notes: Item ${itemId} not found.`);
             // Re-render to reset textarea if needed? No, avoid re-render.
             // applyCurrentFilters(); // ***** REMOVED *****
             // Reset textarea manually if needed
             const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
             const textarea = itemDiv?.querySelector('textarea[data-type="notes-input"]');
             if(textarea && item) textarea.value = item.notes ?? ''; // Reset to DB value
            return;
        }

        if (item.notes !== notes) {
            const oldNotes = item.notes;
            item.notes = notes;
            const timestamp = new Date().toISOString();

            // Log the note change
            const logEntry = {
                type: 'update_notes',
                itemId: item.itemId,
                SKU: item.SKU,
                location: item.location,
                user: getUserIdentifier(),
                timestamp: timestamp,
                details: {
                    oldValue: oldNotes,
                    newValue: notes
                }
            };
            if (item.currentRecountBatchId) {
                logEntry.type = 'recount_update_notes';
                logEntry.details.recountBatchId = item.currentRecountBatchId;
            }

            try {
                await logTransaction(logEntry); // Use unified logging
                console.log(`Updated notes for ${itemId} (SKU: ${item.SKU}, Loc: ${item.location})`);
            } catch (logError) {
                 console.error(`Failed to log note update for ${itemId}:`, logError);
            }

            // Trigger autosave
            autoSave().catch(e => console.error("Autosave failed after updating notes:", e)); // ***** ENSURE save is triggered *****
            // No re-render needed just for notes if using event delegation correctly
             console.log(`Notes updated for ${itemId}, background save triggered.`);
        }
    } catch (error) {
        console.error(`Error updating notes for itemId ${itemId}:`, error);
        // Maybe provide visual feedback of save failure?
        // Manually reset textarea on error
        const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
        const textarea = itemDiv?.querySelector('textarea[data-type="notes-input"]');
        if(textarea) {
             findInventoryItemByItemId(itemId).then(item => { // Fetch original value on error
                 if(item) textarea.value = item.notes ?? '';
             });
        }
    }
} // end of updateItemNotes

// Finalize a single item - Assume zero logic ---
async function finalizeSingleItem(itemId) {
    if (!itemId) { console.error("finalizeSingleItem: itemId is missing."); return; }
    console.log(`Attempting to finalize item: ${itemId}`);
    try {
        let item = await findInventoryItemByItemId(itemId);
        if (!item) { console.error(`Item ${itemId} not found for finalization.`); alert(`Error: Could not find item ${itemId} to finalize.`); return; }

        // Explicitly read the current value from the DOM input for THIS item
        const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
        const countInputInDOM = itemDiv?.querySelector('input[data-type="count-input"]');
        let domCountValueStr = countInputInDOM ? countInputInDOM.value : null; // Get value from DOM if input exists

        let effectiveQuantity;

        if (domCountValueStr !== null && domCountValueStr.trim() !== '') {
            // If DOM input has a value, parse it
            effectiveQuantity = Number(domCountValueStr);
        } else {
            // DOM input is blank or doesn't exist (e.g. if sequences disabled it)
            if (item.isUncounted && item.counted === null) {
                // If item is flagged uncounted AND model's count is null, assume 0 for finalization
                effectiveQuantity = 0;
                console.log(`Finalizing item ${itemId}: DOM Qty is blank and item is uncounted. Assuming 0.`);
            } else if (item.counted !== null) {
                // If DOM is blank, but model has a count (e.g. from sequence calc or prior save), use model's count
                effectiveQuantity = item.counted;
                console.log(`Finalizing item ${itemId}: DOM Qty is blank, using model's count: ${item.counted}.`);
            } else {
                // Both DOM and model count are null/blank, and item is not explicitly uncounted (should not happen if button logic is right)
                // This is an edge case, effectively finalizing with 'null' which is an error.
                 console.error(`Item ${itemId} has blank Qty, model count is null, and not flagged. Cannot finalize without a quantity.`);
                 alert(`Error: Item ${item.SKU} (ID: ${itemId}) has no quantity entered. Please enter a quantity (e.g., 0) or flag it as uncounted.`);
                 return; // Prevent finalization
            }
        }


        // Validate the effectiveQuantity
        if (isNaN(effectiveQuantity) || effectiveQuantity < 0) {
            console.error(`Finalizing item ${itemId}: Invalid effective quantity (${effectiveQuantity}).`);
            alert(`Error: Item ${item.SKU} (ID: ${itemId}) has an invalid quantity. Please correct.`);
            // Try to reset the input to what was in the model before this attempt.
            if (countInputInDOM) {
                countInputInDOM.value = (item.counted === null || item.counted === undefined) ? '' : item.counted;
            }
            return;
        }

        // If effectiveQuantity is different from model, or if model count was null, update the model.
        if (item.counted !== effectiveQuantity || (item.counted === null && effectiveQuantity !== null)) {
            console.log(`Finalizing item ${itemId}: Effective Qty (${effectiveQuantity}) requires model update from (${item.counted}).`);
            const updatedItemBeforeFinalize = await recordOrUpdateCount(itemId, effectiveQuantity, 'manual_finalize_capture');
            if (updatedItemBeforeFinalize) {
                item = updatedItemBeforeFinalize; // Use the potentially updated item object
            } else {
                console.warn(`Finalizing item ${itemId}: Failed to update count from DOM/assumed value before finalizing. Proceeding with current model state if possible.`);
                // If recordOrUpdateCount failed, we might have an issue.
                // Check item.counted again before proceeding with finalization logic.
                 if (item.counted === null && !item.isUncounted) { // If after failed update, count is still null and not uncounted
                      console.error(`Item ${itemId} count is still null after failed pre-finalize update. Cannot finalize.`);
                      alert(`Error: Could not confirm quantity for ${item.SKU} (ID: ${itemId}). Please try again.`);
                      return;
                 }
            }
        }


        // Now proceed with the finalization logic using the (potentially updated) item object
        if (!item.isActive) { console.warn(`Attempting to finalize inactive item ${itemId}.`); alert(`Cannot finalize an inactive item.`); return; }
        // The button should be disabled if !item.toCount, but double check:
        if (!item.toCount) {
             console.warn(`Item ${itemId} is not marked 'To Count'. Finalization button should have been disabled.`);
             // Optionally, allow finalization anyway if this state is possible due to race conditions?
             // For now, let's be strict, as the button should prevent this.
             return;
        }

        // Final check for a valid count state before finalization
        // item.counted here should be the confirmed quantity (DOM, assumed 0, or previous model value)
        if (item.counted === null && !item.isUncounted) {
             console.error(`Final Check Fail: Item ${itemId} has null count but is not flagged uncounted. Cannot finalize.`);
             alert(`Error: Item ${item.SKU} (ID: ${itemId}) has an unresolved null count. Please enter a quantity or flag it.`);
             return;
        }
        // isNaN check already performed on effectiveQuantity

        // --- Actual Finalization ---
        item.toCount = false;
        const finalizedCount = item.counted; // This is the definitive count being finalized
        const wasUncountedWhenFinalized = item.isUncounted; // Should be false now if recordOrUpdateCount ran

        logTransaction({
            type: 'item_count_finalized',
            itemId: item.itemId,
            SKU: item.SKU,
            location: item.location,
            details: {
                finalCount: finalizedCount, // This is the key value
                wasUncountedAtFinalizeEntry: wasUncountedWhenFinalized, // State of isUncounted when this specific log is made
                sequences: { inner1: item.innerSequence, outer1: item.outerSequence, inner2: item.innerSequence2, outer2: item.outerSequence2 },
                notes: item.notes
            }
        });

        await autoSave();
        console.log(`Item ${itemId} marked as finished (toCount=false) for this count cycle. Finalized count: ${finalizedCount}.`);

        applyCurrentFilters();
        if (typeof updateSummaryCards === 'function') {
            updateSummaryCards();
        } else {
            console.error("updateSummaryCards function not found after finalizing item.");
        }

    } catch (error) {
        console.error(`Error finalizing item ${itemId}:`, error);
        alert(`An error occurred while finalizing item ${itemId}. Please check the console.`);
        applyCurrentFilters();
    }
}
 // end of finalizeSingleItem

async function flagItemAsUncounted(itemId) {
    if (!itemId) { console.error("flagItemAsUncounted: itemId is missing."); return; }
    try {
        const item = await findInventoryItemByItemId(itemId);
        if (!item) { console.error(`Item ${itemId} not found for flagging.`); return; }

        if (!item.isActive) {
            console.warn(`Attempted to flag inactive item ${itemId}. Action aborted.`);
            alert("Inactive items cannot be flagged.");
            return;
        }
        if (item.isUncounted) {
            console.warn(`Item ${itemId} is already flagged as uncounted. No action taken.`);
            // alert("Item is already flagged as uncounted."); // Optional user feedback
            return; // No change needed if already uncounted
        }

        const timestamp = new Date().toISOString();
        const previousCount = item.counted;
        const wasPreviouslyToCount = item.toCount;

        // Core flagging actions
        item.counted = null;
        item.isUncounted = true;
        item.toCount = true; // Ensure it's brought back to the active count list
        item.lastCountTimestamp = timestamp;

        // Clear sequences/calculated footage if it's a reel
        if (item.isReel) {
            item.innerSequence = ''; item.outerSequence = '';
            item.innerSequence2 = ''; item.outerSequence2 = '';
            item.calculatedFootage = null;
        }

        const logDetails = {
            previousCount: previousCount,
            wasPreviouslyToCount: wasPreviouslyToCount, // Log if it was pulled from a "finished" state
        };
        let logType = 'item_reset_to_uncounted';

        if (item.currentRecountBatchId) {
            logType = `recount_item_reset_to_uncounted`;
            logDetails.recountBatchId = item.currentRecountBatchId;
        }

        await logTransaction({ // logTransaction is in stateManager.js
            type: logType,
            itemId: item.itemId,
            SKU: item.SKU,
            location: item.location,
            details: logDetails
        });
        console.log(`Item ${itemId} (SKU: ${item.SKU}, Loc: ${item.location}) flagged as uncounted. toCount set to true.`);

        await autoSave(); // autoSave is in stateManager.js
        
        // UI Update
        applyCurrentFilters(); // In dataLogic.js - will re-render and item should now appear in "To Count"
        if (typeof updateSummaryCards === 'function') { // updateSummaryCards is in uiRenderer.js
             updateSummaryCards();
        } else {
             console.error("updateSummaryCards function not found after flagging item.");
        }
        // Provide user feedback if it was pulled from a finished state
        if (!wasPreviouslyToCount) {
            alert(`Item ${item.SKU} at ${item.location} has been flagged as uncounted and moved back to the 'To Count' list.`);
        }


    } catch (error) {
        console.error(`Error in flagItemAsUncounted for itemId ${itemId}:`, error);
        alert(`Failed to flag item ${item?.SKU || itemId} as uncounted. See console.`);
    }
}


// ** Handle adding recount adjustments **
// Needs DB.addRecountAdjustment from offlineDB.js
async function addRecountAdjustment(itemId, adjustmentTxId, adjustmentQtyStr) {
    if (!itemId || !adjustmentTxId || !adjustmentQtyStr) {
         alert("Missing information for adjustment (Item ID, Transaction ID, or Quantity).");
         return;
    }
    const adjustmentQty = Number(adjustmentQtyStr);
    if (isNaN(adjustmentQty)) {
         alert("Invalid quantity entered for adjustment. Please enter a number.");
         return;
    }
    if (adjustmentQty === 0) {
        alert("Adjustment quantity cannot be zero.");
        return;
    }

    // Find the item FIRST to check if it's part of an active recount
     const item = await findInventoryItemByItemId(itemId);
     if (!item) {
          alert(`Item with ID ${itemId} not found.`);
          return;
     }
     if (!item.currentRecountBatchId) {
          alert(`Item ${item.SKU} at ${item.location} is not currently part of an active recount batch.`);
          return;
     }
     const activeRecountBatchId = item.currentRecountBatchId; // Use the ID from the item


    try {
        const timestamp = new Date().toISOString();
        const user = getUserIdentifier();

        // 1. Log the adjustment event itself using the DB function
        const adjustmentData = {
            // adjustmentId will be auto-generated by DB
            itemId: itemId,
            recordedDuringRecountBatchId: activeRecountBatchId,
            adjustmentTransactionId: adjustmentTxId.trim(),
            adjustmentQuantity: adjustmentQty,
            timestamp: timestamp,
            user: user
        };
        await DB.addRecountAdjustment(adjustmentData); // Log to its specific store
        console.log(`Recount adjustment logged for itemId ${itemId}: TxID=${adjustmentTxId}, Qty=${adjustmentQty}, Batch=${activeRecountBatchId}`);


        // 2. Update the item's counted quantity using the main count update function
        const currentCount = item.counted === null ? 0 : item.counted; // Treat null count as 0 for calc
        const newNetQuantity = currentCount + adjustmentQty;

        // Use recordOrUpdateCount, which handles state update, logging, and saving
        const updatedItem = await recordOrUpdateCount(
            itemId,
            newNetQuantity,
            'recount_adjustment', // Source type
            {
                 adjustmentTxId: adjustmentData.adjustmentTransactionId, // Include original Tx ID in details
                 adjustmentQty: adjustmentData.adjustmentQuantity,
                 previousPhysicalCount: currentCount, // Log count *before* this adjustment
                 // recountBatchId is added automatically by recordOrUpdateCount if item.currentRecountBatchId is set
            }
        );

        if (updatedItem) {
             // Adjustment added and count updated successfully
             alert(`Adjustment added for ${item.SKU} at ${item.location}.\nNew Count: ${updatedItem.counted}`);
             // Re-render the UI to show updated count and the new adjustment in the list
             applyCurrentFilters(); // Re-render list
             updateSummaryCards();
        } else {
             // recordOrUpdateCount might have failed (e.g., item became inactive?)
             // The adjustment *is* logged, but the count wasn't updated.
             console.error(`Adjustment logged for ${itemId}, but failed to update item count.`);
             alert(`Error: Adjustment was logged, but failed to update the item's count. Please check item status or console.`);
             // Re-render might be needed to clear input fields
             applyCurrentFilters();
        }

    } catch (error) {
        console.error(`Error adding recount adjustment for itemId ${itemId}:`, error);
        alert(`Failed to add recount adjustment. See console for details. ${error.message}`);
    }
} // end of addRecountAdjustment

// Triggers a specific import process with 'new_count' context
// Needs access to DB functions (getCycleById, saveCycle), getUserIdentifier, showImportDialog
async function startNewCount() { // Make it async
    // 1. Prompt for Cut-off Date
    const cutOffDateStr = prompt("Enter the Cut-off Date for this new count cycle (YYYY-MM-DD):");
    if (!cutOffDateStr) {
        console.log("Start new count cycle cancelled by user (no cut-off date provided).");
        return;
    }

    // 2. Generate Cycle ID
    const cycleId = getCycleIdFromDate(cutOffDateStr);
    if (!cycleId) {
        // Error message handled within getCycleIdFromDate
        return;
    }

    try {
        // 3. Check if cycle already exists
        console.log(`Checking for existing cycle with ID: ${cycleId}`);
        const existingCycle = await DB.getCycleById(cycleId);

        if (existingCycle) {
             console.warn(`Cycle ID ${cycleId} already exists (Status: ${existingCycle.status}). Aborting.`);
             alert(`A count cycle for ${cycleId} already exists (Status: ${existingCycle.status}). You cannot start a new cycle with the same Cut-off Date quarter.`);
             return;
        }

        // 4. Confirm starting the cycle and CSV import
        const confirmationMessage = `Start a NEW count cycle?\n\nCycle ID: ${cycleId}\nCut-off Date: ${cutOffDateStr}\n\nThis requires importing a CSV file containing the SKUs for this cycle.\n- Items IN the CSV will be marked 'To Count'.\n- Existing items NOT IN the CSV will be marked as NOT 'To Count'.\n- All item counts will be RESET for this cycle.\n\nProceed to select CSV file?`;

        if (!confirm(confirmationMessage)) {
            console.log("Start new count cycle cancelled by user at confirmation.");
            return;
        }

        // 5. Create and Save the new Cycle Record
        const cycleData = {
            cycleId: cycleId,
            cutOffDate: cutOffDateStr,
            startDate: new Date().toISOString(), // Record when the cycle process started
            status: 'open',
            finalizedTimestamp: null,
            createdBy: getUserIdentifier() // getUserIdentifier is in stateManager.js
        };
        await DB.saveCycle(cycleData);
        console.log(`New count cycle ${cycleId} created and saved.`);

        // 6. Initiate the specific import process for 'new_count'
        // Pass cycleId and cutOffDate to showImportDialog
        // showImportDialog is in importExport.js
        if (typeof showImportDialog === 'function') {
             console.log(`Calling showImportDialog with context 'new_count', cycleId: ${cycleId}, cutOffDate: ${cutOffDateStr}`);
             showImportDialog('new_count', cycleId, cutOffDateStr); // Pass parameters
        } else {
              console.error("showImportDialog function not found! Cannot proceed with import.");
              alert("Error: Import function is missing. Cannot start new count.");
              // Optionally try to roll back the cycle creation? Complex.
        }

    } catch (error) {
        console.error("Error during startNewCount process:", error);
        alert(`An error occurred while starting the new count cycle: ${error.message}`);
        // Clean up? If cycle was created but import failed, it remains 'open'. User might need to manually resolve/restart.
    }
}
// end of startNewCount


// Needs showExportOptionsDialog from importExport.js and DB/logTransaction/autoSave etc.
async function finalizeInventory() {
    // 1. Prompt for Export first
    const exportResult = await showExportOptionsDialog();
    if (!exportResult || !exportResult.proceed) {
        return; // Stop if user cancelled or export failed
    }
    console.log("Export step completed or skipped. Proceeding with finalization confirmation.");

    // 2. Confirm Finalization
    if (confirm("FINAL WARNING:\n\nThis action will:\n- Mark ACTIVE REELS with zero or null quantity as INACTIVE.\n- Clear the 'To Count' flag for ALL items, hiding them from the default view until the next cycle.\n\nThis cannot be easily undone.\n\nAre you sure you want to finalize this inventory count?")) {
        console.log("User confirmed finalization.");
        const finalizeTimestamp = new Date().toISOString();
        let deactivatedReelCount = 0;
        let toCountClearedCount = 0;
        let itemsToSave = []; // Collect items that need saving

        database.inventory.forEach(item => {
            let modified = false;
            // --- Deactivate applicable reels ---
            if (item.isActive && item.isReel && (item.counted === null || item.counted === 0)) {
                item.isActive = false;
                item.lastCountTimestamp = finalizeTimestamp; // Record timestamp of status change
                deactivatedReelCount++;
                modified = true;
                // Log immediately within the loop? Or collect and log later? Log later is cleaner.
            }

            // --- Clear 'toCount' flag ---
             if (item.toCount) {
                 item.toCount = false;
                 toCountClearedCount++;
                 modified = true;
             }
             if (modified) {
                itemsToSave.push(item.itemId); // Add itemId to list needing save
             }
        });

        // Log the summary finalization event
        await logTransaction({
            type: 'inventory_finalized',
            details: {
                deactivatedReelCount: deactivatedReelCount,
                toCountClearedCount: toCountClearedCount
            }
        });
        console.log(`Inventory finalized. ${deactivatedReelCount} reels marked as inactive. ${toCountClearedCount} items had 'toCount' flag cleared.`);

        // Log individual status changes for deactivated reels
        database.inventory.forEach(item => {
             if (itemsToSave.includes(item.itemId) && !item.isActive && item.isReel && deactivatedReelCount > 0) {
                  // Check if this item was one of the reels deactivated in this run
                   if (item.lastCountTimestamp === finalizeTimestamp) {
                      logTransaction({
                          type: 'status_change',
                          SKU: item.SKU,
                          itemId: item.itemId,
                          location: item.location,
                          details: {
                              newStatus: false, // Inactive
                              reason: `Finalized REEL with ${item.counted === null ? 'null' : 'zero'} quantity`
                          }
                      }); // No need to await this log individually
                   }
             }
        });


        // Autosave changes (saves the entire inventory array which now includes modifications)
        if (itemsToSave.length > 0) {
            try {
               console.log("Saving finalized inventory state...");
               await autoSave();
               console.log("Finalized state saved.");
            } catch(e) {
                console.error("Autosave failed after finalizing inventory:", e);
                alert("Finalization logic applied, but failed to save changes. Please check console and maybe export manually again.");
                // Don't proceed with UI updates if save failed? Or proceed cautiously? Let's proceed for now.
            }
        } else {
             console.log("No items required state changes during finalization.");
        }


        // Re-filter (should now show nothing in 'to_count' view) and update UI
        applyCurrentFilters();
        updateSummaryCards();
        alert(`Inventory finalized.\n- ${deactivatedReelCount} reels marked as inactive.\n- ${toCountClearedCount} items cleared from the current count view.\nReady for next cycle.`);

    } else {
        console.log("Inventory finalization cancelled by user.");
    }
} // end of finalizeInventory