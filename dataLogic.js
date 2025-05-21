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
        
        // footageFactor must be a number, ensure it is.
        if (typeof item.footageFactor === 'string') {
            const parsedFactor = Number(item.footageFactor);
            item.footageFactor = isNaN(parsedFactor) ? null : parsedFactor;
        } else if (typeof item.footageFactor !== 'number') {
            item.footageFactor = null;
        }

        // Recalculate item.calculatedFootage using the refined calculateFootageForItem
        // This ensures consistency if defaults are applied after some sequence/factor changes.
        if (item.isReel) {
            const sequences = {
                inner1: item.innerSequence, outer1: item.outerSequence,
                inner2: item.innerSequence2, outer2: item.outerSequence2
            };
            item.calculatedFootage = calculateFootageForItem(item, sequences); // REFINED: calculateFootageForItem now handles factor
        } else {
            item.calculatedFootage = null;
        }


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
    // console.log("Applied data defaults (including toCount, reelNumber, currentRecountBatchId) to inventory items.");
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
    const item = database.inventory.find(item => item.itemId === itemId);
    return item || null;
} 

// ++ NEW: Logic for Add New Item Modal ++

/* async function handleSkuCheckInModal(enteredSku) {
    const sku = enteredSku.trim().toUpperCase(); // Standardize SKU input
    document.getElementById('newItemSku').value = sku; // Update input with standardized value

    const messageEl = document.getElementById('skuCheckMessage');
    const existingDetailsEl = document.getElementById('existingSkuDetails');
    const revealNewSkuBtn = document.getElementById('revealNewSkuDetailsBtn');
    const newSkuSection = document.getElementById('newSkuDetailsSection');
    const reelNumberGroup = document.getElementById('newItemReelNumberGroup');
    const reelNumberInput = document.getElementById('newItemReelNumber');
    const reelNumberMandatorySpan = document.getElementById('reelNumberMandatory');
    const submitBtn = document.getElementById('submitAddItemBtn');

    // Reset parts of the UI before new check
    messageEl.textContent = '';
    messageEl.className = 'form-text';
    existingDetailsEl.style.display = 'none';
    revealNewSkuBtn.style.display = 'none';
    newSkuSection.style.display = 'none'; // Keep hidden until explicitly revealed
    reelNumberGroup.style.display = 'none';
    reelNumberInput.required = false;
    reelNumberMandatorySpan.style.display = 'none';
    submitBtn.disabled = false; // Enable by default, validation will handle later

    if (!sku) {
        messageEl.textContent = 'SKU is required.';
        messageEl.classList.add('text-danger');
        submitBtn.disabled = true;
        return;
    }

    try {
        const existingItems = await DB.findItemsBySku(sku); // Uses new DB function

        if (existingItems && existingItems.length > 0) {
            const firstExisting = existingItems[0]; // Use details from the first match
            messageEl.textContent = `SKU '${sku}' already exists. You can add it to a new location/reel.`;
            messageEl.classList.add('text-info');

            document.getElementById('existingSkuDesc').textContent = firstExisting.Description || 'N/A';
            document.getElementById('existingSkuType').textContent = firstExisting.isReel ? (firstExisting.isTwoWayReel ? 'Two-Way Reel' : 'Reel') : 'Standard';
            existingDetailsEl.style.display = 'block';
            
            // If the existing SKU is a reel, show Reel Number input and make it mandatory
            if (firstExisting.isReel) {
                reelNumberGroup.style.display = 'block';
                reelNumberInput.required = true;
                reelNumberMandatorySpan.style.display = 'inline';
            }
            // "Create New SKU Details" button remains hidden
            // "Add Item to Location/Reel" (the main submit) is enabled by default, validation will check reel# if needed
        } else {
            messageEl.textContent = `SKU '${sku}' not found. You can define its details.`;
            messageEl.classList.add('text-success');
            revealNewSkuBtn.style.display = 'inline-block'; // Show button to define new SKU
            // Main submit button might be disabled until new SKU details are filled or SKU is corrected.
            // For now, let form validation handle this. If revealNewSkuBtn is clicked, newSkuSection becomes active.
            // If user proceeds without clicking reveal, ItemType defaults to Standard.
        }
    } catch (error) {
        console.error("Error checking SKU in modal:", error);
        messageEl.textContent = 'Error checking SKU. Please try again.';
        messageEl.classList.add('text-danger');
        submitBtn.disabled = true;
    }
} */

