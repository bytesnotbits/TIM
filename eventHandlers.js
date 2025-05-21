// --- Event Listener Setup ---
// Needs access to wrapAction/wrapHandler (stateManager.js)
// Needs access to action functions (dataLogic.js, importExport.js)
// Needs access to UI functions (uiRenderer.js)
function setupEventListeners() {
    console.log("setupEventListeners: DOM should be ready. Attempting to get elements...");
    try { // try starts here
        // Hamburger Menu
        const hamburgerButton = document.getElementById('hamburger-button');
        const navMenu = document.getElementById('nav-menu');
        if (hamburgerButton && navMenu) {
            hamburgerButton.addEventListener('click', () => navMenu.classList.toggle('active'));
            navMenu.addEventListener('click', (e) => {
                if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') { // Close on link or button click
                    navMenu.classList.remove('active');
                }
            });
        }
        // Define debounce function
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func.apply(this, args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }

        // Search Input (uses debounce)
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', debounce(wrapHandler(() => {
                applyCurrentFiltersFromUI(); // Use new function on search input
            }, 'search input'), 300));
        }

        // User Identifier
        document.getElementById('userIdentifierInput')?.addEventListener('input', (event) => {
            updateUserIdentifier(event.target.value);
        });

        // Quick Actions & Header Buttons
        document.getElementById('start-new-count-btn')?.addEventListener('click', wrapAction(startNewCount, 'start new count'));
        document.getElementById('import-csv-btn')?.addEventListener('click', () => wrapAction(() => showImportDialog('update'), 'import CSV')()); // Ensure 'update' context for generic import
        document.getElementById('export-csv-btn')?.addEventListener('click', () => wrapAction(() => exportCSV(database.inventory), 'export CSV')());
        document.getElementById('export-pdf-btn')?.addEventListener('click', () => wrapAction(() => exportPDF(currentInventory), 'export PDF')()); // Export filtered data
        document.getElementById('finalize-inventory-btn')?.addEventListener('click', wrapAction(finalizeInventory, 'finalize inventory'));
        document.getElementById('add-new-item-btn')?.addEventListener('click', wrapHandler(openAddNewItemModal, 'open add new item modal')); // Add New Item Button

        // Filters (Manual)
        document.getElementById('apply-filters-btn')?.addEventListener('click', wrapAction(applyCurrentFiltersFromUI, 'apply manual filters')); // Use new function for manual apply
        document.getElementById('clear-filters-btn')?.addEventListener('click', wrapAction(clearAllFilters, 'clear filters'));
        document.getElementById('locationFilterInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') wrapAction(applyCurrentFiltersFromUI, 'apply manual filters')(); // Use new function
        });
        document.getElementById('statusFilterSelect')?.addEventListener('change', wrapAction(applyCurrentFiltersFromUI, 'apply manual filters')); // Use new function

        // History View Toggles
        document.getElementById('view-history-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            wrapAction(() => toggleHistoryView(true), 'show all history')();
        });
        document.getElementById('close-history-btn')?.addEventListener('click', () => {
            wrapAction(() => toggleHistoryView(false), 'hide all history')();
        });

        // Item History Modal Close Button
        document.getElementById('itemHistoryModalClose')?.addEventListener('click', wrapAction(closeItemHistoryModal, 'close item history modal'));
        document.getElementById('itemHistoryModal')?.addEventListener('click', (event) => {
            if (event.target === event.currentTarget) {
                wrapAction(closeItemHistoryModal, 'close item history modal')();
            }
        });

        // Event Delegation for Inventory List (Assuming this was intended to be here, from original file)
        const inventoryListContainer = document.getElementById('inventoryList');
        if (inventoryListContainer) {
            inventoryListContainer.addEventListener('click', wrapHandler(handleInventoryListClick, 'inventory list click'));
            inventoryListContainer.addEventListener('change', wrapHandler(handleInventoryListChange, 'inventory list change'));
            inventoryListContainer.addEventListener('input', wrapHandler(handleInventoryListInput, 'inventory list input'));
        } else {
            console.error("Inventory list container #inventoryList not found for delegation.");
        }

        // Event Delegation for Summary Cards (Assuming this was intended to be here, from original file)
        const summaryCardsContainer = document.querySelector('.summary-cards');
        if (summaryCardsContainer) {
            summaryCardsContainer.addEventListener('click', wrapHandler(handleSummaryCardClick, 'summary card click'));
        } else {
            console.error("Summary cards container .summary-cards not found for delegation.");
        }

        // Item Modal Listeners
        // New Count Confirmation Modal Listeners
        const newCountModal = document.getElementById('newCountConfirmationModal');
        if (newCountModal) {
            document.getElementById('newCountConfirmationModalClose')?.addEventListener('click', wrapHandler(closeNewCountConfirmationModal, 'close new count confirmation by X'));
            document.getElementById('cancelNewCountBtn')?.addEventListener('click', wrapHandler(closeNewCountConfirmationModal, 'cancel new count confirmation'));
            
            newCountModal.addEventListener('click', (event) => { // Close on backdrop click
                if (event.target === newCountModal) {
                    wrapHandler(closeNewCountConfirmationModal, 'close new count confirmation by backdrop')();
                }
            });

            const proceedToSelectCsvBtn = document.getElementById('proceedToSelectCsvBtn');
            if (proceedToSelectCsvBtn) {
                proceedToSelectCsvBtn.addEventListener('click', wrapHandler(async () => {
                    const cycleId = proceedToSelectCsvBtn.dataset.cycleId || newCountModal.dataset.cycleId;
                    const cutOffDateStr = proceedToSelectCsvBtn.dataset.cutOffDate || newCountModal.dataset.cutOffDate;

                    if (!cycleId || !cutOffDateStr) {
                        console.error("Could not retrieve cycleId or cutOffDateStr from modal for CSV import.");
                        alert("Error: Missing cycle information to proceed with import.");
                        return;
                    }

                    closeNewCountConfirmationModal(); // Close this modal first

                    // Now call showImportDialog, which handles the file input click
                    if (typeof showImportDialog === 'function') {
                        console.log(`Calling showImportDialog from modal. Context: 'new_count', CycleID: ${cycleId}, CutOffDate: ${cutOffDateStr}`);
                        // showImportDialog itself is async and will handle its own errors
                        showImportDialog('new_count', cycleId, cutOffDateStr);
                    } else {
                        console.error("showImportDialog function not found! Cannot proceed with import.");
                        alert("Error: Import function is missing. Cannot start new count.");
                    }
                }, 'proceed to select CSV for new count'));
            }
        }
        // End New Count Confirmation Modal Listeners

        const addNewItemModal = document.getElementById('addNewItemModal');
        if (addNewItemModal) {
            document.getElementById('addNewItemModalClose')?.addEventListener('click', wrapHandler(closeAddNewItemModal, 'close add new item modal by X'));
            document.getElementById('cancelAddItemBtn')?.addEventListener('click', wrapHandler(closeAddNewItemModal, 'cancel add new item'));
            
            addNewItemModal.addEventListener('click', (event) => { // Close on backdrop click
                if (event.target === addNewItemModal) {
                    wrapHandler(closeAddNewItemModal, 'close add new item modal by backdrop')();
                }
            });

            const newItemSkuInput = document.getElementById('newItemSku');
            if (newItemSkuInput) {
                newItemSkuInput.addEventListener('blur', wrapHandler(async () => { // Async because DB.findItemsBySku is async
                    const sku = newItemSkuInput.value.trim();
                    if (sku) { // Only check if SKU is not empty
                        await handleSkuCheckInModal(sku); // In dataLogic.js
                    } else {
                        resetSkuCheckUIState(); 
                    }
                }, 'SKU input blur for add new item'));
            }
            
            document.getElementById('newItemLocation')?.addEventListener('blur', wrapHandler(async () => {
                const sku = document.getElementById('newItemSku').value.trim();
                const reelNumber = document.getElementById('newItemReelNumber').value.trim();
                const location = document.getElementById('newItemLocation').value.trim();
                if (document.getElementById('newItemReelNumberGroup').style.display !== 'none' && sku && reelNumber && location) {
                    await checkReelDuplicateInModal(sku, reelNumber, location); 
                }
            }, 'Location input blur for add new item'));

            document.getElementById('newItemReelNumber')?.addEventListener('blur', wrapHandler(async () => {
                const sku = document.getElementById('newItemSku').value.trim();
                const reelNumber = document.getElementById('newItemReelNumber').value.trim();
                const location = document.getElementById('newItemLocation').value.trim();
                 if (document.getElementById('newItemReelNumberGroup').style.display !== 'none' && sku && reelNumber && location) {
                    await checkReelDuplicateInModal(sku, reelNumber, location); 
                }
            }, 'Reel Number input blur for add new item'));


            document.getElementById('revealNewSkuDetailsBtn')?.addEventListener('click', wrapHandler(() => {
                document.getElementById('newSkuDetailsSection').style.display = 'block';
                document.getElementById('revealNewSkuDetailsBtn').style.display = 'none'; 
                document.getElementById('newItemType').required = true; 
                updateModalFieldsBasedOnItemType(); 
            }, 'reveal new SKU details'));

            document.getElementById('newItemType')?.addEventListener('change', wrapHandler(updateModalFieldsBasedOnItemType, 'item type change in add new item modal'));
            
            document.getElementById('addNewItemForm')?.addEventListener('submit', wrapHandler(async (event) => {
                event.preventDefault();
                await processAddItemForm(); 
            }, 'submit add new item form'));
        } // End of if (addNewItemModal)

        console.log("Event listeners successfully set up."); // This should be the last line inside the try block
    } catch (error) { // ++ THIS CATCH BLOCK WAS MISSING ++
        console.error("Error setting up event listeners:", error);
        alert("An error occurred while setting up UI interactions. Some buttons or actions might not work.");
    } // End of catch block
} // End of setupEventListeners function

