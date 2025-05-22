// --- START OF MODIFIED eventHandlers.js ---

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

        // Event Delegation for Inventory List
        const inventoryListContainer = document.getElementById('inventoryList');
        if (inventoryListContainer) {
            inventoryListContainer.addEventListener('click', wrapHandler(handleInventoryListClick, 'inventory list click'));
            inventoryListContainer.addEventListener('change', wrapHandler(handleInventoryListChange, 'inventory list change'));
            inventoryListContainer.addEventListener('input', wrapHandler(handleInventoryListInput, 'inventory list input'));
            inventoryListContainer.addEventListener('keydown', wrapHandler(handleInventoryListKeyDown, 'inventory list keydown')); // ++ NEW LISTENER ++
        } else {
            console.error("Inventory list container #inventoryList not found for delegation.");
        }

        // Event Delegation for Summary Cards
        const summaryCardsContainer = document.querySelector('.summary-cards');
        if (summaryCardsContainer) {
            summaryCardsContainer.addEventListener('click', wrapHandler(handleSummaryCardClick, 'summary card click'));
        } else {
            console.error("Summary cards container .summary-cards not found for delegation.");
        }

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

                    closeNewCountConfirmationModal(); 

                    if (typeof showImportDialog === 'function') {
                        console.log(`Calling showImportDialog from modal. Context: 'new_count', CycleID: ${cycleId}, CutOffDate: ${cutOffDateStr}`);
                        showImportDialog('new_count', cycleId, cutOffDateStr);
                    } else {
                        console.error("showImportDialog function not found! Cannot proceed with import.");
                        alert("Error: Import function is missing. Cannot start new count.");
                    }
                }, 'proceed to select CSV for new count'));
            }
        }

        // Add New Item Modal Listeners
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
                newItemSkuInput.addEventListener('blur', wrapHandler(async () => {
                    const sku = newItemSkuInput.value.trim();
                    if (sku) {
                        await handleSkuCheckInModal(sku);
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
        }

        console.log("Event listeners successfully set up.");
    } catch (error) {
        console.error("Error setting up event listeners:", error);
        alert("An error occurred while setting up UI interactions. Some buttons or actions might not work.");
    }
}

// --- Event Handler Functions ---

function handleSummaryCardClick(event) {
    const clickedCard = event.target.closest('.card');
    if (!clickedCard) return;

    const cardId = clickedCard.id;
    console.log(`Summary card clicked: ${cardId}`);

    currentFilters.location = null;
    currentFilters.searchTerm = '';

    switch (cardId) {
        case 'total-items':
            currentFilters.status = 'all';
            currentFilters.filterByToCountStatus = 'all';
            break;
        case 'active-items':
            currentFilters.status = 'active';
            currentFilters.filterByToCountStatus = 'all';
            break;
        case 'counted-items':
            currentFilters.status = 'active';
            currentFilters.filterByToCountStatus = 'counted';
            break;
        case 'uncounted-items':
            currentFilters.status = 'active';
            currentFilters.filterByToCountStatus = 'to_count';
            break;
        default:
            console.warn(`Unknown summary card ID clicked: ${cardId}`);
            return;
    }

    updateFilterControlsUI();
    applyCurrentFilters();
}

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
    
    const applyValueToInput = (selector, value) => {
        const inputElement = itemDiv.querySelector(selector);
        if (inputElement && !inputElement.disabled) {
             inputElement.value = value;
             inputElement.dispatchEvent(new Event('change', { bubbles: true }));
             return true;
        } else if (!inputElement) { console.error(`Cannot find input '${selector}' in item ${itemId}`); return false; }
          else { console.warn(`Input '${selector}' is disabled.`); return false; }
    };

    if (target.matches('button[data-action="flag-as-uncounted"]')) { 
        console.log("[handleInventoryListClick] 'Flag as Uncounted' button matched.");
        if (typeof flagItemAsUncounted === 'function') { 
            wrapAction(() => flagItemAsUncounted(itemId), `flag item ${itemId} as uncounted`)();
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
    } else if (target.matches('button[data-action="confirm-item"]')) { 
        console.log("[handleInventoryListClick] 'Confirm Item' button matched.");
        if (typeof confirmAndFinalizeItem === 'function') { 
            wrapAction(() => confirmAndFinalizeItem(itemId), `confirm item ${itemId}`)();
        } else {
            console.error("confirmAndFinalizeItem function not found.");
        }
    } else if (target.matches('button[data-action="edit-item"]')) {
        console.log("[handleInventoryListClick] 'Edit Item' button matched.");
        if (typeof flagItemAsUncounted === 'function') {
            wrapAction(() => flagItemAsUncounted(itemId), `edit (re-open) item ${itemId}`)();
        } else {
            console.error("flagItemAsUncounted function (for edit-item) not found.");
        }
    }
} 

function handleInventoryListChange(event) {
    const target = event.target;
    const itemDiv = target.closest('.inventory-item');
    if (!itemDiv) return;
    const itemId = itemDiv.dataset.itemId;

    if (!itemId) {
        console.error("Could not find itemId on inventory item div:", itemDiv);
        return;
    }

    if (target.matches('input[data-type="count-input"]:not(:disabled):not([readonly])')) {
        updateCount(itemId, target.value);
    } else if (target.matches('input[data-sequence]:not(:disabled)')) {
        updateSequences(itemId);
    } else if (target.matches('textarea[data-type="notes-input"]:not(:disabled)')) {
        updateItemNotes(itemId, target.value);
    }
}

function handleInventoryListInput(event) {
    const target = event.target;
    const itemDiv = target.closest('.inventory-item');
    if (!itemDiv) return;
    const itemId = itemDiv.dataset.itemId;

    if (!itemId) {
        console.error("[handleInventoryListInput] Could not find itemId on inventory item div:", itemDiv);
        return;
    }

    findInventoryItemByItemId(itemId).then(itemInMemory => {
        if (!itemInMemory) return;

        let isFieldDirty = false;
        if (target.matches('input[data-type="count-input"]:not(:disabled)')) {
            const currentValInInput = target.value.trim();
            const valInMemory = (itemInMemory.counted === null || itemInMemory.counted === undefined) ? '' : String(itemInMemory.counted);
            isFieldDirty = currentValInInput !== valInMemory;
        } else if (target.matches('input[data-sequence]:not(:disabled)')) {
            const seqType = target.dataset.sequence;
            const currentValInInput = target.value.trim();
            let valInMemory = '';
            switch(seqType) {
                case 'inner': valInMemory = itemInMemory.innerSequence; break;
                case 'outer': valInMemory = itemInMemory.outerSequence; break;
                case 'inner2': valInMemory = itemInMemory.innerSequence2; break;
                case 'outer2': valInMemory = itemInMemory.outerSequence2; break;
            }
            valInMemory = valInMemory ?? '';
            isFieldDirty = currentValInInput !== valInMemory;
        } else if (target.matches('textarea[data-type="notes-input"]:not(:disabled)')) {
            const currentValInInput = target.value;
            const valInMemory = itemInMemory.notes ?? '';
            isFieldDirty = currentValInInput !== valInMemory;
        }
        
        if(isFieldDirty) {
            updateItemDirtyIndicator(itemId, true);
        }
    });
}

// ++ NEW EVENT HANDLER for KeyDown events on inventory items ++
async function handleInventoryListKeyDown(event) {
    const target = event.target;
    const itemDiv = target.closest('.inventory-item');
    if (!itemDiv) return;

    const itemId = itemDiv.dataset.itemId;
    if (!itemId) {
        console.error("[handleInventoryListKeyDown] Could not find itemId on inventory item div:", itemDiv);
        return;
    }

    // Check if the item is active and toCount, otherwise "Enter to confirm" shouldn't apply
    const itemData = await findInventoryItemByItemId(itemId);
    if (!itemData || !itemData.isActive || !itemData.toCount) {
        // console.log(`[handleInventoryListKeyDown] Item ${itemId} is not active or not 'toCount'. Enter/Shift+Enter to confirm is disabled.`);
        return;
    }

    const isQuantityInput = target.matches('input[data-type="count-input"]');
    const isSequenceInput = target.matches('input[data-sequence]');
    const isNotesTextarea = target.matches('textarea[data-type="notes-input"]');

    if (event.key === 'Enter') {
        if (!event.shiftKey && (isQuantityInput || isSequenceInput)) {
            // Standard Enter key for quantity or sequence inputs
            event.preventDefault();
            console.log(`[handleInventoryListKeyDown] Enter pressed on Qty/Seq for item ${itemId}. Confirming.`);
            if (typeof confirmAndFinalizeItem === 'function') {
                // Using wrapAction here is appropriate if confirmAndFinalizeItem doesn't inherently handle its own top-level errors for UI feedback
                // However, since confirmAndFinalizeItem is a major data logic function, it likely does.
                // For simplicity, we call it directly as it's an intended user action pathway.
                // The wrapHandler on the keydown listener itself provides basic error catching.
                confirmAndFinalizeItem(itemId);
            } else {
                console.error("confirmAndFinalizeItem function not found.");
            }
        } else if (event.shiftKey && isNotesTextarea) {
            // Shift+Enter for notes textarea
            event.preventDefault();
            console.log(`[handleInventoryListKeyDown] Shift+Enter pressed on Notes for item ${itemId}. Saving notes and confirming.`);
            
            if (typeof updateItemNotes === 'function') {
                await updateItemNotes(itemId, target.value); // Ensure notes are saved first
            } else {
                console.error("updateItemNotes function not found. Cannot save notes before confirming.");
                // Potentially alert user or skip confirmation if notes save is critical
            }

            if (typeof confirmAndFinalizeItem === 'function') {
                confirmAndFinalizeItem(itemId);
            } else {
                console.error("confirmAndFinalizeItem function not found.");
            }
        }
        // If it's just "Enter" in notes textarea and not Shift+Enter, default behavior (newline) occurs.
    }
}
// --- END OF NEW EVENT HANDLER ---

function openAddNewItemModal() {
    const modal = document.getElementById('addNewItemModal');
    if (modal) {
        document.getElementById('addNewItemForm').reset();
        resetSkuCheckUIState();
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
    reelNumberInput.required = isReelType && (document.getElementById('newSkuDetailsSection').style.display === 'block' || document.getElementById('existingSkuDetails').style.display !== 'none');
    reelNumberMandatorySpan.style.display = reelNumberInput.required ? 'inline' : 'none';

    if (document.getElementById('newSkuDetailsSection').style.display === 'block') {
        footageFactorGroup.style.display = isReelType ? 'block' : 'none';
        document.getElementById('newItemFootageFactor').required = false;
    } else {
        footageFactorGroup.style.display = 'none';
    }
}

function resetSkuCheckUIState() {
    document.getElementById('skuCheckMessage').textContent = '';
    document.getElementById('skuCheckMessage').className = 'form-text';
    document.getElementById('existingSkuDetails').style.display = 'none';
    document.getElementById('revealNewSkuDetailsBtn').style.display = 'none';
    document.getElementById('newSkuDetailsSection').style.display = 'none';
    document.getElementById('newItemType').required = false;
    
    document.getElementById('newItemReelNumberGroup').style.display = 'none';
    document.getElementById('newItemReelNumber').required = false;
    document.getElementById('reelNumberMandatory').style.display = 'none';
    document.getElementById('reelCheckMessage').textContent = '';

    document.getElementById('newItemFootageFactorGroup').style.display = 'none';
    document.getElementById('submitAddItemBtn').disabled = false;
    document.getElementById('existingSkuDesc').textContent = '';
    document.getElementById('existingSkuType').textContent = '';
}
// --- END OF MODIFIED eventHandlers.js ---