// --- START OF MODIFIED dataLogic.js -> handleSkuCheckInModal ---
async function handleSkuCheckInModal(enteredSku) {
    const sku = enteredSku.trim().toUpperCase(); // Standardize SKU input
    document.getElementById('newItemSku').value = sku; // Update input with standardized value

    const messageEl = document.getElementById('skuCheckMessage');
    const existingDetailsEl = document.getElementById('existingSkuDetails');
    const revealNewSkuBtn = document.getElementById('revealNewSkuDetailsBtn');
    const newSkuSection = document.getElementById('newSkuDetailsSection');
    const reelNumberGroup = document.getElementById('newItemReelNumberGroup');
    const reelNumberInput = document.getElementById('newItemReelNumber');
    const reelNumberMandatorySpan = document.getElementById('reelNumberMandatory');
    const submitBtn = document.getElementById('submitAddItemBtn');
    const newItemDescriptionInput = document.getElementById('newItemDescription'); // ++ Get the description input

    // Reset parts of the UI before new check
    messageEl.textContent = '';
    messageEl.className = 'form-text';
    existingDetailsEl.style.display = 'none';
    revealNewSkuBtn.style.display = 'none';
    newSkuSection.style.display = 'none'; // Keep hidden until explicitly revealed
    reelNumberGroup.style.display = 'none';
    reelNumberInput.required = false;
    reelNumberMandatorySpan.style.display = 'none';
    submitBtn.disabled = false; // Enable by default, validation will handle later
    // newItemDescriptionInput.value = ''; // ++ Clear previous description on new SKU check

    if (!sku) {
        messageEl.textContent = 'SKU is required.';
        messageEl.classList.add('text-danger');
        submitBtn.disabled = true;
        return;
    }

    try {
        const existingItems = await DB.findItemsBySku(sku); // Uses new DB function

        if (existingItems && existingItems.length > 0) {
            const firstExisting = existingItems[0]; // Use details from the first match
            messageEl.textContent = `SKU '${sku}' already exists. You can add it to a new location/reel.`;
            messageEl.classList.add('text-info');

            document.getElementById('existingSkuDesc').textContent = firstExisting.Description || 'N/A';
            document.getElementById('existingSkuType').textContent = firstExisting.isReel ? (firstExisting.isTwoWayReel ? 'Two-Way Reel' : 'Reel') : 'Standard';
            existingDetailsEl.style.display = 'block';
            
            // ++ PREFILL DESCRIPTION INPUT ++
            if (newItemDescriptionInput) {
                newItemDescriptionInput.value = firstExisting.Description || '';
            }
            
            if (firstExisting.isReel) {
                reelNumberGroup.style.display = 'block';
                reelNumberInput.required = true;
                reelNumberMandatorySpan.style.display = 'inline';
            }
        } else {
            messageEl.textContent = `SKU '${sku}' not found. You can define its details.`;
            messageEl.classList.add('text-success');
            revealNewSkuBtn.style.display = 'inline-block'; 
            if (newItemDescriptionInput) { // ++ If SKU not found, ensure description field is clear for user input
                newItemDescriptionInput.value = '';
            }
        }
    } catch (error) {
        console.error("Error checking SKU in modal:", error);
        messageEl.textContent = 'Error checking SKU. Please try again.';
        messageEl.classList.add('text-danger');
        submitBtn.disabled = true;
    }
}
// --- END OF MODIFIED dataLogic.js -> handleSkuCheckInModal ---
/*
Explanation of Changes in handleSkuCheckInModal:
const newItemDescriptionInput = document.getElementById('newItemDescription');: Added to get a reference to the description input field in the modal.
if (newItemDescriptionInput) { newItemDescriptionInput.value = firstExisting.Description || ''; }: When an existing SKU is found, this line now sets the value of the actual description input field to the description of the firstExisting item.
if (newItemDescriptionInput) { newItemDescriptionInput.value = ''; }: When a SKU is not found (i.e., it's a new SKU), this ensures the description field is cleared, allowing the user to type a new description. I've removed the commented-out line that cleared it unconditionally at the start, as we only want to clear it if it's a truly new SKU or explicitly reset it.
*/

async function checkReelDuplicateInModal(sku, reelNumber, location) {
    const reelCheckMsgEl = document.getElementById('reelCheckMessage');
    const submitBtn = document.getElementById('submitAddItemBtn');
    reelCheckMsgEl.textContent = '';
    reelCheckMsgEl.className = 'form-text';
    submitBtn.disabled = false; // Assume valid until checked

    if (!sku || !reelNumber || !location) return; // Not enough info

    try {
        // Check if this exact SKU + ReelNumber + Location combination already exists
        const itemsWithSku = await DB.findItemsBySku(sku);
        const duplicate = itemsWithSku.find(item => 
            item.isReel && 
            item.reelNumber === reelNumber &&
            item.location.toLowerCase() === location.toLowerCase()
        );

        if (duplicate) {
            reelCheckMsgEl.textContent = `This Reel Number (${reelNumber}) for SKU ${sku} already exists at Location ${location}.`;
            reelCheckMsgEl.classList.add('text-danger');
            submitBtn.disabled = true;
        } else {
            reelCheckMsgEl.textContent = `Reel Number ${reelNumber} is available for SKU ${sku} at Location ${location}.`;
            reelCheckMsgEl.classList.add('text-success');
        }
    } catch (error) {
        console.error("Error checking reel duplicate:", error);
        reelCheckMsgEl.textContent = "Error checking reel uniqueness.";
        reelCheckMsgEl.classList.add('text-danger');
        submitBtn.disabled = true;
    }
}