// --- Event Handler Functions ---
// Needs applyCurrentFilters, updateFilterControlsUI (dataLogic.js)
function handleSummaryCardClick(event) {
    const clickedCard = event.target.closest('.card');
    if (!clickedCard) return; // Click wasn't on a card or its descendant

    const cardId = clickedCard.id;
    console.log(`Summary card clicked: ${cardId}`);

    // Reset manual filters when using quick filters
    currentFilters.location = null;
    currentFilters.searchTerm = '';

    // Set filters based on card ID
    switch (cardId) {
        case 'total-items':
            currentFilters.status = 'all';
            currentFilters.filterByToCountStatus = 'all';
            break;
        case 'active-items':
            currentFilters.status = 'active';
            currentFilters.filterByToCountStatus = 'all';
            break;
        case 'counted-items': // Shows 'finished' items for this cycle
            currentFilters.status = 'active';
            currentFilters.filterByToCountStatus = 'counted'; // Items with toCount: false
            break;
        case 'uncounted-items': // Shows items 'to count' (default view)
            currentFilters.status = 'active';
            currentFilters.filterByToCountStatus = 'to_count'; // Items with toCount: true
            break;
        default:
            console.warn(`Unknown summary card ID clicked: ${cardId}`);
            return; // Do nothing if ID is unrecognized
    }

    // Update the UI filter controls to match the quick filter state
    updateFilterControlsUI();

    // Apply the filters and re-render
    applyCurrentFilters();
}

