// --- START OF FILE uiRenderer.js ---

// Helper to display critical init errors
function displayInitializationError(message) {
    const container = document.getElementById('initialization-error-container'); 
    if (container) {
        container.innerHTML = `<div class="error-message">${message}</div>`; 
        container.style.display = 'block'; 
    }
    document.querySelectorAll('.quick-actions button, header button, .filter-controls button').forEach(btn => btn.disabled = true); 
}  // End of displayInitializationError

// Helper to display non-critical errors within specific containers
function displayError(message, containerElement) {
    if (containerElement) { 
        containerElement.innerHTML = `<p class="error-message" style="margin: 0;">${message}</p>`; 
        containerElement.style.display = 'block'; 
    } else {
        console.warn("Attempted to display error, but containerElement was not provided or found."); 
    }
}  // End of displayError

function updateItemDirtyIndicator(itemId, isDirty) {
    const itemSkuDiv = document.querySelector(`.item-sku[data-item-id-sku="${itemId}"]`);
    if (itemSkuDiv) {
        const indicator = itemSkuDiv.querySelector('.dirty-indicator');
        if (indicator) {
            indicator.style.display = isDirty ? 'inline' : 'none';
        }
        itemSkuDiv.dataset.dirty = isDirty ? 'true' : 'false';
        // console.log(`[updateItemDirtyIndicator] Item ${itemId} dirty indicator set to ${isDirty}`);
    } else {
        // This might happen if the item is not currently rendered due to filters
        // console.warn(`[updateItemDirtyIndicator] SKU div for item ${itemId} not found.`);
    }
}
// --- END OF updateItemDirtyIndicator ---