async function processAddItemForm() {
    const form = document.getElementById('addNewItemForm');
    const sku = form.elements['SKU'].value.trim().toUpperCase();
    const location = form.elements['Location'].value.trim();
    let description = form.elements['Description'].value.trim();
    
    let itemType = form.elements['ItemType'].value; // Standard, Reel, Two-Way Reel
    let reelNumber = form.elements['reelNumber'].value.trim();
    let footageFactorStr = form.elements['FootageFactor'].value.trim();
    let footageFactor = null;

    const definingNewSku = document.getElementById('newSkuDetailsSection').style.display === 'block';
    const existingSkuInfoVisible = document.getElementById('existingSkuDetails').style.display === 'block';


    // --- Basic Validation ---
    if (!sku || !location) {
        alert("SKU and Location are mandatory.");
        return;
    }

    // If using details of an existing SKU that is a reel, Reel Number becomes mandatory
    if (existingSkuInfoVisible && document.getElementById('existingSkuType').textContent.includes('Reel')) {
        if (!reelNumber) {
            alert("Reel Number is mandatory for existing reel SKUs.");
            document.getElementById('newItemReelNumber').focus();
            return;
        }
         // Check for duplicate SKU+Reel#+Location again before submitting
        const itemsWithSku = await DB.findItemsBySku(sku);
        const duplicate = itemsWithSku.find(item => 
            item.isReel && 
            item.reelNumber === reelNumber &&
            item.location.toLowerCase() === location.toLowerCase()
        );
        if (duplicate) {
            alert(`This Reel Number (${reelNumber}) for SKU ${sku} already exists at Location ${location}. Cannot add duplicate.`);
            return;
        }
    }


    // If defining new SKU details
    if (definingNewSku) {
        if (!description && !existingSkuInfoVisible) { // Description mandatory if creating new SKU from scratch
            // If using existing SKU, description might come from there.
            // If SKU didn't exist, then user must provide description or it was in newItemDescription
            if (!form.elements['Description'].value.trim()){
                 alert("Description is recommended when defining a new SKU.");
                 // Let's make it non-blocking for now as per plan "optional initially but recommended"
                 // form.elements['Description'].focus();
                 // return;
            }
        }
        if (itemType === 'Reel' || itemType === 'Two-Way Reel') {
            if (!reelNumber) {
                alert("Reel Number is mandatory when Item Type is Reel or Two-Way Reel.");
                document.getElementById('newItemReelNumber').focus();
                return;
            }
            if (footageFactorStr) {
                const parsedFactor = Number(footageFactorStr);
                if (isNaN(parsedFactor) || parsedFactor < 0) {
                    alert("Footage Factor must be a valid non-negative number.");
                    document.getElementById('newItemFootageFactor').focus();
                    return;
                }
                footageFactor = parsedFactor;
            }
            // Check for duplicate SKU+Reel#+Location for newly defined reel
             const itemsWithSku = await DB.findItemsBySku(sku);
             const duplicate = itemsWithSku.find(item => 
                item.isReel && 
                item.reelNumber === reelNumber && // Check against any location if defining new globally
                item.SKU.toUpperCase() === sku // This check ensures we are looking at the same SKU global context
             );
             // The plan says "check if the specific SKU + Reel Number combination already exists at the target Location"
             // If we are defining a "new SKU detail", it implies this SKU doesn't exist at all,
             // so a SKU+Reel# check should be sufficient globally for a *newly defined* reel SKU.
             // However, if the user *typed* an existing SKU, then corrected to "define new details", this check is important.
             // Let's be safe: check SKU + Reel# globally for a new SKU.
             // For an existing SKU being added to a new location, the SKU+Reel#+Location check is done above.
             if (duplicate && !existingSkuInfoVisible) { // Only if truly creating a NEW SKU with this reel number
                 alert(`A Reel with SKU '${sku}' and Reel Number '${reelNumber}' already exists in the database (possibly at a different location). New SKU definitions must be unique by SKU+ReelNumber globally if it's a reel.`);
                 return;
             }
        }
    } else if (!existingSkuInfoVisible) {
        // SKU does not exist, and user has not clicked "Define New SKU Details"
        // Default to "Standard" type if no new details are defined.
        itemType = 'Standard';
        reelNumber = ''; 
        footageFactor = null;
        // Description would be whatever they typed in the optional field.
    }

    // --- NEW: Uniqueness Check before proceeding ---
    let existingItemCheck = null;
    if (itemType === 'Reel' || itemType === 'Two-Way Reel') {
        // For reel items, ReelNumber is essential for the uniqueness check.
        // The form validation should have already ensured reelNumber is provided if itemType indicates a reel.
        if (!reelNumber) { // This should ideally be caught by earlier form validation logic
            alert("Reel Number is mandatory for reel items. Cannot check for duplicates.");
            return; 
        }
        try {
            existingItemCheck = await DB.findItemBySkuAndReelNumber(sku, reelNumber);
            if (existingItemCheck) {
                alert(`An item with SKU '${sku}' and Reel Number '${reelNumber}' already exists in the database (ID: ${existingItemCheck.itemId}).\nYou cannot add a duplicate item with the same SKU and Reel Number.\n\nPlease find and update the existing item if needed, or use a unique Reel Number.`);
                return; // Stop processing
            }
        } catch (dbError) {
            console.error("Database error checking for existing SKU+ReelNumber:", dbError);
            alert("An error occurred while checking for item uniqueness. Please try again.");
            return;
        }
    } else { // Standard (non-reel) item
        try {
            existingItemCheck = await DB.findItemBySkuAndLocation(sku, location);
            if (existingItemCheck) {
                alert(`An item with SKU '${sku}' at Location '${location}' already exists in the database (ID: ${existingItemCheck.itemId}).\nYou cannot add a duplicate item with the same SKU and Location.\n\nPlease find and update the existing item if needed, or use a unique Location.`);
                return; // Stop processing
            }
        } catch (dbError) {
            console.error("Database error checking for existing SKU+Location:", dbError);
            alert("An error occurred while checking for item uniqueness. Please try again.");
            return;
        }
    }
    // --- END: Uniqueness Check ---


    // --- Prepare Item Data ---
    let newItemData = {
        SKU: sku,
        Location: location,
        Description: description,
        isReel: itemType === 'Reel' || itemType === 'Two-Way Reel',
        isTwoWayReel: itemType === 'Two-Way Reel',
        reelNumber: (itemType === 'Reel' || itemType === 'Two-Way Reel') ? reelNumber : '',
        footageFactor: (itemType === 'Reel' || itemType === 'Two-Way Reel') ? footageFactor : null,
        // Other fields will be set by applyDataDefaults
    };

    // If SKU existed, and user is adding it to a new location/reel,
    // inherit some properties from the first existing item of that SKU
    if (existingSkuInfoVisible && !definingNewSku) {
        const existingItems = await DB.findItemsBySku(sku);
        if (existingItems && existingItems.length > 0) {
            const baseItem = existingItems[0];
            newItemData.Description = description || baseItem.Description; // User's input takes precedence
            newItemData.isReel = baseItem.isReel;
            newItemData.isTwoWayReel = baseItem.isTwoWayReel;
            newItemData.footageFactor = baseItem.footageFactor;
            // Reel number comes from the form input if it's a reel
            if (baseItem.isReel) {
                newItemData.reelNumber = reelNumber; // Already validated if it's a reel
            }
        }
    }
    
    try {
        await addNewInventoryItem(newItemData); // Call the main add function
        closeAddNewItemModal(); // In eventHandlers.js
        alert(`Item ${sku} successfully added to location ${location}.`);
    } catch (error) {
        console.error("Error submitting add new item form:", error);
        alert(`Failed to add item: ${error.message}`);
    }
}