// Needs flagUncounted, findInventoryItemByItemId, finalizeSingleItem (dataLogic.js)
// Needs showItemHistory (uiRenderer.js)
// Needs wrapAction (stateManager.js)
/* function handleInventoryListClick(event) {
    const target = event.target;
    const itemDiv = target.closest('.inventory-item');
    if (!itemDiv) return;
    const itemId = itemDiv.dataset.itemId;

    console.log("[handleInventoryListClick] Click detected on itemDiv, itemId:", itemId); 
    console.log("[handleInventoryListClick] Clicked target element:", target); 

    if (!itemId) {
        console.error("Could not find itemId on inventory item div:", itemDiv);
        return;
    }

    const applyValueToInput = (selector, value) => {
        // ... (this helper remains the same)
        const inputElement = itemDiv.querySelector(selector);
        if (inputElement && !inputElement.disabled) {
             console.log(`Applying value '${value}' to input '${selector}' for item ${itemId}`);
             inputElement.value = value;
             console.log(`Dispatching 'change' event for input '${selector}'`);
             inputElement.dispatchEvent(new Event('change', { bubbles: true }));
             return true;
        } else if (!inputElement) { console.error(`Cannot find input '${selector}' in item ${itemId}`); return false; }
          else { console.warn(`Input '${selector}' is disabled.`); return false; }
    };

    // ----- THIS IS THE PART TO UPDATE -----
    if (target.matches('button[data-action="flag-as-uncounted"]')) { // Match the latest button action
        console.log("[handleInventoryListClick] 'Flag as Uncounted' button matched.");
        if (typeof flagItemAsUncounted === 'function') { // Call the latest function name
            flagItemAsUncounted(itemId);
        } else {
            console.error("flagItemAsUncounted function not found.");
        }
    // ----- END OF UPDATE -----
    } else if (target.matches('button[data-action="view-history"]')) {
        console.log("[handleInventoryListClick] 'View History' button matched.");
        findInventoryItemByItemId(itemId).then(item => {
            const displaySku = item ? item.SKU : itemDiv.dataset.sku;
            const displayDesc = item ? item.Description : 'Unknown Description';
            if (!itemId) {
                 console.error("Cannot show history: Item ID is missing.");
                 alert("Error: Could not identify the item to show history for.");
                 return;
            }
            console.log(`[handleInventoryListClick] Calling showItemHistory with ItemID: ${itemId} (SKU: ${displaySku})`);
            showItemHistory(itemId, displaySku, displayDesc);
        }).catch(err => {
            console.error(`Error finding item ${itemId} before showing history:`, err);
             alert("Error retrieving item details. Cannot show history.");
        });
    } else if (target.matches('span[data-action="apply-sequence"]')) {
        console.log("[handleInventoryListClick] 'Apply Sequence' span matched.");
        const sequenceType = target.dataset.sequenceType;
        const sequenceValue = target.dataset.sequenceValue;
        if (sequenceType && sequenceValue !== undefined) {
             applyValueToInput(`input[data-sequence="${sequenceType}"]`, sequenceValue);
        } else {
            console.error("Missing sequence type or value on clicked span:", target);
        }
    } else if (target.matches('span[data-action="apply-expected-qty"]')) {
         console.log("[handleInventoryListClick] 'Apply Expected Qty' span matched.");
         const expectedValue = target.dataset.value;
         if (expectedValue !== undefined) {
             applyValueToInput('input[data-type="count-input"]', expectedValue);
         } else {
              console.error("Missing expected quantity value on clicked span:", target);
         }
    } else if (target.matches('button[data-action="finalize-item"]')) {
        console.log("[handleInventoryListClick] 'Finalize Item' button matched.");
        wrapAction(() => finalizeSingleItem(itemId), `finalize item ${itemId}`)();
    }
} // end of handleInventoryListClick
 */

