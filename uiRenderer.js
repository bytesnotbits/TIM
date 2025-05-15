// Helper to display critical init errors
function displayInitializationError(message) {
    const container = document.getElementById('initialization-error-container'); // Get the initialization-error-container element
    if (container) {
        container.innerHTML = `<div class="error-message">${message}</div>`; // Display the error message
        container.style.display = 'block'; // Ensure the container is visible
    }
    // Disable buttons if init fails
    document.querySelectorAll('.quick-actions button, header button, .filter-controls button').forEach(btn => btn.disabled = true); // Disable all buttons
} // End of displayInitializationError

// Helper to display non-critical errors within specific containers
function displayError(message, containerElement) {
    if (containerElement) { // Check if containerElement is provided
        containerElement.innerHTML = `<p class="error-message" style="margin: 0;">${message}</p>`; // Display the error message
        containerElement.style.display = 'block'; // Ensure the container is visible
    } else {
        console.warn("Attempted to display error, but containerElement was not provided or found."); // Log a warning if the container is not found
    }
} // End of displayError

// --- Inventory List Rendering ---
function renderInventoryList() {
    const container = document.getElementById('inventoryList');
    if (!container) { console.error("Inventory list container not found."); return; }

    try { // Outer try block for the whole function
        container.innerHTML = ''; // Clear previous list
        const fragment = document.createDocumentFragment();

        // Use currentInventory (filtered list) from stateManager.js
        if (!currentInventory || currentInventory.length === 0) {
            let message = 'No items match the current criteria.';
            const hasActiveFilters = currentFilters.location || currentFilters.searchTerm || currentFilters.status !== 'active' || currentFilters.filterByToCountStatus !== 'to_count';

            // Use database.inventory from stateManager.js for total check
            if (!database.inventory || database.inventory.length === 0) {
                message = 'Inventory is empty. Import a CSV to begin.';
            } else if (!hasActiveFilters && !database.inventory.some(item => item.isActive && item.toCount)) {
                 message = 'No items currently marked "To Count". Start a new count cycle or use the Summary Card filters to view other items (e.g., "Counted", "Active", "Total").';
            } else {
                message = 'No items match: ';
                let filterParts = [];
                if (currentFilters.location) filterParts.push(`Location="${currentFilters.location}"`);
                if (currentFilters.searchTerm) filterParts.push(`Search="${currentFilters.searchTerm}"`);
                if (currentFilters.status !== 'all') filterParts.push(`Status="${currentFilters.status}"`);

                switch (currentFilters.filterByToCountStatus) {
                    case 'counted': filterParts.push("View='Finished Items'"); break;
                    case 'to_count': filterParts.push("View='Items To Count'"); break;
                    case 'all': filterParts.push("View='All Items'"); break;
                    default: break; // Should not happen, but good practice
                }
                message += filterParts.join(', ');
                 if (currentFilters.filterByToCountStatus === 'to_count') {
                     message += ". Try the 'Counted' card to see finished items, or 'Active'/'Total' for broader views.";
                 } else if (currentFilters.filterByToCountStatus === 'counted') {
                      message += ". Try the 'Uncounted' card to see items still needing count, or 'Active'/'Total'.";
                 } else if (currentFilters.filterByToCountStatus === 'all' && currentFilters.status === 'active') {
                     message += ". Try the 'Total Items' card to include inactive items.";
                 }
            }
            container.innerHTML = `<p>${message}</p>`;
            return; // Exit function if no items to render
        }

        currentInventory.forEach(item => {
            // Inner try...catch for rendering a single item
            try {
                if (!item || !item.itemId) { // Add a check for valid item object
                    console.warn("Skipping rendering of invalid item object:", item);
                    throw new Error("Invalid item data encountered during render.");
                }

                const itemDiv = document.createElement('div');
                itemDiv.className = 'inventory-item';
                itemDiv.dataset.sku = item.SKU;
                itemDiv.dataset.itemId = item.itemId;

                // --- Status classes ---
                 if (!item.isActive) {
                     itemDiv.classList.add('is-inactive');
                 } else if (item.toCount) {
                     itemDiv.classList.add('is-tocount');
                     if (item.isUncounted) {
                         itemDiv.classList.add('is-uncounted');
                     }
                 } else {
                     itemDiv.classList.add('is-finished');
                     if (!item.isUncounted && item.counted !== null) {
                         itemDiv.classList.add('is-counted');
                     }
                 }
                if (item.isReel) itemDiv.classList.add('is-reel');
                if (item.isTwoWayReel) itemDiv.classList.add('is-two-way-reel');

                // --- Create Columns ---
                const columns = {};
                columns.details = document.createElement('div');
                columns.count = document.createElement('div');
                columns.sequences1 = document.createElement('div');
                columns.sequences2 = document.createElement('div');
                columns.notes = document.createElement('div');
                columns.actions = document.createElement('div');
                columns.details.className = 'item-details';
                columns.count.className = 'item-count';
                columns.sequences1.className = 'item-sequences seq-pair-1';
                columns.sequences2.className = 'item-sequences seq-pair-2';
                columns.notes.className = 'item-notes';
                columns.actions.className = 'item-actions';

                // --- Populate Details Column ---
                const reelInfo = item.isReel ? ` (Reel${item.reelNumber ? `: ${item.reelNumber}` : ''}${item.isTwoWayReel ? ', 2-Way' : ''})` : '';
                const toCountIndicator = item.toCount ? `<span class="tocount-indicator" title="Marked for current count cycle">🎯</span>` : '';
                const finishedIndicator = !item.toCount && item.isActive ? `<span class="finished-indicator" title="Finished for cycle (Count: ${item.counted ?? 'Uncounted'})">✔️</span>` : '';
                const inactiveIndicator = !item.isActive ? '<span class="inactive-indicator" title="Inactive Item">🚫</span>' : '';
                const recountBatchIndicator = item.currentRecountBatchId ? `<div class="item-recount-batch" style="font-size: 0.8em; color: var(--warning-color); font-weight: bold;">Recount Batch: ${item.currentRecountBatchId}</div>` : '';

                columns.details.innerHTML = `
                    <div class="item-sku">
                         ${inactiveIndicator} ${item.isActive ? (item.toCount ? toCountIndicator : finishedIndicator) : ''}
                        ${item.SKU}${reelInfo}
                    </div>
                    <div class="item-desc">${item.Description || 'N/A'}</div>
                    <div class="item-loc">Loc: ${item.location || 'N/A'}</div>
                    <div class="item-id" style="font-size: 0.7em; color: grey;">ID: ${item.itemId}</div>
                    ${recountBatchIndicator}
                `;

                // --- Populate Count Column ---
                 const countInput = document.createElement('input');
                 countInput.type = 'number';
                 countInput.value = item.toCount ? '' : (item.counted === null || item.counted === undefined) ? '' : item.counted;
                 countInput.dataset.type = 'count-input';
                 countInput.min = "0";
                 const disableCountInput = !item.isActive || (item.isReel && item.footageFactor > 0 && item.calculatedFootage !== null);
                 countInput.disabled = disableCountInput;
                 const isFinished = !item.toCount && item.isActive;
                 countInput.readOnly = isFinished;

                 if (!item.isActive) {
                    countInput.title = "Item is inactive";
                 } else if (item.isReel && item.footageFactor > 0 && item.calculatedFootage !== null) {
                    countInput.title = "Quantity calculated from footage";
                 } else if (isFinished) {
                     countInput.title = "Item finished for this cycle (view only)";
                 } else if (item.toCount) {
                     countInput.title = "Enter current count";
                 }

                 let capturedQtyHtml = '';
                 if (item.capturedQuantity !== null && item.capturedQuantity !== undefined) {
                     capturedQtyHtml = `<span class="captured-qty-display clickable-value"
                                             data-action="apply-expected-qty"
                                             data-value="${item.capturedQuantity}"
                                             title="Click to apply ${item.capturedQuantity} to the input">(Expected: ${item.capturedQuantity})</span>`;
                 } else {
                     capturedQtyHtml = `<span class="captured-qty-display">(Expected: N/A)</span>`;
                 }

                columns.count.innerHTML = `<span>Qty:${capturedQtyHtml}</span>`;
                columns.count.appendChild(countInput);

                // --- Populate Sequences Columns ---
                if (item.isReel) {
                    const createSequenceDisplaySpan = (type, value) => {
                        const displayValue = (value !== null && value !== undefined && String(value).trim() !== '') ? String(value).trim() : '---';
                        const actualType = type; // 'Inner', 'Outer', 'Inner2', 'Outer2'
                        const sequenceInputName = actualType.toLowerCase(); // 'inner', 'outer', 'inner2', 'outer2'

                        if (displayValue === '---') {
                            return `<span class="captured-sequence-display is-empty">${actualType}: ${displayValue}</span>`;
                        } else {
                            return `<span class="captured-sequence-display clickable-value"
                                          data-action="apply-sequence"
                                          data-sequence-type="${sequenceInputName}"
                                          data-sequence-value="${displayValue}"
                                          title="Click to apply '${displayValue}' to the input below">${actualType}: ${displayValue}</span>`;
                        }
                    };

                    const disableSequenceInput = !item.isActive || !item.toCount;

                    const createSequenceInput = (sequenceType, currentValue) => {
                        const input = document.createElement('input');
                        input.type = 'number';
                        input.dataset.sequence = sequenceType;
                        input.value = item.toCount ? '' : currentValue ?? '';
                        input.placeholder = sequenceType.charAt(0).toUpperCase() + sequenceType.slice(1);
                        input.min = "0";
                        input.disabled = disableSequenceInput;
                        input.readOnly = disableSequenceInput;
                         if (disableSequenceInput) {
                            input.title = !item.isActive ? "Item is inactive" : "Item finished for cycle";
                         }
                        return input;
                    };

                    const seq1Group = document.createElement('div');
                    seq1Group.className = 'sequence-pair-container';

                    const group1Inner = document.createElement('div');
                    group1Inner.className = 'sequence-group';
                    group1Inner.innerHTML = createSequenceDisplaySpan('Inner', item.innerSequence);
                    group1Inner.appendChild(createSequenceInput('inner', item.innerSequence));

                    const group1Outer = document.createElement('div');
                    group1Outer.className = 'sequence-group';
                    group1Outer.innerHTML = createSequenceDisplaySpan('Outer', item.outerSequence);
                    group1Outer.appendChild(createSequenceInput('outer', item.outerSequence));

                    columns.sequences1.appendChild(group1Inner);
                    columns.sequences1.appendChild(group1Outer);
                    columns.sequences1.appendChild(document.createTextNode(' = '));

                    if (item.isTwoWayReel) {
                        const group2Inner = document.createElement('div');
                        group2Inner.className = 'sequence-group';
                        group2Inner.innerHTML = createSequenceDisplaySpan('Inner2', item.innerSequence2);
                        group2Inner.appendChild(createSequenceInput('inner2', item.innerSequence2));

                        const group2Outer = document.createElement('div');
                        group2Outer.className = 'sequence-group';
                        group2Outer.innerHTML = createSequenceDisplaySpan('Outer2', item.outerSequence2);
                        group2Outer.appendChild(createSequenceInput('outer2', item.outerSequence2));

                        columns.sequences2.appendChild(group2Inner);
                        columns.sequences2.appendChild(group2Outer);
                        columns.sequences2.appendChild(document.createTextNode(' = '));
                        columns.sequences2.style.visibility = 'visible';
                    } else {
                        columns.sequences2.innerHTML = '';
                        columns.sequences2.style.visibility = 'hidden';
                    }

                    const totalFootageDisplay = document.createElement('span');
                    totalFootageDisplay.className = 'calculated-footage-display total-footage';
                    const hasAnySequenceInput = item.innerSequence || item.outerSequence || item.innerSequence2 || item.outerSequence2;
                    if (item.calculatedFootage !== null) {
                        totalFootageDisplay.textContent = `Total: ${item.calculatedFootage.toFixed(2)} ft`;
                        totalFootageDisplay.style.color = '';
                        totalFootageDisplay.title = '';
                    } else if (hasAnySequenceInput) {
                         totalFootageDisplay.textContent = 'Total: Invalid';
                         totalFootageDisplay.style.color = 'var(--danger-color)';
                         totalFootageDisplay.title = 'Incomplete or invalid sequence values entered.';
                    } else {
                         totalFootageDisplay.textContent = 'Total: ---';
                         totalFootageDisplay.style.color = '';
                         totalFootageDisplay.title = '';
                    }
                    columns.sequences1.appendChild(totalFootageDisplay);

                } else {
                    columns.sequences1.innerHTML = '';
                    columns.sequences1.style.visibility = 'hidden';
                    columns.sequences2.innerHTML = '';
                    columns.sequences2.style.visibility = 'hidden';
                }

                // --- Populate Notes Column ---
                const notesTextarea = document.createElement('textarea');
                notesTextarea.dataset.type = 'notes-input';
                notesTextarea.value = item.toCount ? '' : item.notes ?? '';
                notesTextarea.placeholder = 'Add notes...';
                notesTextarea.disabled = !item.isActive;
                notesTextarea.readOnly = !item.isActive;
                columns.notes.appendChild(notesTextarea);

                // --- Populate Actions Column ---
                // const flagButtonDisabled = !item.isActive || !item.toCount;
                const showFlagButton = item.isActive && !item.isUncounted; // NEW: Show if active and NOT already uncounted
                const finalizeButtonDisabled = !item.isActive || !item.toCount; 

                let flagButtonHtml = ''; // <<<<<====== DECLARE AND INITIALIZE HERE (MOVED UP)
                if (showFlagButton) {
                    flagButtonHtml = `<button data-action="flag-as-uncounted" class="btn-warning" title="Reset item count and mark as uncounted (will set toCount=true)">Flag as Uncounted</button>`;
                }

                columns.actions.innerHTML = `
                    ${flagButtonHtml}
                    <button data-action="view-history" class="btn-secondary" title="View history for this item">History</button>
                    <button data-action="finalize-item" class="btn-success" title="Record count and finish this item for the cycle" ${finalizeButtonDisabled ? 'disabled' : ''}>Record & Finish</button>
                `;

                // --- Append columns ---
                itemDiv.appendChild(columns.details);
                itemDiv.appendChild(columns.count);
                itemDiv.appendChild(columns.sequences1);
                itemDiv.appendChild(columns.sequences2);
                itemDiv.appendChild(columns.notes);
                itemDiv.appendChild(columns.actions);

                fragment.appendChild(itemDiv);

            } catch (itemError) { // Catch errors rendering a single item
                 console.error(`Error rendering item ${item?.SKU || item?.itemId || '(Unknown Item)'}:`, itemError);
                const errorDiv = document.createElement('div');
                errorDiv.className = 'inventory-item error-item';
                errorDiv.innerHTML = `<p class="error-message" style="margin:0;">Error rendering item ${item?.SKU || '(Unknown SKU)'}</p>`;
                fragment.appendChild(errorDiv); // Append error placeholder to fragment
            }
        }); // End currentInventory.forEach

        container.appendChild(fragment);
        console.log(`Rendered ${currentInventory.length} items matching filters:`, currentFilters);

    } catch (error) { // Catch errors in the overall rendering process
        console.error("Error rendering inventory list:", error);
        container.innerHTML = `<p class="error-message">Error displaying inventory list. Check console.</p>`;
   }
} // End renderInventoryList