async function addNewInventoryItem(itemDataFromModal) {
    // Further validation can be done here if complex inter-field dependencies exist.
    // For now, assuming basic validation happened in processAddItemForm.

    const newItem = {
        itemId: DB.generateSimpleId(),
        SKU: itemDataFromModal.SKU,
        Description: itemDataFromModal.Description || 'N/A',
        location: itemDataFromModal.Location,
        isReel: itemDataFromModal.isReel,
        reelNumber: itemDataFromModal.isReel ? itemDataFromModal.reelNumber : '',
        isTwoWayReel: itemDataFromModal.isReel ? itemDataFromModal.isTwoWayReel : false,
        footageFactor: itemDataFromModal.isReel ? itemDataFromModal.footageFactor : null,
        // These will be set by applyDataDefaults:
        // notes: '', isActive: true, innerSequence: '', etc.
        // Crucial overrides:
        toCount: true,
        isUncounted: true,
        counted: null,
        lastCountTimestamp: new Date().toISOString() // Mark creation/addition time
    };

    const [fullyProcessedItem] = applyDataDefaults([newItem]); // applyDataDefaults will add other necessary fields

    database.inventory.push(fullyProcessedItem);

    await logTransaction({
        type: 'create_item',
        itemId: fullyProcessedItem.itemId,
        SKU: fullyProcessedItem.SKU,
        location: fullyProcessedItem.location,
        details: {
            description: fullyProcessedItem.Description,
            itemType: fullyProcessedItem.isReel ? (fullyProcessedItem.isTwoWayReel ? 'Two-Way Reel' : 'Reel') : 'Standard',
            reelNumber: fullyProcessedItem.reelNumber,
            addedToCount: true
        }
    });

    await autoSave();
    applyCurrentFilters();
    updateSummaryCards();

    console.log("New item added:", fullyProcessedItem);
    return fullyProcessedItem;
}

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
} 
 // end of findInventoryItemsBySKU

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
function applyCurrentFilters() {
    try {
        // console.log("Applying filters:", currentFilters);
        let filteredInventory = database.inventory.filter(item => {
            const locationMatch = !currentFilters.location || (item.location && item.location.toLowerCase().includes(currentFilters.location.toLowerCase()));
            const statusMatch = currentFilters.status === 'all' ||
                                (currentFilters.status === 'active' && item.isActive) ||
                                (currentFilters.status === 'inactive' && !item.isActive);
            let toCountMatch = false;
            switch (currentFilters.filterByToCountStatus) {
                case 'all': toCountMatch = true; break;
                case 'counted': toCountMatch = item.toCount === false; break;
                case 'to_count': default: toCountMatch = item.toCount === true; break;
            }
            return locationMatch && statusMatch && toCountMatch;
        });

        if (currentFilters.searchTerm) {
            const searchTermLower = currentFilters.searchTerm.toLowerCase();
            filteredInventory = filteredInventory.filter(item => {
                const skuMatch = item.SKU && item.SKU.toLowerCase().includes(searchTermLower);
                const descMatch = item.Description && item.Description.toLowerCase().includes(searchTermLower);
                const reelNumMatch = item.reelNumber && item.reelNumber.toLowerCase().includes(searchTermLower);
                const itemIdMatch = item.itemId && item.itemId.toLowerCase().includes(searchTermLower);
                return skuMatch || descMatch || reelNumMatch || itemIdMatch;
            });
            // console.log(`Applied search term "${currentFilters.searchTerm}", ${filteredInventory.length} items remain.`);
        }

        currentInventory = filteredInventory;
        currentInventory.sort((a, b) => {
             const locA = a.location || ''; const locB = b.location || '';
             const skuA = a.SKU || ''; const skuB = b.SKU || '';
             if (locA < locB) return -1; if (locA > locB) return 1;
             if (skuA < skuB) return -1; if (skuA > skuB) return 1;
             return 0;
        });
        renderInventoryList();
    } catch (error) {
        console.error("Error applying filters:", error);
        currentInventory = []; 
        renderInventoryList(); 
    }
}  // end of applyCurrentFilters

function clearAllFilters() {
    currentFilters.location = null;
    currentFilters.status = 'active'; 
    currentFilters.searchTerm = '';
    currentFilters.filterByToCountStatus = 'to_count'; 
    updateFilterControlsUI();
    applyCurrentFilters();
}  // end of clearAllFilters


// --- Apply filters from UI interactions ---
// --- Reads UI and calls core filter logic ---
function applyCurrentFiltersFromUI() {
    const locationInput = document.getElementById('locationFilterInput');
    const statusSelect = document.getElementById('statusFilterSelect');
    const searchInput = document.getElementById('searchInput');

    currentFilters.location = locationInput ? locationInput.value.trim() : null; // Keep case for display, lowercase for match
    currentFilters.status = statusSelect ? statusSelect.value : 'active';
    currentFilters.searchTerm = searchInput ? searchInput.value.trim() : ''; // Keep case for display, lowercase for match

    if (currentFilters.status === 'all') {
        currentFilters.filterByToCountStatus = 'all';
    } else {
        currentFilters.filterByToCountStatus = 'to_count';
    }
    // console.log("Applying filters from UI:", currentFilters);
    applyCurrentFilters(); 
}  // End applyFiltersFromUI

// Records the physical count OR updates count via adjustment, logs, saves
async function recordOrUpdateCount(itemId, newQuantity, source, details = {}) {
    if (itemId === null || itemId === undefined) {
        console.error("recordOrUpdateCount: itemId is missing."); return null;
    }
    // Allow newQuantity to be 0
    if (newQuantity === null || newQuantity === undefined || typeof newQuantity !== 'number' || isNaN(newQuantity) || newQuantity < 0) {
        console.error(`recordOrUpdateCount: Invalid newQuantity (${newQuantity}) for itemId ${itemId}. Must be non-negative number.`);
        return null; 
    }

    try {
        const item = await findInventoryItemByItemId(itemId);
        if (!item) {
            console.error(`Item with itemId ${itemId} not found for recording count.`); return null;
        }
        if (!item.isActive) {
            console.warn(`Attempted to update count for inactive item ${itemId}.`); return null;
        }
         if (!item.toCount && source !== 'recount_adjustment' && source !== 'manual_finalize_capture' && source !== 'sequence_calc_for_finalize') { // Allow sequence_calc if it's for finalization context
             console.warn(`Attempted to update count for finished item ${itemId} (source: ${source}).`);
             return null;
         }

        const previousCount = item.counted;
        const previousFlag = item.isUncounted;
        if (previousCount === newQuantity && previousFlag === false && source !== 'recount_adjustment') {
            console.log(`Count for ${itemId} is already ${newQuantity}. No change recorded (source: ${source}).`);
            return item; 
        }

        item.counted = newQuantity;
        item.isUncounted = false; 
        item.lastCountTimestamp = new Date().toISOString();
        
        // Do not clear calculatedFootage if source is sequence_calc.
        // It will be set by updateSequences or applyDataDefaults before this.
        // If source is manual_count or import_update etc., and it's a reel, then calculatedFootage should be nulled.
        if (item.isReel && source !== 'sequence_calc' && source !== 'sequence_calc_for_finalize') {
            item.calculatedFootage = null; // Manual count overrides calculated footage
        }


        const logEntry = {
            type: 'update_count', 
            itemId: item.itemId, SKU: item.SKU, location: item.location,
            user: getUserIdentifier(), timestamp: item.lastCountTimestamp,
            details: { source: source, oldValue: previousCount, newValue: newQuantity, wasUncounted: previousFlag, ...details }
        };
        if (item.currentRecountBatchId) {
            logEntry.type = source === 'recount_adjustment' ? 'recount_adjustment_update' : 'recount_physical_update';
            logEntry.details.recountBatchId = item.currentRecountBatchId;
        }
        await logTransaction(logEntry);
        autoSave().catch(e => console.error("Autosave failed after recording count:", e));
        return item; 
    } catch (error) {
        console.error(`Error in recordOrUpdateCount for itemId ${itemId}:`, error); return null;
    }
}  // end of recordOrUpdateCount