// --- START OF MODIFIED eventHandlers.js -> handleInventoryListClick ---
function handleInventoryListClick(event) {
    const target = event.target;
    const itemDiv = target.closest('.inventory-item');
    if (!itemDiv) return;
    const itemId = itemDiv.dataset.itemId;

    console.log("[handleInventoryListClick] Click detected on itemDiv, itemId:", itemId); 
    console.log("[handleInventoryListClick] Clicked target element:", target); 

    if (!itemId) {
        console.error("Could not find itemId on inventory item div:", itemDiv);
        return;
    }
    
    if (target.matches('button[data-action="flag-as-uncounted"]')) { 
        console.log("[handleInventoryListClick] 'Flag as Uncounted' button matched.");
        if (typeof flagItemAsUncounted === 'function') { 
            wrapAction(() => flagItemAsUncounted(itemId), `flag item ${itemId} as uncounted`)(); // Added wrapAction
        } else {
            console.error("flagItemAsUncounted function not found.");
        }
    } else if (target.matches('button[data-action="view-history"]')) {
        // ... (view-history logic remains the same) ...
    } else if (target.matches('span[data-action="apply-sequence"]')) {
        // ... (apply-sequence logic remains the same) ...
    } else if (target.matches('span[data-action="apply-expected-qty"]')) {
        // ... (apply-expected-qty logic remains the same) ...
    } else if (target.matches('button[data-action="confirm-item"]')) { 
        console.log("[handleInventoryListClick] 'Confirm Item' button matched.");
        if (typeof confirmAndFinalizeItem === 'function') { 
            wrapAction(() => confirmAndFinalizeItem(itemId), `confirm item ${itemId}`)();
        } else {
            console.error("confirmAndFinalizeItem function not found.");
            // Fallback for safety, though confirmAndFinalizeItem should exist
            if (typeof finalizeSingleItem === 'function') {
                 console.warn("confirmAndFinalizeItem not found, using old finalizeSingleItem.");
                 wrapAction(() => finalizeSingleItem(itemId), `fallback finalize item ${itemId}`)();
            }
        }
    } else if (target.matches('button[data-action="edit-item"]')) { // ++ NEW HANDLER
        console.log("[handleInventoryListClick] 'Edit Item' button matched.");
        // "Editing" a finished item means re-opening it, which is what flagItemAsUncounted does.
        if (typeof flagItemAsUncounted === 'function') {
            wrapAction(() => flagItemAsUncounted(itemId), `edit (re-open) item ${itemId}`)();
        } else {
            console.error("flagItemAsUncounted function (for edit-item) not found.");
        }
    }
} 
// --- END OF MODIFIED eventHandlers.js -> handleInventoryListClick ---

    /*
    if (!itemId) {
        console.error("Could not find itemId on inventory item div:", itemDiv);
        return;
    }

    const applyValueToInput = (selector, value) => {
        const inputElement = itemDiv.querySelector(selector);
        if (inputElement && !inputElement.disabled) {
             console.log(`Applying value '${value}' to input '${selector}' for item ${itemId}`);
             inputElement.value = value;
             console.log(`Dispatching 'change' event for input '${selector}'`);
             inputElement.dispatchEvent(new Event('change', { bubbles: true }));
             return true;
        } else if (!inputElement) { console.error(`Cannot find input '${selector}' in item ${itemId}`); return false; }
          else { console.warn(`Input '${selector}' is disabled.`); return false; }
    };

    if (target.matches('button[data-action="flag-as-uncounted"]')) { 
        console.log("[handleInventoryListClick] 'Flag as Uncounted' button matched.");
        if (typeof flagItemAsUncounted === 'function') { 
            flagItemAsUncounted(itemId);
        } else {
            console.error("flagItemAsUncounted function not found.");
        }
    } else if (target.matches('button[data-action="view-history"]')) {
        console.log("[handleInventoryListClick] 'View History' button matched.");
        findInventoryItemByItemId(itemId).then(item => {
            const displaySku = item ? item.SKU : itemDiv.dataset.sku;
            const displayDesc = item ? item.Description : 'Unknown Description';
            if (!itemId) {
                 console.error("Cannot show history: Item ID is missing.");
                 alert("Error: Could not identify the item to show history for.");
                 return;
            }
            console.log(`[handleInventoryListClick] Calling showItemHistory with ItemID: ${itemId} (SKU: ${displaySku})`);
            showItemHistory(itemId, displaySku, displayDesc);
        }).catch(err => {
            console.error(`Error finding item ${itemId} before showing history:`, err);
             alert("Error retrieving item details. Cannot show history.");
        });
    } else if (target.matches('span[data-action="apply-sequence"]')) {
        console.log("[handleInventoryListClick] 'Apply Sequence' span matched.");
        const sequenceType = target.dataset.sequenceType;
        const sequenceValue = target.dataset.sequenceValue;
        if (sequenceType && sequenceValue !== undefined) {
             applyValueToInput(`input[data-sequence="${sequenceType}"]`, sequenceValue);
        } else {
            console.error("Missing sequence type or value on clicked span:", target);
        }
    } else if (target.matches('span[data-action="apply-expected-qty"]')) {
         console.log("[handleInventoryListClick] 'Apply Expected Qty' span matched.");
         const expectedValue = target.dataset.value;
         if (expectedValue !== undefined) {
             applyValueToInput('input[data-type="count-input"]', expectedValue);
         } else {
              console.error("Missing expected quantity value on clicked span:", target);
         }
    } else if (target.matches('button[data-action="confirm-item"]')) { // ++ UPDATED data-action
        console.log("[handleInventoryListClick] 'Confirm Item' button matched.");
        // The actual logic for confirm will be in a new/modified function in dataLogic.js
        // For now, let's assume finalizeSingleItem (or a new function) handles the "Confirm" action
        if (typeof confirmAndFinalizeItem === 'function') { // We'll create/rename this function later
            wrapAction(() => confirmAndFinalizeItem(itemId), `confirm item ${itemId}`)();
        } else if (typeof finalizeSingleItem === 'function') { // Fallback if we haven't renamed yet
             console.warn("confirmAndFinalizeItem not found, using finalizeSingleItem as placeholder for confirm action.");
            wrapAction(() => finalizeSingleItem(itemId), `finalize item ${itemId} (acting as confirm)`)();
        } else {
            console.error("No function found to handle 'confirm-item' action.");
        }
    }
} 
// --- END OF MODIFIED eventHandlers.js -> handleInventoryListClick ---
*/
/*
Event Handler Update for "Confirm" Button:
Updated the event handler in eventHandlers.js to match the new data-action="confirm-item".

*/