// --- Summary Card Rendering ---
// Use checks for elements before setting textContent
function updateSummaryCards() {
    try {
        // Calculate counts based on the full dataset
        const totalItems = database.inventory.length;
        const activeItems = database.inventory.filter(item => item.isActive);
        const activeCount = activeItems.length;
        // "Counted" means active, not flagged uncounted, AND not marked 'toCount' (i.e., finished)
        const countedFinishedActive = activeItems.filter(item => !item.toCount && !item.isUncounted).length;
         // "Uncounted" means active AND marked 'toCount' (i.e., still needs counting)
        const uncountedToDoActive = activeItems.filter(item => item.toCount).length;

        // Helper to update card text safely
        const updateCardText = (cardId, value) => {
             const cardElement = document.getElementById(cardId);
             if (cardElement) {
                 const pElement = cardElement.querySelector('p');
                 if (pElement) {
                     pElement.textContent = value;
                 } else {
                     console.warn(`Could not find 'p' element within card '${cardId}'`);
                 }
             } else {
                 console.warn(`Could not find card element with id '${cardId}'`);
             }
        };

        updateCardText('total-items', totalItems);
        updateCardText('active-items', activeCount);
        updateCardText('counted-items', countedFinishedActive); // Represents finished items
        updateCardText('uncounted-items', uncountedToDoActive); // Represents items to count

    } catch (error) {
        console.error("Error updating summary cards:", error);
    }
}; // End of updateSummaryCards