// updateCount calls recordOrUpdateCount and UI updates
// --- START OF MODIFIED dataLogic.js -> updateCount (add clear dirty) ---
async function updateCount(itemId, quantityStr) {
    const quantity = Number(quantityStr);
    if (isNaN(quantity) || quantity < 0) {
        // ... (alert and reset logic remains) ...
        updateItemDirtyIndicator(itemId, false); // Clear dirty state on invalid input attempt too
        return;
    }

    const item = await findInventoryItemByItemId(itemId);
    if (!item) {
        console.error(`updateCount: Item ${itemId} not found.`);
        updateItemDirtyIndicator(itemId, false); // Item not found, clear if indicator was somehow set
        return;
    }

    const updatedItem = await recordOrUpdateCount(itemId, quantity, 'manual_count');

    if (updatedItem) {
        // ... (DOM updates for countInput) ...
        if (typeof updateSummaryCards === 'function') updateSummaryCards();
        updateItemDirtyIndicator(itemId, false); // ++ Clear dirty indicator on successful save
        console.log(`Count updated for ${itemId} ...`);
    } else {
        // ... (warning and reset input logic) ...
        // updateItemDirtyIndicator(itemId, true); // Optionally, re-set to dirty if save failed but input changed
    }
}
// --- END OF MODIFIED dataLogic.js -> updateCount ---

// Calculate footage
// REFINED: Now includes footageFactor logic and returns scaled footage or null.
function calculateFootageForItem(item, sequences) {
    // sequences = { inner1, outer1, inner2, outer2 }
    // console.log(`[calculateFootageForItem] Called for itemId: ${item?.itemId}, sequences:`, sequences);

    if (!item || !item.isReel) {
        // console.log(`[calculateFootageForItem] Not a reel or item missing.`);
        return null; 
    }

    let pairCalculationAttempted = false; // Track if any pair had input

    // Helper to parse, treating blank or invalid as 0 per spec.
    const parseSequenceValue = (valueStr) => {
        const trimmedStr = String(valueStr || '').trim();
        if (trimmedStr === '') return 0; // Treat blank as 0

        pairCalculationAttempted = true; // Indicate an attempt was made with this pair

        const num = Number(trimmedStr);
        // Per spec: "Treat any resulting NaN or the original empty string as 0"
        // And negative numbers are usually not valid sequence markers either.
        if (isNaN(num) || num < 0) {
             // console.warn(`[calculateFootageForItem] Invalid sequence value '${trimmedStr}' treated as 0 for item ${item.itemId}`);
             return 0; 
        }
        return num; 
    };

    const parsed_inner1 = parseSequenceValue(sequences.inner1);
    const parsed_outer1 = parseSequenceValue(sequences.outer1);
    const diff1 = Math.abs(parsed_outer1 - parsed_inner1);
    // console.log(`[calculateFootageForItem] Pair 1: inner=${parsed_inner1}, outer=${parsed_outer1}, diff1=${diff1}`);

    let diff2 = 0;
    if (item.isTwoWayReel) {
        const parsed_inner2 = parseSequenceValue(sequences.inner2);
        const parsed_outer2 = parseSequenceValue(sequences.outer2);
        diff2 = Math.abs(parsed_outer2 - parsed_inner2);
        // console.log(`[calculateFootageForItem] Pair 2 (Two-Way): inner=${parsed_inner2}, outer=${parsed_outer2}, diff2=${diff2}`);
    }

    const totalDifference = diff1 + diff2;
    // console.log(`[calculateFootageForItem] Total Unscaled Difference: ${totalDifference}`);

    // Final Calculation:
    // Only return a valid number if a pair calculation was attempted AND footageFactor is valid.
    if (pairCalculationAttempted && typeof item.footageFactor === 'number' && item.footageFactor > 0) {
        const finalFootage = totalDifference * item.footageFactor;
        // console.log(`[calculateFootageForItem] Valid factor ${item.footageFactor}. Final Scaled Footage: ${finalFootage}`);
        return finalFootage;
    } else {
        // console.log(`[calculateFootageForItem] No pair calculation attempted or invalid/missing footageFactor (${item.footageFactor}). Returning null.`);
        return null; // No valid pairs entered, or footageFactor is invalid/missing/zero
    }
}  // end of calculateFootageForItem