// Needs updateCount, updateSequences, updateItemNotes (dataLogic.js)
function handleInventoryListChange(event) {
    const target = event.target;
    const itemDiv = target.closest('.inventory-item');
    if (!itemDiv) return;
    const itemId = itemDiv.dataset.itemId; // <-- GET itemId

    // Add a check to ensure itemId was found
    if (!itemId) {
        console.error("Could not find itemId on inventory item div:", itemDiv);
        return;
    }

    if (target.matches('input[data-type="count-input"]:not(:disabled):not([readonly])')) {
        updateCount(itemId, target.value); // <-- PASS itemId
    } else if (target.matches('input[data-sequence]:not(:disabled)')) { // Matches inner, outer, inner2, outer2
        updateSequences(itemId); // <-- PASS itemId
    } else if (target.matches('textarea[data-type="notes-input"]:not(:disabled)')) { // <-- Use 'change' for notes
        updateItemNotes(itemId, target.value); // <-- PASS itemId
    }
}

// handleInventoryListInput is no longer needed for notes if using 'change' event
function handleInventoryListInput(event) {
    // Potentially handle other 'input' events here if needed in the future
    // For now, it can be empty or removed if only notes were using it.
    // console.log("Input event triggered:", event.target);
}

// ++ NEW: Functions to manage Add New Item Modal UI (could also go in uiRenderer.js) ++
function openAddNewItemModal() {
    const modal = document.getElementById('addNewItemModal');
    if (modal) {
        document.getElementById('addNewItemForm').reset(); // Clear previous entries
        resetSkuCheckUIState(); // Reset all dynamic parts of the modal to initial state
        modal.style.display = 'block';
        document.getElementById('newItemSku').focus();
        console.log("Add New Item Modal opened.");
    }
}