// --- History View Rendering ---
function renderHistoryView() {
    const container = document.getElementById('historyListContainer');
    if (!container) return;

    try {
        container.innerHTML = '';
        if (!database.transactionHistory || database.transactionHistory.length === 0) {
            container.innerHTML = '<p>No transaction history recorded yet.</p>';
            return;
        }
        const fragment = document.createDocumentFragment();
        // Use the already sorted (descending) history
        database.transactionHistory.forEach(entry => {
             try {
                const div = document.createElement('div');
                div.className = 'history-entry';
                const date = new Date(entry.timestamp);
                const formattedDate = date.toLocaleString();

                let detailsHtml = '';
                // Enhance details based on type - SINGLE SWITCH BLOCK
                switch(entry.type) {
                    case 'update_count':
                        const fromVal = entry.details.wasUncounted ? 'uncounted' : (entry.details.oldValue ?? 'N/A');
                        detailsHtml = `Updated count for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) from ${fromVal} to <strong>${entry.details.newValue}</strong> via ${entry.details.source || 'manual'}.`;
                         if (entry.details.notes) detailsHtml += ` <i>Note: ${entry.details.notes}</i>`;
                        break;
                    case 'flag_uncounted':
                         detailsHtml = `Flagged <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) as uncounted. (Previous: ${entry.details.previousState?.counted ?? 'N/A'})`;
                        break;
                    case 'update_notes':
                         detailsHtml = `Updated notes for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}).`; // Keep concise for global view
                        break;
                    case 'description_change':
                         detailsHtml = `Description change for <strong>${entry.SKU}</strong> from "${entry.details.oldDescription}" to "${entry.details.newDescription}" during import.`;
                         break;
                    case 'status_change': // UPDATED Logic
                         detailsHtml = `Status change for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) to <strong>${entry.details.newStatus ? 'Active' : 'Inactive'}</strong>. Reason: ${entry.details.reason || 'Unknown'}`;
                         break;
                    case 'import_csv': // Regular CSV Import (Context: update)
                         detailsHtml = `CSV Import [Update] (${entry.details.fileName || 'N/A'}): Added ${entry.details.addedCount}, Updated ${entry.details.updatedCount}, Skipped ${entry.details.skippedCount}.`;
                         if (entry.details.descChanges > 0) detailsHtml += ` (${entry.details.descChanges} desc changes).`;
                         break;
                    case 'new_count_started_import': // NEW TYPE
                         detailsHtml = `Started New Count Cycle via CSV Import (${entry.details.fileName || 'N/A'}). Marked ${entry.details.itemsMarkedToCount} items 'To Count'. Processed ${entry.details.skusImported} records (Added: ${entry.details.addedCount}, Updated: ${entry.details.updatedCount}, Skipped: ${entry.details.skippedCount}, Marked Not-to-Count: ${entry.details.markedNotToCount})`;
                         break;
                     case 'recount_items_imported': // NEW TYPE for recount import
                         detailsHtml = `Imported items for Recount Batch '${entry.details.recountBatchId || 'N/A'}' via CSV (${entry.details.fileName || 'N/A'}). Added ${entry.details.itemsAddedToRecount} items to batch, reset counts. (Added New: ${entry.details.addedCount}, Updated Existing: ${entry.details.updatedCount}, Skipped: ${entry.details.skippedCount})`;
                         break;
                    case 'inventory_finalized': // MODIFIED details
                         detailsHtml = `<strong>Inventory Finalized.</strong> ${entry.details.deactivatedReelCount} REELS marked inactive. ${entry.details.toCountClearedCount} items had 'To Count' flag cleared.`;
                         break;
                     case 'item_count_finalized':
                          detailsHtml = `Finished count for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}). Final Count: ${entry.details?.finalCount ?? 'Uncounted'}.`;
                          break;
                     case 'recount_adjustment_update': // Log generated by recordOrUpdateCount for recount
                     case 'recount_physical_update':   // Log generated by recordOrUpdateCount for recount
                          const fromAdjVal = entry.details.wasUncounted ? 'uncounted' : (entry.details.oldValue ?? 'N/A');
                          const adjSource = entry.details.source === 'recount_adjustment' ? `adjustment (Tx: ${entry.details.adjustmentTxId})` : 'physical count';
                          detailsHtml = `Recount [${entry.details.recountBatchId}] Update for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) from ${fromAdjVal} to <strong>${entry.details.newValue}</strong> via ${adjSource}.`;
                          break;
                     case 'recount_flag_uncounted': // Log generated by flagUncounted for recount
                          detailsHtml = `Recount [${entry.details.recountBatchId}] Flagged <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) as uncounted. (Previous: ${entry.details.previousState?.counted ?? 'N/A'})`;
                          break;
                     case 'recount_update_notes': // Log generated by updateItemNotes for recount
                          detailsHtml = `Recount [${entry.details.recountBatchId}] Updated notes for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}).`;
                          break;
                    default:
                        detailsHtml = `Action: ${entry.type} for ${entry.SKU || 'N/A'} (${entry.location || 'N/A'})`;
                } // End of the single switch statement

                // Set the innerHTML using the generated detailsHtml
                // Include ItemID for easier debugging/lookup
                const itemIdHtml = entry.itemId ? `<span style="color: grey; font-size: 0.9em;"> (ItemID: ${entry.itemId})</span>` : '';
                div.innerHTML = `
                    <div class="history-meta">${formattedDate} - ${entry.user || 'System'} - ID: ${entry.id || 'N/A'}</div>
                    <div class="history-details">${detailsHtml}${itemIdHtml}</div>
                `;
                fragment.appendChild(div);

             } catch(entryError) { // Catch errors rendering a single entry
                 console.error("Error rendering history entry:", entry, entryError);
                  const errorDiv = document.createElement('div');
                  errorDiv.className = 'history-entry error-entry';
                  errorDiv.innerHTML = `<p class="error-message" style="margin:0;">Error rendering history entry (ID: ${entry?.id || 'N/A'})</p>`;
                  fragment.appendChild(errorDiv);
             }
        }); // End forEach loop

        container.appendChild(fragment); // Append all entries at once

    } catch (error) { // Catch errors related to the overall process
        console.error("Error rendering history view:", error);
        container.innerHTML = `<p class="error-message">Error displaying history. Check console.</p>`;
    }
} // End renderHistoryView