function renderInventoryList() {
    const container = document.getElementById('inventoryList');
    if (!container) { console.error("Inventory list container not found."); return; }

    try { 
        container.innerHTML = ''; 
        const fragment = document.createDocumentFragment();

        if (!currentInventory || currentInventory.length === 0) {
            let message = 'No items match the current criteria.';
            if (currentFilters.location || currentFilters.searchTerm || currentFilters.status !== 'active' || currentFilters.filterByToCountStatus !== 'to_count') {
                message += ' Try adjusting or clearing the filters.';
            } else if (database.inventory.length === 0) {
                message = 'Inventory is empty. Import data to get started.';
            } else {
                message = 'No items are currently marked "To Count" and "Active". Check filters or start a new count cycle.';
            }
            container.innerHTML = `<p>${message}</p>`;
            return; 
        }

        currentInventory.forEach(item => {
            try {
                if (!item || !item.itemId) { 
                    console.warn("Skipping rendering of invalid item object:", item);
                    throw new Error("Invalid item data encountered during render.");
                }

                const itemDiv = document.createElement('div');
                itemDiv.className = 'inventory-item';
                itemDiv.dataset.sku = item.SKU;
                itemDiv.dataset.itemId = item.itemId;

                // --- Status classes ---
                 if (!item.isActive) itemDiv.classList.add('is-inactive');
                 else if (item.toCount) { // Item is active AND toCount
                     itemDiv.classList.add('is-tocount'); // Blue border
                     if (item.isUncounted) { // Active, toCount, AND uncounted
                         itemDiv.classList.add('is-uncounted'); // Yellow background
                     } else { // Active, toCount, but has a count (isUncounted is false)
                         itemDiv.classList.add('is-counted'); // Retains blue border, no yellow bg
                     }
                 } else { // Item is active but NOT toCount (i.e., finished)
                     itemDiv.classList.add('is-finished'); // Green border
                     // is-counted is also applicable if it has a count
                     if (!item.isUncounted && item.counted !== null) itemDiv.classList.add('is-counted');
                 }
                if (item.isReel) itemDiv.classList.add('is-reel');
                if (item.isTwoWayReel) itemDiv.classList.add('is-two-way-reel');


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
                    <div class="item-sku" data-item-id-sku="${item.itemId}" data-dirty="false"> 
                         ${inactiveIndicator} ${item.isActive ? (item.toCount ? toCountIndicator : finishedIndicator) : ''}
                        <span class="sku-text">${item.SKU}</span><span class="dirty-indicator" style="color: var(--danger-color); margin-left: 3px; display: none;">*</span>${reelInfo}
                    </div>
                    <div class="item-desc">${item.Description || 'N/A'}</div>
                    <div class="item-loc">Loc: ${item.location || 'N/A'}</div>
                    <div class="item-id" style="font-size: 0.7em; color: grey;">ID: ${item.itemId}</div>
                    ${recountBatchIndicator}
                `;


                // --- Populate Count Column ---
                 const countInput = document.createElement('input');
                 countInput.type = 'number';
                 countInput.value = (item.counted === null || item.counted === undefined) ? '' : item.counted;
                 countInput.dataset.type = 'count-input';
                 countInput.min = "0";
                 
                 const hasValidFactorForCalc = item.isReel && typeof item.footageFactor === 'number' && item.footageFactor > 0;
                 const isCalculatedFromFootage = hasValidFactorForCalc && item.calculatedFootage !== null;
                 const disableCountInput = !item.isActive || !item.toCount || isCalculatedFromFootage;
                 
                 countInput.disabled = disableCountInput;
                 countInput.readOnly = !item.toCount || !item.isActive; 

                 if (!item.isActive) {
                    countInput.title = "Item is inactive";
                 } else if (isCalculatedFromFootage) {
                    countInput.title = "Quantity calculated from footage";
                 } else if (!item.toCount) {
                     countInput.title = "Item finished for this cycle (view only)";
                 } else {
                     countInput.title = "Enter current count. Press Enter to confirm item.";
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
                    columns.sequences1.style.visibility = 'visible';
                    
                    const createSequenceInput = (sequenceType, currentValue) => {
                        const input = document.createElement('input');
                        input.type = 'number';
                        input.min = '0';
                        input.dataset.sequence = sequenceType.toLowerCase();
                        input.value = currentValue || '';
                        input.placeholder = sequenceType;
                        input.disabled = !item.isActive || !item.toCount;
                        input.readOnly = !item.toCount;
                        input.title = item.isActive && item.toCount ? `Enter ${sequenceType} sequence. Press Enter to confirm item.` : "Cannot edit sequences";
                        return input;
                    };
                    
                    const group1Inner = document.createElement('div'); 
                    group1Inner.className = 'sequence-group';
                    group1Inner.appendChild(document.createTextNode('I1:'));
                    group1Inner.appendChild(createSequenceInput('inner', item.innerSequence));

                    const group1Outer = document.createElement('div'); 
                    group1Outer.className = 'sequence-group';
                    group1Outer.appendChild(document.createTextNode('O1:'));
                    group1Outer.appendChild(createSequenceInput('outer', item.outerSequence));
                    
                    columns.sequences1.appendChild(group1Inner);
                    columns.sequences1.appendChild(group1Outer);
                   
                    if (item.isTwoWayReel) {
                        columns.sequences2.style.visibility = 'visible';
                        const group2Inner = document.createElement('div');
                        group2Inner.className = 'sequence-group';
                        group2Inner.appendChild(document.createTextNode('I2:'));
                        group2Inner.appendChild(createSequenceInput('inner2', item.innerSequence2));

                        const group2Outer = document.createElement('div');
                        group2Outer.className = 'sequence-group';
                        group2Outer.appendChild(document.createTextNode('O2:'));
                        group2Outer.appendChild(createSequenceInput('outer2', item.outerSequence2));
                        
                        columns.sequences2.appendChild(group2Inner);
                        columns.sequences2.appendChild(group2Outer);
                    } else {
                        columns.sequences2.innerHTML = ''; 
                        columns.sequences2.style.visibility = 'hidden';
                    }

                    const totalFootageDisplay = document.createElement('span');
                    totalFootageDisplay.className = 'calculated-footage-display total-footage';
                    
                    const hasValidFactor = typeof item.footageFactor === 'number' && item.footageFactor > 0;

                    if (hasValidFactor) {
                        if (item.calculatedFootage !== null) {
                            totalFootageDisplay.textContent = `Total: ${item.calculatedFootage.toFixed(2)} ft`;
                            totalFootageDisplay.style.color = '';
                            totalFootageDisplay.title = `Calculated with factor: ${item.footageFactor}`;
                        } else {
                            const hasAnySeqInput = item.innerSequence || item.outerSequence || (item.isTwoWayReel && (item.innerSequence2 || item.outerSequence2));
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
                        totalFootageDisplay.title = 'Footage factor missing, zero, or invalid. Cannot calculate footage.';
                    }
                    const equalsSpan = document.createElement('span');
                    equalsSpan.textContent = " = ";
                    equalsSpan.className = "sequence-equals";
                    columns.sequences1.appendChild(equalsSpan);
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
                notesTextarea.value = item.notes ?? '';
                notesTextarea.placeholder = 'Add notes...';
                notesTextarea.disabled = !item.isActive; 
                notesTextarea.readOnly = !item.isActive; 
                // ++ ADD TITLE FOR SHIFT+ENTER HINT ++
                if (item.isActive && item.toCount) {
                    notesTextarea.title = "Enter notes for this item. Press Shift+Enter to confirm and finalize the item.";
                } else if (item.isActive && !item.toCount) {
                    notesTextarea.title = "Notes (item finished for cycle - view only)";
                } else {
                    notesTextarea.title = "Notes (item inactive)";
                }
                columns.notes.appendChild(notesTextarea);

                // --- Populate Actions Column ---
                let actionButtonsHtml = '';
                const confirmButtonDisabled = !item.isActive || !item.toCount;

                if (item.isActive && item.toCount) {
                    const showFlagUncountedButton = !item.isUncounted; 
                    if (showFlagUncountedButton) {
                        actionButtonsHtml += `<button data-action="flag-as-uncounted" class="btn-warning" title="Reset item to uncounted (clears current quantity, sequences, and calculated footage if reel)">Flag Uncounted</button>`;
                    }
                    actionButtonsHtml += `<button data-action="confirm-item" class="btn-success" title="Confirm count and finish this item for the cycle" ${confirmButtonDisabled ? 'disabled' : ''}>Confirm</button>`;
                } else if (item.isActive && !item.toCount) {
                    actionButtonsHtml += `<button data-action="edit-item" class="btn-secondary" title="Re-open this item for counting in the current cycle">Edit Count</button>`;
                }

                columns.actions.innerHTML = `
                    ${actionButtonsHtml}
                    <button data-action="view-history" class="btn-secondary" title="View history for this item">History</button>
                `;

                itemDiv.appendChild(columns.details);
                itemDiv.appendChild(columns.count);
                itemDiv.appendChild(columns.sequences1);
                itemDiv.appendChild(columns.sequences2);
                itemDiv.appendChild(columns.notes);
                itemDiv.appendChild(columns.actions);
                fragment.appendChild(itemDiv);

            } catch (itemError) { 
                 console.error(`Error rendering item ${item?.SKU || item?.itemId || '(Unknown Item)'}:`, itemError);
                const errorDiv = document.createElement('div');
                errorDiv.className = 'inventory-item error-item';
                errorDiv.innerHTML = `<p class="error-message" style="margin:0;">Error rendering item ${item?.SKU || '(Unknown SKU)'}</p>`;
                fragment.appendChild(errorDiv); 
            }
        }); 

        container.appendChild(fragment);

    } catch (error) { 
        console.error("Error rendering inventory list:", error);
        container.innerHTML = `<p class="error-message">Error displaying inventory list. Check console.</p>`;
   }
}

// --- Summary Card Rendering ---
function updateSummaryCards() {
    try {
        // console.log("[updateSummaryCards] Called. Current database.inventory length:", database.inventory.length);
        
        const totalItems = database.inventory.length;
        const activeItems = database.inventory.filter(item => item.isActive === true);
        const activeCount = activeItems.length;
        
        const countedFinishedActive = activeItems.filter(item => item.toCount === false && item.isUncounted === false).length;
        const uncountedToDoActive = activeItems.filter(item => item.toCount === true).length;

        // console.log("[updateSummaryCards] Calculated values:", { totalItems, activeCount, countedFinishedActive, uncountedToDoActive });

        const updateCardText = (cardId, value) => {
            const card = document.getElementById(cardId);
            if (card) {
                const p = card.querySelector('p');
                if (p) p.textContent = value;
            }
        };

        updateCardText('total-items', totalItems);
        updateCardText('active-items', activeCount);
        updateCardText('counted-items', countedFinishedActive); 
        updateCardText('uncounted-items', uncountedToDoActive); 

        // console.log("[updateSummaryCards] Finished updating card texts.");

    } catch (error) {
        console.error("Error updating summary cards:", error);
    }
};

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
        database.transactionHistory.forEach(entry => {
             try {
                const div = document.createElement('div');
                div.className = 'history-entry';
                const date = new Date(entry.timestamp);
                const formattedDate = date.toLocaleString();

                let detailsHtml = '';
                switch(entry.type) {
                    case 'update_count':
                        const fromVal = entry.details.wasUncounted ? 'uncounted' : (entry.details.oldValue ?? 'N/A');
                        detailsHtml = `Updated count for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) from ${fromVal} to <strong>${entry.details.newValue}</strong> via ${entry.details.source || 'manual'}.`;
                         if (entry.details.notes) detailsHtml += ` <i>Note: ${entry.details.notes}</i>`;
                        break;
                    case 'item_reset_to_uncounted':
                         detailsHtml = `Flagged <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) as uncounted. (Previous count: ${entry.details.previousCount ?? 'N/A'}, Was toCount: ${entry.details.wasPreviouslyToCount})`;
                        break;
                    case 'update_notes':
                         detailsHtml = `Updated notes for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}). New: "${entry.details.newValue}", Old: "${entry.details.oldValue}"`;
                        break;
                    case 'create_item':
                        detailsHtml = `Created new item <strong>${entry.SKU}</strong> at ${entry.location || 'N/A'}. Type: ${entry.details?.itemType || 'Standard'}${entry.details?.reelNumber ? `, Reel#: ${entry.details.reelNumber}` : ''}. Marked 'To Count'.`;
                        break;
                    case 'description_change':
                         detailsHtml = `Description change for <strong>${entry.SKU}</strong> from "${entry.details.oldDescription}" to "${entry.details.newDescription}" (e.g. during import or item edit).`;
                         break;
                    case 'status_change': 
                         detailsHtml = `Status change for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) to <strong>${entry.details.newStatus ? 'Active' : 'Inactive'}</strong>. Reason: ${entry.details.reason || 'Unknown'}`;
                         break;
                    case 'import_csv': 
                         detailsHtml = `CSV Import [Update] (${entry.details.fileName || 'N/A'}): Added ${entry.details.addedCount}, Updated ${entry.details.updatedCount}, Skipped ${entry.details.skippedCount}.`;
                         if (entry.details.descChanges > 0) detailsHtml += ` (${entry.details.descChanges} desc changes).`;
                         break;
                    case 'new_count_started_import': 
                         detailsHtml = `Started New Count Cycle (ID: ${entry.details.cycleId || 'N/A'}) via CSV Import (${entry.details.fileName || 'N/A'}). Items in CSV marked 'To Count': ${entry.details.itemsMarkedToCount}. Items NOT in CSV marked 'Not To Count': ${entry.details.markedNotToCount}. (Added: ${entry.details.addedCount}, Updated: ${entry.details.updatedCount}, Skipped: ${entry.details.skippedCount})`;
                         break;
                     case 'recount_items_imported': 
                         detailsHtml = `Imported items for Recount Batch '${entry.details.recountBatchId || 'N/A'}' via CSV (${entry.details.fileName || 'N/A'}). Items added/updated for batch: ${entry.details.itemsAddedToRecount}. (Added New: ${entry.details.addedCount}, Updated Existing: ${entry.details.updatedCount}, Skipped: ${entry.details.skippedCount})`;
                         break;
                    case 'inventory_finalized': 
                         detailsHtml = `<strong>Inventory Finalized.</strong> ${entry.details.deactivatedReelCount} REELS marked inactive. ${entry.details.toCountClearedCount} items had 'To Count' flag cleared.`;
                         break;
                     case 'item_count_finalized':
                          detailsHtml = `Finished count for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}). Final Count: ${entry.details?.finalCount ?? 'Uncounted'}.`;
                          break;
                     case 'recount_adjustment_update': 
                     case 'recount_physical_update':   
                          const fromAdjVal = entry.details.wasUncounted ? 'uncounted' : (entry.details.oldValue ?? 'N/A');
                          const adjSource = entry.details.source === 'recount_adjustment' ? `adjustment (Tx: ${entry.details.adjustmentTxId})` : 'physical count';
                          detailsHtml = `Recount [${entry.details.recountBatchId}] Update for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) from ${fromAdjVal} to <strong>${entry.details.newValue}</strong> via ${adjSource}.`;
                          break;
                     case 'recount_item_reset_to_uncounted':
                          detailsHtml = `Recount [${entry.details.recountBatchId}] Flagged <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) as uncounted. (Previous count: ${entry.details.previousCount ?? 'N/A'}, Was toCount: ${entry.details.wasPreviouslyToCount})`;
                          break;
                     case 'recount_update_notes': 
                          detailsHtml = `Recount [${entry.details.recountBatchId}] Updated notes for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}). New: "${entry.details.newValue}", Old: "${entry.details.oldValue}"`;
                          break;
                    default:
                        detailsHtml = `Action: ${entry.type} for ${entry.SKU || 'N/A'} (${entry.location || 'N/A'})`;
                        if (entry.details && Object.keys(entry.details).length > 0) {
                            detailsHtml += ` - Details: ${JSON.stringify(entry.details)}`;
                        }
                } 

                const itemIdHtml = entry.itemId ? `<span style="color: grey; font-size: 0.9em;"> (ItemID: ${entry.itemId})</span>` : '';
                div.innerHTML = `
                    <div class="history-meta">${formattedDate} - ${entry.user || 'System'} - ID: ${entry.id || 'N/A'}</div>
                    <div class="history-details">${detailsHtml}${itemIdHtml}</div>
                `;
                fragment.appendChild(div);

             } catch(entryError) { 
                 console.error("Error rendering history entry:", entry, entryError);
                  const errorDiv = document.createElement('div');
                  errorDiv.className = 'history-entry error-entry';
                  errorDiv.innerHTML = `<p class="error-message" style="margin:0;">Error rendering history entry (ID: ${entry?.id || 'N/A'})</p>`;
                  fragment.appendChild(errorDiv);
             }
        }); 

        container.appendChild(fragment); 

    } catch (error) { 
        console.error("Error rendering history view:", error);
        container.innerHTML = `<p class="error-message">Error displaying history. Check console.</p>`;
    }
}


function toggleHistoryView(show) {
    try {
        const view = document.getElementById('history-view'); 
        const mainInventory = document.getElementById('inventory'); 

        if (!view || !mainInventory) return; 

        if (show) {
            renderHistoryView(); 
            view.style.display = 'block'; 
            mainInventory.style.display = 'none'; 
        } else {
            view.style.display = 'none'; 
            mainInventory.style.display = 'block'; 
        }
    } catch (error) { 
        console.error("Error toggling history view:", error); 
    }
}


async function showItemHistory(itemId, sku, description) {
    const modal = document.getElementById('itemHistoryModal');
    const title = document.getElementById('itemHistoryModalTitle');
    const body = document.getElementById('itemHistoryModalBody');

    if (!modal || !title || !body) {
        console.error("[showItemHistory] Item history modal elements not found! Cannot display modal.");
        alert("Error: Could not find the history modal elements.");
        return;
    }

    const displaySku = sku || 'Unknown SKU';
    const displayDesc = description || 'No Description';
    title.textContent = `History for Item: ${displaySku}`;
    title.title = `ItemID: ${itemId}\nDescription: ${displayDesc}`; 

    body.innerHTML = '<p>Loading history...</p>';
    modal.style.display = 'block'; 

    try {
        const itemHistory = await DB.getTransactionHistoryByItemId(itemId);
        body.innerHTML = ''; 

        if (!Array.isArray(itemHistory) || itemHistory.length === 0) {
             body.innerHTML = `<p>No specific transaction history found for this item (ID: ${itemId}).</p>`;
        } else {
            const fragment = document.createDocumentFragment();
            itemHistory.forEach(entry => {
                try {
                    const div = document.createElement('div');
                    div.className = 'history-entry';
                    const date = new Date(entry.timestamp);
                    const formattedDate = date.toLocaleString();
                    let detailsHtml = '';

                    switch(entry.type) {
                         case 'update_count':
                            const fromValItem = entry.details.wasUncounted ? 'uncounted' : (entry.details.oldValue ?? 'N/A');
                            detailsHtml = `Count set to <strong>${entry.details?.newValue ?? 'N/A'}</strong> (was ${fromValItem}) via ${entry.details?.source || 'manual'}.`;
                            if (entry.details?.notes) detailsHtml += ` <i>Note: ${entry.details.notes}</i>`;
                            break;
                        case 'item_reset_to_uncounted':
                            detailsHtml = `Flagged as uncounted (Previous count: ${entry.details.previousCount ?? 'N/A'}, Was toCount: ${entry.details.wasPreviouslyToCount}).`;
                            break;
                        case 'update_notes':
                             detailsHtml = `Notes updated to: "${entry.details?.newValue ?? ''}" (was "${entry.details?.oldValue ?? ''}")`;
                             break;
                        case 'create_item':
                             detailsHtml = `Item created. Type: ${entry.details?.itemType || 'Standard'}${entry.details?.reelNumber ? `, Reel#: ${entry.details.reelNumber}` : ''}. Marked 'To Count'.`;
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
                            detailsHtml = `Marked 'To Count' & reset via New Count Cycle Import (${entry.details?.fileName || 'N/A'}). Cycle: ${entry.details?.cycleId}`;
                            break;
                         case 'recount_items_imported':
                            detailsHtml = `Added to Recount Batch '${entry.details?.recountBatchId || 'N/A'}' & reset via Recount Import (${entry.details?.fileName || 'N/A'}).`;
                            break;
                        case 'inventory_finalized': 
                            detailsHtml = `Inventory Finalized (Item's 'toCount' flag cleared, or status changed if reel with zero count).`;
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
                          case 'recount_item_reset_to_uncounted':
                               detailsHtml = `Recount [${entry.details.recountBatchId}] flagged as uncounted (Previous count: ${entry.details.previousCount ?? 'N/A'}, Was toCount: ${entry.details.wasPreviouslyToCount}).`;
                               break;
                           case 'recount_update_notes':
                               detailsHtml = `Recount [${entry.details.recountBatchId}] notes updated. New: "${entry.details.newValue}", Old: "${entry.details.oldValue}"`;
                               break;
                        default:
                            detailsHtml = `Action: ${entry.type}`;
                            if (entry.details && Object.keys(entry.details).length > 0) {
                                detailsHtml += ` - Details: ${JSON.stringify(entry.details)}`;
                            }
                    }

                    div.innerHTML = `
                        <div class="history-meta">${formattedDate} - ${entry.user || 'System'} (ID: ${entry.id || 'N/A'})</div>
                        <div class="history-details">${detailsHtml}</div>
                    `;
                    fragment.appendChild(div);
                } catch (renderEntryError) {
                     console.error(`[showItemHistory] Error rendering single history entry:`, entry, renderEntryError);
                }
            });
            body.appendChild(fragment);
        }

    } catch (error) {
        console.error(`[showItemHistory] Error loading or rendering history for ItemID ${itemId}:`, error);
        body.innerHTML = `<p class="error-message">Error loading history for this item. Check console.</p>`;
    }
}