// Update sequences and potentially the count
// REFINED: Adapts to calculateFootageForItem returning scaled footage and updates DOM more precisely.
// --- START OF MODIFIED dataLogic.js -> updateSequences ---
// --- START OF COMPLETE dataLogic.js -> updateSequences ---
async function updateSequences(itemId) {
    if (!itemId) { console.error("updateSequences: itemId missing"); return; }
    console.log(`[updateSequences] Triggered for itemId: ${itemId}`);
    let item = null; // Keep item in broader scope for error handling

    try {
        item = await findInventoryItemByItemId(itemId);
        if (!item || !item.isActive) { // Allow sequence updates even if !item.toCount, but not if inactive
             console.warn(`[updateSequences] Cannot update sequences: Item ${itemId} not found or inactive.`);
             // If item exists but is inactive, its inputs should be disabled by renderInventoryList.
             // No need to reset inputs here as they shouldn't be changeable.
             // Still, if this somehow gets called, ensure dirty indicator is cleared if item not found/inactive
             if (typeof updateItemDirtyIndicator === 'function') updateItemDirtyIndicator(itemId, false);
            return;
        }
        // If item.toCount is false, sequences can still be viewed/entered, but they won't affect item.counted
        // unless explicitly re-opened (e.g. via an "Edit" button).

        const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
        if (!itemDiv) { 
            console.error(`[updateSequences] Item div not found for itemId: ${itemId}`);
            if (typeof updateItemDirtyIndicator === 'function') updateItemDirtyIndicator(itemId, false); // Clear if div not found
            return; 
        }

        const sequenceValues = {
            inner1: itemDiv.querySelector('input[data-sequence="inner"]')?.value ?? '',
            outer1: itemDiv.querySelector('input[data-sequence="outer"]')?.value ?? '',
            inner2: itemDiv.querySelector('input[data-sequence="inner2"]')?.value ?? '',
            outer2: itemDiv.querySelector('input[data-sequence="outer2"]')?.value ?? '',
        };
        console.log(`[updateSequences] Read sequence values from inputs for item ${itemId}:`, sequenceValues);

        // Update item model with sequence values regardless of calculation outcome
        item.innerSequence = sequenceValues.inner1;
        item.outerSequence = sequenceValues.outer1;
        if (item.isTwoWayReel) {
            item.innerSequence2 = sequenceValues.inner2;
            item.outerSequence2 = sequenceValues.outer2;
        } else {
            // Ensure these are cleared if not a two-way reel
            item.innerSequence2 = ''; 
            item.outerSequence2 = '';
        }

        const finalCalculatedFootage = calculateFootageForItem(item, sequenceValues);
        item.calculatedFootage = finalCalculatedFootage; // Store scaled footage or null in the item model
        console.log(`[updateSequences] For item ${itemId}, refined calculated footage: ${finalCalculatedFootage}`);

        const countInput = itemDiv.querySelector('input[data-type="count-input"]');
        const totalFootageDisplay = itemDiv.querySelector('.calculated-footage-display.total-footage');

        let successfullySaved = false;

        if (item.isActive && item.toCount) { // Only update item.counted and Qty input if item is active and "to count"
            if (finalCalculatedFootage !== null) {
                console.log(`[updateSequences] Item ${itemId} is 'toCount'. Calling recordOrUpdateCount with ${finalCalculatedFootage}`);
                const updatedItemResult = await recordOrUpdateCount(itemId, finalCalculatedFootage, 'sequence_calc', {
                     sequences: sequenceValues 
                }); // This will log and save
                
                if (updatedItemResult) {
                    successfullySaved = true;
                    console.log(`[updateSequences] recordOrUpdateCount successful for item ${itemId}. Item count updated to ${finalCalculatedFootage}.`);
                    if (countInput) {
                        countInput.value = finalCalculatedFootage;
                        countInput.disabled = true; // Disable manual Qty input when calculated
                        countInput.title = "Quantity calculated from footage. To edit, clear sequences or flag uncounted.";
                    }
                } else {
                    console.warn(`[updateSequences] Sequence calculation for item ${itemId} resulted in ${finalCalculatedFootage}, but recordOrUpdateCount failed or was disallowed.`);
                    if (countInput && !countInput.disabled) { 
                        countInput.disabled = false;
                        countInput.title = "Enter current count (calculation failed to save).";
                    }
                }
            } else { // finalCalculatedFootage is null
                console.log(`[updateSequences] Item ${itemId} is 'toCount', but calculation is null. Qty input remains enabled for manual entry.`);
                if (countInput) {
                    countInput.disabled = false; // Ensure Qty input is enabled
                    countInput.title = "Enter current count (sequences incomplete/invalid or no factor).";
                }
                await autoSave(); // Save sequence strings even if count not updated
                successfullySaved = true; // Sequences themselves were saved
            }
        } else { // Item is inactive or not 'toCount'
            console.log(`[updateSequences] Item ${itemId} is inactive or not 'toCount'. Sequences updated in model, but count not changed. DOM Qty input not directly set by calc.`);
            await autoSave(); // Save sequence strings
            successfullySaved = true; // Sequences themselves were saved
        }


        // ----- Update Total Footage Display ALWAYS (if reel) -----
        if (item.isReel && totalFootageDisplay) {
            const hasValidFactor = typeof item.footageFactor === 'number' && item.footageFactor > 0;
            if (hasValidFactor) {
                if (finalCalculatedFootage !== null) {
                    totalFootageDisplay.textContent = `Total: ${finalCalculatedFootage.toFixed(2)} ft`;
                    totalFootageDisplay.style.color = '';
                    totalFootageDisplay.title = `Calculated with factor: ${item.footageFactor}`;
                } else {
                    const hasAnySeqInput = sequenceValues.inner1 || sequenceValues.outer1 || (item.isTwoWayReel && (sequenceValues.inner2 || sequenceValues.outer2));
                    if (hasAnySeqInput) {
                        totalFootageDisplay.textContent = 'Total: Invalid Input';
                        totalFootageDisplay.style.color = 'var(--danger-color)';
                        totalFootageDisplay.title = 'Incomplete or invalid sequence values entered.';
                    } else {
                        totalFootageDisplay.textContent = 'Total: ---';
                        totalFootageDisplay.style.color = '';
                        totalFootageDisplay.title = 'Enter sequences to calculate.';
                    }
                }
            } else {
                totalFootageDisplay.textContent = 'Total: N/A (No Factor)';
                totalFootageDisplay.style.color = 'var(--dark-gray)';
                totalFootageDisplay.title = 'Footage factor missing, zero, or invalid.';
            }
        }
        
        if (successfullySaved && typeof updateItemDirtyIndicator === 'function') {
            updateItemDirtyIndicator(itemId, false); // Clear dirty indicator on successful save
        }
        // updateSummaryCards() is called by recordOrUpdateCount if count changes.
        // autoSave() is also called by recordOrUpdateCount or explicitly above.

    } catch (error) {
        console.error(`Error updating sequences for itemId ${itemId}:`, error);
        alert(`Failed to update sequences for ${item?.SKU || itemId}. See console.`);
        // Optionally re-mark as dirty on error if you have a way to know if inputs actually changed
        // if (typeof updateItemDirtyIndicator === 'function') updateItemDirtyIndicator(itemId, true);
        if (item) {
            applyCurrentFilters();
        }
    }
}
// --- END OF updateSequences ---