function closeAddNewItemModal() {
    const modal = document.getElementById('addNewItemModal');
    if (modal) {
        modal.style.display = 'none';
        console.log("Add New Item Modal closed.");
    }
}

function updateModalFieldsBasedOnItemType() {
    const itemType = document.getElementById('newItemType').value;
    const reelNumberGroup = document.getElementById('newItemReelNumberGroup');
    const footageFactorGroup = document.getElementById('newItemFootageFactorGroup');
    const reelNumberInput = document.getElementById('newItemReelNumber');
    const reelNumberMandatorySpan = document.getElementById('reelNumberMandatory');

    const isReelType = itemType === 'Reel' || itemType === 'Two-Way Reel';

    reelNumberGroup.style.display = isReelType ? 'block' : 'none';
    reelNumberInput.required = isReelType && (document.getElementById('newSkuDetailsSection').style.display === 'block' || document.getElementById('existingSkuDetails').style.display !== 'none'); // Mandatory if reel type and either creating new or adding existing reel
    reelNumberMandatorySpan.style.display = reelNumberInput.required ? 'inline' : 'none';


    // Footage Factor is only relevant when defining *new* SKU details
    if (document.getElementById('newSkuDetailsSection').style.display === 'block') {
        footageFactorGroup.style.display = isReelType ? 'block' : 'none';
        document.getElementById('newItemFootageFactor').required = false; // Footage factor not strictly mandatory for creation
    } else {
        footageFactorGroup.style.display = 'none'; // Hide if not creating new SKU details
    }
}


// Function to reset all dynamic parts of the modal UI
function resetSkuCheckUIState() {
    document.getElementById('skuCheckMessage').textContent = '';
    document.getElementById('skuCheckMessage').className = 'form-text';
    document.getElementById('existingSkuDetails').style.display = 'none';
    document.getElementById('revealNewSkuDetailsBtn').style.display = 'none';
    document.getElementById('newSkuDetailsSection').style.display = 'none';
    document.getElementById('newItemType').required = false; // Not required if not defining new SKU
    
    document.getElementById('newItemReelNumberGroup').style.display = 'none';
    document.getElementById('newItemReelNumber').required = false;
    document.getElementById('reelNumberMandatory').style.display = 'none';
    document.getElementById('reelCheckMessage').textContent = '';


    document.getElementById('newItemFootageFactorGroup').style.display = 'none';
    document.getElementById('submitAddItemBtn').disabled = false; // Re-enable submit by default, validation will catch issues
    // Clear specific fields that might have been populated
    document.getElementById('existingSkuDesc').textContent = '';
    document.getElementById('existingSkuType').textContent = '';
    // Do not reset SKU, Location, Description inputs as user might be editing them
}