function closeItemHistoryModal() {
    const modal = document.getElementById('itemHistoryModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function openNewCountConfirmationModal(cycleId, cutOffDateStr) {
    const modal = document.getElementById('newCountConfirmationModal');
    const cycleIdSpan = document.getElementById('confirmCycleId');
    const cutOffDateSpan = document.getElementById('confirmCutOffDate');

    if (!modal || !cycleIdSpan || !cutOffDateSpan) {
        console.error("New count confirmation modal elements not found.");
        alert("Error: Could not display confirmation dialog.");
        return;
    }

    cycleIdSpan.textContent = cycleId;
    cutOffDateSpan.textContent = cutOffDateStr;

    const proceedButton = document.getElementById('proceedToSelectCsvBtn');
    if (proceedButton) {
        proceedButton.dataset.cycleId = cycleId;
        proceedButton.dataset.cutOffDate = cutOffDateStr;
    } else {
        // Fallback if button ID changes or is missing, store on modal itself
        modal.dataset.cycleId = cycleId;
        modal.dataset.cutOffDate = cutOffDateStr;
    }

    modal.style.display = 'block';
}

function closeNewCountConfirmationModal() {
    const modal = document.getElementById('newCountConfirmationModal');
    if (modal) {
        modal.style.display = 'none';
        const proceedButton = document.getElementById('proceedToSelectCsvBtn');
        if (proceedButton) {
            delete proceedButton.dataset.cycleId;
            delete proceedButton.dataset.cutOffDate;
        } else {
            delete modal.dataset.cycleId;
            delete modal.dataset.cutOffDate;
        }
    }
}
// --- END OF FILE uiRenderer.js ---