function toggleHistoryView(show) {
    try {
        const view = document.getElementById('history-view'); // Get the history view element
        const mainInventory = document.getElementById('inventory'); // Get the main inventory element

        if (!view || !mainInventory) return; // Check if elements exist before proceeding

        if (show) {
            renderHistoryView(); // Render before showing
            view.style.display = 'block'; // Show history view
            mainInventory.style.display = 'none'; // Hide main inventory
        } else {
            view.style.display = 'none'; // Hide history view
            mainInventory.style.display = 'block'; // Show main inventory
        }
    } catch (error) { // Catch errors related to toggling the view
        console.error("Error toggling history view:", error); // Log the error for debugging purposes
    }
} // End toggleHistoryView


// --- Item Specific History Modal ---
// Accept itemId, sku, and description
async function showItemHistory(itemId, sku, description) {
    console.log(`[showItemHistory] Function called with ItemID: ${itemId}, SKU: ${sku}, Desc: ${description}`);
    const modal = document.getElementById('itemHistoryModal');
    const title = document.getElementById('itemHistoryModalTitle');
    const body = document.getElementById('itemHistoryModalBody');

    if (!modal || !title || !body) {
        console.error("[showItemHistory] Item history modal elements not found! Cannot display modal.");
        alert("Error: Could not find the history modal elements.");
        return;
    }
    console.log("[showItemHistory] Modal elements found:", { modal, title, body });

    // Use provided SKU and Description for title consistency
    const displaySku = sku || 'Unknown SKU';
    const displayDesc = description || 'No Description';
    title.textContent = `History for Item: ${displaySku}`;
    title.title = `ItemID: ${itemId}\nDescription: ${displayDesc}`; // Add more info to tooltip

    console.log(`[showItemHistory] Set modal title to: ${title.textContent}`);

    body.innerHTML = '<p>Loading history...</p>';
    modal.style.display = 'block'; // Show modal

    try {
        // Query by ItemID using the appropriate DB function
        console.log(`[showItemHistory] Querying history from DB for ItemID: '${itemId}'`);
        const itemHistory = await DB.getTransactionHistoryByItemId(itemId);
        console.log(`[showItemHistory] History records received from DB for ItemID ${itemId}:`, itemHistory);

        body.innerHTML = ''; // Clear loading

        if (!Array.isArray(itemHistory) || itemHistory.length === 0) {
             body.innerHTML = `<p>No specific transaction history found for this item (ID: ${itemId}).</p>`;
             console.log(`[showItemHistory] Displaying 'No history' message for ItemID ${itemId}.`);
        } else {
            const fragment = document.createDocumentFragment();
            // History from DB function should already be sorted descending
            itemHistory.forEach(entry => {
                try {
                    const div = document.createElement('div');
                    div.className = 'history-entry';
                    const date = new Date(entry.timestamp);
                    const formattedDate = date.toLocaleString();
                    let detailsHtml = '';

                    // Simplified details for item-specific view
                    switch(entry.type) {
                         case 'update_count':
                            const fromValItem = entry.details.wasUncounted ? 'uncounted' : (entry.details.oldValue ?? 'N/A');
                            detailsHtml = `Count set to <strong>${entry.details?.newValue ?? 'N/A'}</strong> (was ${fromValItem}) via ${entry.details?.source || 'manual'}.`;
                            if (entry.details?.notes) detailsHtml += ` <i>Note: ${entry.details.notes}</i>`;
                            break;
                        case 'flag_uncounted':
                            detailsHtml = `Flagged as uncounted (Previous count: ${entry.details.previousState?.counted ?? 'N/A'}).`;
                            break;
                        case 'update_notes':
                             detailsHtml = `Notes updated to: "${entry.details?.newValue ?? ''}" (was "${entry.details?.oldValue ?? ''}")`;
                             break;
                         case 'description_change':
                             detailsHtml = `Description changed to "${entry.details?.newDescription ?? ''}" (was "${entry.details?.oldDescription ?? ''}").`;
                             break;
                        case 'status_change':
                             detailsHtml = `Status changed to <strong>${entry.details?.newStatus ? 'Active' : 'Inactive'}</strong>. Reason: ${entry.details?.reason || 'Unknown'}`;
                             break;
                         case 'import_csv':
                             detailsHtml = `Item data updated during CSV Import [Update] (${entry.details?.fileName || 'N/A'}).`;
                             break;
                         case 'new_count_started_import':
                            detailsHtml = `Marked 'To Count' & reset via New Count Cycle Import (${entry.details?.fileName || 'N/A'}).`;
                            break;
                         case 'recount_items_imported':
                            detailsHtml = `Added to Recount Batch '${entry.details?.recountBatchId || 'N/A'}' & reset via Recount Import (${entry.details?.fileName || 'N/A'}).`;
                            break;
                        case 'inventory_finalized': // Less relevant for single item, but might appear if it was a reel deactivated
                            detailsHtml = `Inventory Finalized (This item might have been affected if reel status changed).`;
                            break;
                         case 'item_count_finalized':
                             detailsHtml = `Marked as finished for cycle. Final Count: ${entry.details?.finalCount ?? 'Uncounted'}.`;
                             break;
                         case 'recount_adjustment_update':
                         case 'recount_physical_update':
                            const fromAdjValItem = entry.details.wasUncounted ? 'uncounted' : (entry.details.oldValue ?? 'N/A');
                             const adjSourceItem = entry.details.source === 'recount_adjustment' ? `adjustment (Tx: ${entry.details.adjustmentTxId})` : 'physical count';
                             detailsHtml = `Recount [${entry.details.recountBatchId}] update from ${fromAdjValItem} to <strong>${entry.details.newValue}</strong> via ${adjSourceItem}.`;
                             break;
                          case 'recount_flag_uncounted':
                               detailsHtml = `Recount [${entry.details.recountBatchId}] flagged as uncounted (Previous: ${entry.details.previousState?.counted ?? 'N/A'}).`;
                               break;
                           case 'recount_update_notes':
                               detailsHtml = `Recount [${entry.details.recountBatchId}] notes updated.`;
                               break;
                        default:
                            detailsHtml = `Action: ${entry.type}`;
                            if (entry.details && Object.keys(entry.details).length > 0) {
                                detailsHtml += ` - Details: ${JSON.stringify(entry.details)}`;
                            }
                    }

                    // Display meta info (user, timestamp, transaction ID)
                    div.innerHTML = `
                        <div class="history-meta">${formattedDate} - ${entry.user || 'System'} (ID: ${entry.id || 'N/A'})</div>
                        <div class="history-details">${detailsHtml}</div>
                    `;
                    fragment.appendChild(div);
                } catch (renderEntryError) {
                     console.error(`[showItemHistory] Error rendering single history entry:`, entry, renderEntryError);
                     // Optionally add an error placeholder for this entry in the modal
                }
            });
            body.appendChild(fragment);
            console.log(`[showItemHistory] Rendered ${itemHistory.length} history entries for ItemID ${itemId}.`);
        }

    } catch (error) {
        console.error(`[showItemHistory] Error loading or rendering history for ItemID ${itemId}:`, error);
        body.innerHTML = `<p class="error-message">Error loading history for this item. Check console.</p>`;
    }
} // End showItemHistory


function closeItemHistoryModal() {
    const modal = document.getElementById('itemHistoryModal');
    if (modal) {
        modal.style.display = 'none';
    }
} // End closeItemHistoryModal