// Update item notes
// --- START OF COMPLETE dataLogic.js -> updateItemNotes ---
async function updateItemNotes(itemId, notes) {
    if (!itemId) { 
        console.error("updateItemNotes: itemId missing"); 
        if (typeof updateItemDirtyIndicator === 'function') updateItemDirtyIndicator(itemId, false); // itemId is null, but try to clear just in case
        return; 
    }
    try {
        const item = await findInventoryItemByItemId(itemId);
        if (!item) {
             console.warn(`Cannot update notes: Item ${itemId} not found.`);
             const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
             const textarea = itemDiv?.querySelector('textarea[data-type="notes-input"]');
             if(textarea) textarea.value = ''; // Clear textarea if item not found to prevent confusion
             if (typeof updateItemDirtyIndicator === 'function') updateItemDirtyIndicator(itemId, false);
            return;
        }

        if (item.notes !== notes) {
            const oldNotes = item.notes;
            item.notes = notes;
            const timestamp = new Date().toISOString();

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
                logEntry.type = 'recount_update_notes'; // Ensure this type is handled in history rendering
                logEntry.details.recountBatchId = item.currentRecountBatchId;
            }

            try {
                await logTransaction(logEntry); 
                console.log(`Updated notes for ${itemId} (SKU: ${item.SKU}, Loc: ${item.location})`);
            } catch (logError) {
                 console.error(`Failed to log note update for ${itemId}:`, logError);
            }

            await autoSave(); 
            if (typeof updateItemDirtyIndicator === 'function') {
                updateItemDirtyIndicator(itemId, false); // Clear dirty indicator on successful save
            }
            console.log(`Notes updated for ${itemId}, background save triggered.`);
        } else {
            // Notes didn't actually change from what's in memory
            if (typeof updateItemDirtyIndicator === 'function') {
                updateItemDirtyIndicator(itemId, false); // Ensure indicator is clear
            }
        }
    } catch (error) {
        console.error(`Error updating notes for itemId ${itemId}:`, error);
        // Optionally mark as dirty if save failed. This depends on how you want to handle UI on error.
        // if (typeof updateItemDirtyIndicator === 'function') updateItemDirtyIndicator(itemId, true);
        const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
        const textarea = itemDiv?.querySelector('textarea[data-type="notes-input"]');
        if(textarea) {
             findInventoryItemByItemId(itemId).then(fetchedItem => { 
                 if(fetchedItem) textarea.value = fetchedItem.notes ?? ''; // Reset to original value on error
             });
        }
    }
} // end of updateItemNotes

// --- START OF NEW/REFACTORED dataLogic.js -> confirmAndFinalizeItem ---
async function confirmAndFinalizeItem(itemId) {
    if (!itemId) { console.error("confirmAndFinalizeItem: itemId is missing."); return; }
    console.log(`Attempting to confirm and finalize item: ${itemId}`);
    
    let item = await findInventoryItemByItemId(itemId);
    if (!item) { 
        console.error(`Item ${itemId} not found for confirm/finalize.`); 
        alert(`Error: Could not find item ${itemId} to confirm.`); 
        return; 
    }

    if (!item.isActive) { 
        console.warn(`Attempting to confirm/finalize inactive item ${itemId}.`); 
        alert(`Cannot confirm an inactive item.`); 
        return; 
    }
    if (!item.toCount) {
         console.warn(`Item ${itemId} is not marked 'To Count'. Confirm button should have been disabled.`);
         // This state implies it's already finalized or shouldn't be finalized now.
         return;
    }

    // --- PRE-CONFIRM SAVE OF DIRTY FIELDS ---
    // This part simulates blurring the fields to trigger their respective save logic.
    // It ensures the latest typed data is in `item.counted`, `item.sequences`, `item.notes`
    // before `item.toCount` is set to false.

    const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
    if (!itemDiv) {
        console.error(`Item div not found for ${itemId} during confirm. Cannot save dirty state.`);
        // Proceed with caution, using current DB state.
    } else {
        // 1. Save "dirty" notes
        const notesTextarea = itemDiv.querySelector('textarea[data-type="notes-input"]');
        if (notesTextarea && item.notes !== notesTextarea.value) {
            console.log(`[confirmAndFinalizeItem] Notes for ${itemId} are dirty. Saving before confirm.`);
            await updateItemNotes(itemId, notesTextarea.value); // This calls autoSave
            item = await findInventoryItemByItemId(itemId); // Re-fetch item as notes update might modify it
        }

        // 2. Save "dirty" sequences (and their effect on count if applicable)
        // Check if sequence inputs have values differing from the model.
        // This is a simplified check; a more robust check would compare all sequence inputs.
        const firstSeqInput = itemDiv.querySelector('input[data-sequence="inner"]');
        let sequencesPotentiallyDirty = false;
        if (item.isReel && firstSeqInput && item.innerSequence !== firstSeqInput.value) { // Example check
            sequencesPotentiallyDirty = true;
        }
        // Add more checks for other sequence inputs if necessary for full dirty detection here.

        if (sequencesPotentiallyDirty) {
             console.log(`[confirmAndFinalizeItem] Sequences for ${itemId} may be dirty. Triggering updateSequences.`);
             await updateSequences(itemId); // This calls recordOrUpdateCount (if calc is valid) and autoSave
             item = await findInventoryItemByItemId(itemId); // Re-fetch item
        }
        
        // 3. Save "dirty" count (if not calculated by sequences)
        const countInput = itemDiv.querySelector('input[data-type="count-input"]');
        const hasValidFactorForCalc = item.isReel && typeof item.footageFactor === 'number' && item.footageFactor > 0;
        const isCalculatedFromFootage = hasValidFactorForCalc && item.calculatedFootage !== null;

        if (countInput && !isCalculatedFromFootage) { // Only consider manual count if not calculated
            const domCountValueStr = countInput.value;
            const domCountNumber = Number(domCountValueStr);
            // Check if DOM count is a valid number and different from item.counted, or if item.counted is null and DOM has a value
            if (domCountValueStr.trim() !== '' && !isNaN(domCountNumber) && domCountNumber >= 0) {
                if (item.counted !== domCountNumber) {
                    console.log(`[confirmAndFinalizeItem] Manual count for ${itemId} is dirty (${domCountNumber} vs ${item.counted}). Saving.`);
                    await updateCount(itemId, domCountValueStr); // This calls recordOrUpdateCount and autoSave
                    item = await findInventoryItemByItemId(itemId); // Re-fetch item
                }
            } else if (domCountValueStr.trim() === '' && item.counted !== null) {
                // User cleared a manual count. Treat as wanting to set it to null/uncounted
                // This scenario should ideally be handled by "Flag as Uncounted"
                // For "Confirm", if field is blank, we'll use logic below (assume 0 if uncounted).
                console.log(`[confirmAndFinalizeItem] Manual count for ${itemId} cleared. Will assume 0 if item becomes uncounted.`);
            }
        }
    }
    // At this point, `item` variable should reflect the latest saved state for count, sequences, notes.

    // --- DETERMINE FINAL QUANTITY FOR FINALIZATION ---
    let effectiveQuantity;
    if (item.counted !== null && item.counted !== undefined) {
        effectiveQuantity = item.counted; // Use the (potentially just saved) count
        console.log(`[confirmAndFinalizeItem] Using item.counted: ${effectiveQuantity} for item ${itemId}`);
    } else if (item.isUncounted) { // Count is null, and it's flagged uncounted
        effectiveQuantity = 0; // Assume 0 for uncounted items being finalized
        console.log(`[confirmAndFinalizeItem] Item ${itemId} is uncounted, assuming 0 for finalization.`);
        // Update the item's count to 0 as part of finalization
        const updatedItemToZero = await recordOrUpdateCount(itemId, 0, 'finalize_uncounted_as_zero');
        if (updatedItemToZero) {
            item = updatedItemToZero; // item.counted is now 0, item.isUncounted is false
        } else {
            console.error(`[confirmAndFinalizeItem] Failed to record assumed 0 for uncounted item ${itemId}. Cannot finalize properly.`);
            alert(`Error: Could not record a zero count for the uncounted item ${item.SKU}. Finalization halted.`);
            return;
        }
    } else {
        // Count is null, but not flagged as uncounted. This is an edge case, should ideally not happen if UI is correct.
        // This could occur if a count was never entered, and it wasn't a reel with auto-calculation.
        console.warn(`[confirmAndFinalizeItem] Item ${itemId} has null count but not flagged uncounted. Assuming 0 for safety, but this state is unusual.`);
        effectiveQuantity = 0;
        const updatedItemToZeroSafety = await recordOrUpdateCount(itemId, 0, 'finalize_null_as_zero_safety');
        if (updatedItemToZeroSafety) {
            item = updatedItemToZeroSafety;
        } else {
             console.error(`[confirmAndFinalizeItem] Failed to record assumed 0 for null-counted item ${itemId} (safety). Cannot finalize.`);
             alert(`Error: Could not record a zero count for item ${item.SKU} with no count. Finalization halted.`);
             return;
        }
    }
    // effectiveQuantity is now determined. item.counted should reflect this.

    // --- ACTUAL FINALIZATION ---
    item.toCount = false; // Mark as finished for this cycle
    const finalizedCount = item.counted; // This is the definitive count being finalized

    await logTransaction({
        type: 'item_count_finalized', // Use this specific type
        itemId: item.itemId,
        SKU: item.SKU,
        location: item.location,
        details: {
            finalCount: finalizedCount,
            wasUncountedAtFinalizeEntry: item.isUncounted, // isUncounted should be false if count became 0 or was entered
            sequences: { inner1: item.innerSequence, outer1: item.outerSequence, inner2: item.innerSequence2, outer2: item.outerSequence2 },
            notes: item.notes,
            finalizedBy: 'confirm_button'
        }
    });

    await autoSave(); 
    console.log(`Item ${itemId} confirmed & finalized (toCount=false). Finalized count: ${finalizedCount}.`);
    
    updateItemDirtyIndicator(itemId, false); // ++ Ensure dirty indicator is cleared after successful confirm

    applyCurrentFilters(); 
    if (typeof updateSummaryCards === 'function') {
        updateSummaryCards();
    } else {
        console.error("updateSummaryCards function not found after confirming item.");
    }
}
// --- END OF NEW/REFACTORED dataLogic.js -> confirmAndFinalizeItem ---

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
// Needs access to DB functions (getCycleById), getUserIdentifier, and modal functions from uiRenderer.js
async function startNewCount() {
    // 1. Prompt for Cut-off Date
    const cutOffDateStr = prompt("Enter the Cut-off Date for this new count cycle (YYYY-MM-DD):");
    if (!cutOffDateStr) {
        console.log("Start new count cycle cancelled by user (no cut-off date provided).");
        return;
    }

    // 2. Generate Cycle ID
    const cycleId = getCycleIdFromDate(cutOffDateStr); // Assumes getCycleIdFromDate is in dataLogic.js
    if (!cycleId) {
        // Error message handled within getCycleIdFromDate or by alert
        return;
    }

    try {
        // 3. Check if cycle already exists
        console.log(`Checking for existing cycle with ID: ${cycleId}`);
        const existingCycle = await DB.getCycleById(cycleId); // Assumes DB.getCycleById is in offlineDB.js

        if (existingCycle) {
             console.warn(`Cycle ID ${cycleId} already exists (Status: ${existingCycle.status}). Aborting.`);
             alert(`A count cycle for ${cycleId} already exists (Status: ${existingCycle.status}). You cannot start a new cycle with the same Cut-off Date quarter.`);
             return;
        }

        // 4. Open confirmation modal (instead of immediate confirm and cycle creation)
        if (typeof openNewCountConfirmationModal === 'function') {
            openNewCountConfirmationModal(cycleId, cutOffDateStr);
        } else {
            console.error("openNewCountConfirmationModal function not found! Cannot proceed.");
            alert("Error: UI function for confirmation is missing.");
        }

    } catch (error) {
        console.error("Error during startNewCount pre-confirmation process:", error);
        alert(`An error occurred while preparing the new count cycle: ${error.message}`);
    }
} // end of startNewCount

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