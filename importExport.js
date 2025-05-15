// Check if required libraries are loaded
if (typeof Papa === 'undefined') {
    console.error("PapaParse library not found. CSV features will be unavailable.");
    // No alert here, assume stateManager handles critical checks
}
// PDF library (jspdf) checked within the exportPDF function

// --- CSV Handling ---
// Needs DB, logTransaction, applyDataDefaults, findExistingItemRecord, calculateFootageForItem, applyCurrentFilters, updateSummaryCards, getUserIdentifier
// Handle itemId structure, import contexts, and use findExistingItemRecord
// Needs DB, logTransaction, applyDataDefaults, findExistingItemRecord, calculateFootageForItem, applyCurrentFilters, updateSummaryCards, getUserIdentifier

// Update function signature to accept cycleId and cutOffDate (optional, but needed for 'new_count')
async function showImportDialog(importContext = 'update', cycleId = null, cutOffDate = null) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv, text/csv';
    input.style.display = 'none';

    // Log the context and any passed parameters
     console.log(`showImportDialog called with Context: ${importContext}, CycleID: ${cycleId}, CutOffDate: ${cutOffDate}`);


    input.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        console.log(`Attempting to import CSV: ${file.name} (Context: ${importContext})`);

        // --- Recount Batch Setup (if needed) ---
        // *** This section remains the same as your original logic for context 'recount' ***
        let recountBatchId = null;
        //let cutOffDate = null; // CutOffDate is now passed in for 'new_count', handled separately for 'recount'
        if (importContext === 'recount') {
             // Prompt for recount batch ID and cut-off date
              const batchIdentifier = prompt(`Enter a unique identifier for this RECOUNT batch (e.g., YYMMDD.R<n>, like ${new Date().toISOString().slice(2,10).replace(/-/g,'')}.R1):`);
              const dateInput = prompt(`Enter the Cut-off Date for this recount batch (YYYY-MM-DD):`); // Note: This is separate from the cycle's cutOffDate

              if (!batchIdentifier || !dateInput || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
                  alert("Recount import cancelled: Valid Batch Identifier and Cut-off Date (YYYY-MM-DD) are required.");
                  if (input.parentNode) { input.parentNode.removeChild(input); }
                  return;
              }
              recountBatchId = batchIdentifier.trim();
              let recountCutOffDate = dateInput; // Use a different variable name to avoid conflict

              // Check if batch ID already exists and create if not
               try {
                  const existingBatch = await DB.getRecountBatchDetails(recountBatchId);
                  if (existingBatch) {
                      alert(`Recount Batch ID "${recountBatchId}" already exists. Please use a unique ID.`);
                      if (input.parentNode) { input.parentNode.removeChild(input); }
                      return;
                  }
                  // Create the batch record in the DB
                  // ** IMPORTANT: The recount batch creation logic needs to be updated in Phase 1.3 **
                  // ** to include parentCycleId. For now, using existing logic. **
                  await DB.createRecountBatch({
                      recountBatchId: recountBatchId,
                      cutOffDate: recountCutOffDate, // Use the prompted date for the recount batch
                      status: 'open',
                      createdAt: new Date().toISOString(),
                      createdBy: getUserIdentifier()
                      // parentCycleId will be added here in Phase 1.3
                  });
                  console.log(`Created recount batch ${recountBatchId} with cut-off ${recountCutOffDate}.`);
               } catch (dbError) {
                   console.error("Error checking/creating recount batch:", dbError);
                   alert(`Failed to create recount batch in database. ${dbError.message}`);
                   if (input.parentNode) { input.parentNode.removeChild(input); }
                   return;
               }
        }
        // --- End Recount Batch Setup ---


        try {
            const fileContent = await readFile(file).catch(readError => {
                throw new Error(`Failed to read file: ${readError.message}`);
            });

            // ** Using Papa Parse ** (Your original parsing logic is kept)
            const result = Papa.parse(fileContent, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: false, // Keep all as strings initially
                transformHeader: header => {
                    let cleanHeader = header;
                    if (cleanHeader && cleanHeader.charCodeAt(0) === 0xFEFF) {
                        cleanHeader = cleanHeader.substring(1);
                    }
                    return cleanHeader ? cleanHeader.trim() : header;
                }
            });
            // ... (Error checking for PapaParse remains the same) ...
            if (result.errors.length > 0) { /* ... throw error ... */ }
            const parsedData = result.data;
            if (!parsedData || parsedData.length === 0) { /* ... throw error ... */ }

            // --- Data Processing ---
            try {
                // Use a map to store the latest state of each item (keyed by itemId) during processing
                let processedItemsMap = new Map();
                // Pre-populate map with existing items from DB for efficient lookup/update
                database.inventory.forEach(item => processedItemsMap.set(item.itemId, { ...item }));

                const identifiersInThisImport = new Set();
                let skippedCount = 0;
                let descChanges = 0;
                let itemsMarkedToCount = 0;
                let itemsAddedToRecount = 0;
                let importAddedCount = 0;
                let importUpdatedCount = 0;

                // --- Header Detection --- (Your original logic is kept)
                const headers = result.meta.fields;
                const findHeader = (possibleNames) => { /* ... */ };
                // ... (find mandatory and optional headers) ...
                const skuHeader = findHeader(['sku', 'item', 'partnumber', 'part number']);
                const locHeader = findHeader(['location', 'loc']);
                const reelNumHeader = findHeader(['reelnumber', 'reel num', 'reel #', 'reel no', 'reel no.', 'reel number']);
                if (!skuHeader) throw new Error("Required header 'SKU' (or similar) not found in CSV.");
                if (!locHeader && !reelNumHeader) throw new Error("Required header 'location' OR 'reelNumber' not found in CSV.");
                const descHeader = findHeader(['description', 'desc']);
                const countHeader = findHeader(['counted', 'quantity', 'qty', 'count']);
                const capturedQtyHeader = findHeader(['capturedquantity', 'expectedquantity', 'expected qty', 'captured qty']);
                // ... etc for other optional headers ...

                // --- Process Rows --- (Your original logic is largely kept, with context adjustments)
                parsedData.forEach((row, index) => {
                    const rowNum = index + 2;
                    const sku = String(row[skuHeader] || '').trim();
                    const location = String(row[locHeader] || '').trim();
                    const reelNumber = String(row[reelNumHeader] || '').trim();

                    // --- Basic Validation and Duplicate Check --- (Your original logic is kept)
                    if (!sku) { /* skip */ return; }
                    if (!location && !reelNumber) { /* skip */ return; }
                    let isLikelyReelFromCSV = reelNumber || (/* check isReelHeader */ false); // Simplified placeholder
                    const fileIdentifier = isLikelyReelFromCSV ? `reel-${reelNumber}` : `sku-${sku}|loc-${location.toLowerCase()}`;
                    if (identifiersInThisImport.has(fileIdentifier)) { /* skip */ return; }
                    if (isLikelyReelFromCSV && !reelNumber) { /* skip */ return; }
                    identifiersInThisImport.add(fileIdentifier);

                    // --- Find Existing Item or Prepare for New One --- (Your original logic is kept)
                    const existingItemRecord = findExistingItemRecord(sku, location, reelNumber); // findExistingItemRecord is in dataLogic.js
                    const itemId = existingItemRecord ? existingItemRecord.itemId : DB.generateSimpleId(); // DB.generateSimpleId is in offlineDB.js
                    const wasExisting = !!existingItemRecord;
                    let currentItemData = processedItemsMap.get(itemId) || {};
                    if (!currentItemData.itemId && wasExisting) { currentItemData = { ...existingItemRecord }; }

                    // --- Merge Data --- (Your original logic is kept)
                    let newItemDataForRow = { ...currentItemData };
                    newItemDataForRow.itemId = itemId;
                    newItemDataForRow.SKU = sku;
                    newItemDataForRow.location = location || (wasExisting ? currentItemData.location : 'No Location');
                    newItemDataForRow.reelNumber = reelNumber || (wasExisting ? currentItemData.reelNumber : '');
                    // ... use getValue, getBooleanValue, getNumericValue helpers ...
                    let existingDesc = currentItemData.Description ?? 'No Description';
                    let incomingDesc = isSetInRow(descHeader) ? String(row[descHeader]).trim() : existingDesc; // Simplified placeholder
                    if (wasExisting && existingDesc !== incomingDesc) {
                        descChanges++;
                        logTransaction({ /* log description change */ }); // logTransaction is in stateManager.js
                    }
                    newItemDataForRow.Description = incomingDesc;
                    // ... merge notes, isActive, isReel, footageFactor, sequences, capturedQuantity, etc. ...

                    // --- Preserve/Reset Count State based on Context ---
                    newItemDataForRow.counted = currentItemData.counted ?? null;
                    newItemDataForRow.isUncounted = currentItemData.isUncounted ?? true;
                    newItemDataForRow.calculatedFootage = currentItemData.calculatedFootage ?? null;
                    newItemDataForRow.lastCountTimestamp = currentItemData.lastCountTimestamp ?? null;
                    const nowTimestamp = new Date().toISOString();

                    if (importContext === 'update') {
                        // Your original logic for 'update' context - CSV count/sequences override
                        // ... check sequences, calculateFootageForItem, check countHeader ...
                    } else if (importContext === 'new_count' || importContext === 'recount') {
                        // *** Core Reset Logic for New Cycle/Recount ***
                        newItemDataForRow.counted = null;
                        newItemDataForRow.isUncounted = true;
                        newItemDataForRow.calculatedFootage = null;
                        newItemDataForRow.lastCountTimestamp = nowTimestamp; // Timestamp reset
                        // Keep sequences from CSV as *captured* data if present, but don't use for count
                        // newItemDataForRow.innerSequence = getValue(innerSeqHeader, 'innerSequence', ''); // Example if reading sequences
                        // ...
                        console.log(`Item ${itemId} count state reset for context: ${importContext}`);
                    }

                    // --- Handle Flags based on Context ---
                    newItemDataForRow.toCount = currentItemData.toCount ?? false;
                    newItemDataForRow.currentRecountBatchId = currentItemData.currentRecountBatchId ?? null;

                    if (importContext === 'new_count') {
                        // Mark item as needing count for this cycle
                        if (!newItemDataForRow.toCount) itemsMarkedToCount++;
                        newItemDataForRow.toCount = true;
                        newItemDataForRow.currentRecountBatchId = null; // Not part of a recount
                    } else if (importContext === 'recount') {
                        // Add item to the specified recount batch
                        if (newItemDataForRow.currentRecountBatchId !== recountBatchId) itemsAddedToRecount++;
                        newItemDataForRow.currentRecountBatchId = recountBatchId;
                        newItemDataForRow.toCount = false; // Not for general count
                    }
                    // 'update' context leaves toCount and currentRecountBatchId unchanged by default

                    // --- Update the map with the processed data ---
                    // applyDataDefaults is in dataLogic.js
                    const finalItemDataArray = applyDataDefaults([newItemDataForRow]);
                    if (finalItemDataArray && finalItemDataArray.length > 0) {
                        processedItemsMap.set(itemId, finalItemDataArray[0]);
                        if (wasExisting) { importUpdatedCount++; } else { importAddedCount++; }
                    } else {
                        skippedCount++; identifiersInThisImport.delete(fileIdentifier); processedItemsMap.delete(itemId);
                    }
                }); // End forEach row

                // --- Post-Processing & Saving ---
                let finalInventory = Array.from(processedItemsMap.values());
                let markedNotToCount = 0;

                // If starting a NEW count cycle, find items NOT in the import and mark them as toCount=false
                if (importContext === 'new_count') {
                    database.inventory.forEach(existingItem => {
                        if (!processedItemsMap.has(existingItem.itemId)) {
                            if (existingItem.toCount) { // Only modify if it was previously 'toCount'
                                markedNotToCount++;
                                // Get a modifiable copy from the map or use the original object
                                let itemToModify = processedItemsMap.get(existingItem.itemId);
                                if (!itemToModify) { // If not already in map (shouldn't happen if pre-populated)
                                     itemToModify = { ...existingItem }; // Clone original
                                     itemToModify.toCount = false; // Mark as not part of the new cycle
                                     itemToModify.lastCountTimestamp = new Date().toISOString(); // Timestamp the change
                                     finalInventory.push(itemToModify); // Add to the final list to be saved
                                } else {
                                     // Already in map, just update the flag
                                     itemToModify.toCount = false;
                                     itemToModify.lastCountTimestamp = new Date().toISOString();
                                }
                            }
                        }
                    });
                     console.log(`New Count Cycle Import: Marked ${markedNotToCount} existing items (not in CSV) as NOT 'toCount'.`);
                }

                // Assign the newly constructed array to the global state
                database.inventory = finalInventory;
                console.log(`In-memory database.inventory updated. Final Size: ${database.inventory.length}`);

                // --- Save all changes to DB ---
                if (importAddedCount > 0 || importUpdatedCount > 0 || markedNotToCount > 0 || itemsAddedToRecount > 0) {
                    try {
                         console.log("Saving updated inventory to IndexedDB...");
                         await DB.saveInventory(database.inventory); // DB.saveInventory is in offlineDB.js
                         console.log("Inventory saved successfully.");
                    } catch (saveError) {
                         console.error("Critical error saving inventory after import:", saveError);
                         throw new Error(`Failed to save changes to database: ${saveError.message}`);
                    }
                } else { console.log("No changes to inventory required saving."); }

                // --- Log Import Transaction ---
                let logDetails = {
                    fileName: file.name, addedCount: importAddedCount, updatedCount: importUpdatedCount,
                    skippedCount: skippedCount, descChanges: descChanges, skusImported: identifiersInThisImport.size
                };
                let logType = 'import_csv'; // Default context: update

                if (importContext === 'new_count') {
                    logType = 'new_count_started_import';
                    logDetails.cycleId = cycleId; // <<< *** ADD cycleId TO LOG ***
                    logDetails.cutOffDate = cutOffDate; // <<< *** ADD cutOffDate TO LOG ***
                    logDetails.itemsMarkedToCount = itemsMarkedToCount;
                    logDetails.markedNotToCount = markedNotToCount;
                } else if (importContext === 'recount') {
                    logType = 'recount_items_imported';
                    logDetails.recountBatchId = recountBatchId;
                    logDetails.itemsAddedToRecount = itemsAddedToRecount;
                }
                if (importAddedCount > 0 || importUpdatedCount > 0 || skippedCount > 0 || markedNotToCount > 0 || itemsAddedToRecount > 0) {
                    await logTransaction({ type: logType, details: logDetails }); // logTransaction in stateManager.js
                }

                // --- Refresh UI ---
                console.log("Applying filters and updating UI after import...");
                applyCurrentFilters(); // applyCurrentFilters in dataLogic.js
                updateSummaryCards(); // updateSummaryCards in uiRenderer.js

                // --- User Feedback --- (Your original logic is kept)
                let message = `Import complete (Context: ${importContext})!`;
                if (importContext === 'new_count') {
                    message += `\nCycle ID: ${cycleId}`;
                }
                message += `\nFile Records Processed: ${identifiersInThisImport.size}`;
                // ... (add other counts as before) ...
                alert(message);

            } catch (processingError) {
                 console.error("Error processing imported CSV data:", processingError);
                 alert(`Error processing CSV data: ${processingError.message}\nOperation cancelled.`);
                 applyCurrentFilters(); updateSummaryCards();
            }
        } catch (error) { // Catches file read or PapaParse errors
            console.error('Error processing CSV:', error);
            alert('Error importing CSV: ' + error.message);
        } finally {
            if (input && input.parentNode) { input.parentNode.removeChild(input); }
        }
    }; // end input.onchange

    document.body.appendChild(input);
    input.click();
}

// Helper to read file content as text
function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = (event) => reject(new Error(`File could not be read: ${event.target.error}`));
        reader.readAsText(file); // Consider specifying encoding if needed, e.g., 'UTF-8'
    });
}

// --- CSV Export ---
// Uses database state from stateManager.js
function exportCSV(data) {
    try {
        if (!data || data.length === 0) {
            alert("No inventory data to export.");
            return;
        }

        // Define headers explicitly including all relevant fields
        const headers = [
            "itemId", // Unique persistent ID (Good for re-import matching)
            "SKU", "Description", "location", "reelNumber", // Core identifiers
            "counted", "isUncounted", "lastCountTimestamp", // Current count state
            "capturedQuantity", // Expected/Historical Qty
            "isActive", "isReel", "isTwoWayReel", // Status & Type
            "footageFactor", // Reel specific
            "innerSequence", "outerSequence", // Seq 1
            "innerSequence2", "outerSequence2", // Seq 2
            "calculatedFootage", // Reel specific result
            "toCount", // Flag for current cycle
            "currentRecountBatchId", // Recount tracking
            "notes" // Metadata
        ];

        const csv = Papa.unparse({
            fields: headers,
             // Map data, ensuring null/undefined are exported as empty strings for compatibility
             data: data.map(item => {
                 const row = {};
                 headers.forEach(header => {
                     // Handle boolean true/false explicitly for clarity in CSV
                     if (typeof item[header] === 'boolean') {
                         row[header] = item[header] ? 'TRUE' : 'FALSE';
                     } else {
                         row[header] = item[header] ?? ''; // Use empty string for null/undefined
                     }
                 });
                 return row;
             })
        }, {
            header: true,
            newline: "\r\n" // Standard CSV newline
        });

        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }); // Add BOM for Excel compatibility
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().slice(0, 10);
        link.setAttribute("href", url);
        link.setAttribute("download", `telecom_inventory_export_${timestamp}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log("CSV export initiated.");

    } catch (error) {
        console.error("Error generating or exporting CSV:", error);
        alert(`Failed to export CSV: ${error.message}. Check console for details.`);
    }
}

// --- PDF Export ---
// Uses currentInventory, currentFilters, getUserIdentifier from stateManager.js
function exportPDF(data) {
    try {
        // Check for jsPDF and AutoTable plugin
        if (typeof jspdf === 'undefined' || typeof jspdf.jsPDF === 'undefined') throw new Error("jsPDF library not found.");
        if (typeof jspdf.jsPDF.API?.autoTable !== 'function') throw new Error("jsPDF AutoTable plugin not found.");

        // Export based on the *currently displayed* filtered data (currentInventory)
        const dataToExport = currentInventory;
        if (!dataToExport || dataToExport.length === 0) {
            alert("No inventory data matching current filters to export to PDF.");
            return;
        }

        const { jsPDF } = jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
        const timestamp = new Date().toLocaleString();
        const user = getUserIdentifier();

        // Construct filter description string dynamically
        let filterParts = [];
         if (currentFilters.location) filterParts.push(`Loc: "${currentFilters.location}"`);
         if (currentFilters.searchTerm) filterParts.push(`Search: "${currentFilters.searchTerm}"`);
         filterParts.push(`Status: "${currentFilters.status}"`);
         switch (currentFilters.filterByToCountStatus) {
             case 'counted': filterParts.push("View: Finished"); break;
             case 'to_count': filterParts.push("View: To Count"); break;
             case 'all': filterParts.push("View: All"); break;
         }
        const filterDesc = `Filters: ${filterParts.join(', ')}`;


        // Define columns for the PDF table
        const columns = [
            { header: 'SKU', dataKey: 'SKU' },
            { header: 'Description', dataKey: 'Description' },
            { header: 'Location', dataKey: 'location' },
            { header: 'Reel#', dataKey: 'reelNumber' }, // Add Reel Number
            { header: 'Qty', dataKey: 'displayQty' }, // Use calculated display value
            { header: 'Status', dataKey: 'displayStatus' }, // Combined status
            { header: 'Notes', dataKey: 'notes' },
        ];

        // Prepare rows with calculated display values
        const rows = dataToExport.map(item => {
            let displayStatus = item.isActive ? (item.toCount ? 'To Count' : 'Finished') : 'Inactive';
            if (item.isUncounted && item.toCount) displayStatus = 'Flagged'; // Indicate if flagged

            let displayQty = item.counted ?? (item.isUncounted ? '---' : '0');
             if (item.calculatedFootage !== null) displayQty = `${item.calculatedFootage.toFixed(2)} ft`;

            return {
                SKU: item.SKU ?? '',
                Description: item.Description ?? '',
                location: item.location ?? '',
                reelNumber: item.reelNumber ?? '', // Add reel number data
                displayQty: displayQty,
                displayStatus: displayStatus,
                notes: item.notes ?? '',
            };
        });

        // Add title and metadata
        doc.setFontSize(16);
        doc.text("Telecom Inventory Report", 40, 40);
        doc.setFontSize(10);
        doc.text(`Generated: ${timestamp} by ${user}`, 40, 55);
        doc.text(filterDesc, doc.internal.pageSize.getWidth() - 40, 55, { align: 'right'});

        // Generate table using AutoTable
        doc.autoTable({
            columns: columns,
            body: rows,
            startY: 70,
            theme: 'grid', // 'striped', 'grid', 'plain'
            headStyles: { fillColor: [44, 62, 80] }, // Dark blue header
            styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' }, // Use linebreak for overflow
            columnStyles: {
                SKU: { cellWidth: 80 },
                Description: { cellWidth: 170 },
                location: { cellWidth: 70 },
                reelNumber: { cellWidth: 60 }, // Width for reel number
                displayQty: { cellWidth: 50, halign: 'right' },
                displayStatus: { cellWidth: 50, halign: 'center' },
                notes: { cellWidth: 'auto' }, // Let notes take remaining space
            },
             didDrawPage: function (data) { // Add footer with page number
                 let footerStr = "Page " + doc.internal.getNumberOfPages();
                 doc.setFontSize(8);
                 doc.text(footerStr, data.settings.margin.left, doc.internal.pageSize.getHeight() - 10);
             }
        });

        const filenameTimestamp = new Date().toISOString().slice(0, 10);
        doc.save(`telecom_inventory_report_${filenameTimestamp}.pdf`);
        console.log("PDF export initiated based on current filters.");

    } catch (error) {
        console.error("Error generating or exporting PDF:", error);
        alert(`Failed to export PDF: ${error.message}. Check console for details.`);
    }
}

// --- Finalize Action Helper ---
// Uses exportCSV/PDF from this file
// Helper function to show export options before finalizing
async function showExportOptionsDialog() {
    return new Promise((resolve) => {
        // Simple prompt for now, replace with a modal for better UX
        const choice = prompt("Export before finalizing?\nOptions:\n1. CSV Only (All Items)\n2. PDF Only (Current Filtered View)\n3. Both CSV and PDF\n4. Cancel Finalization\n\nEnter number (1-4):", "3");

        let exportCSVFlag = false;
        let exportPDFFlag = false;
        let proceed = false;

        switch (choice) {
            case '1':
                exportCSVFlag = true;
                proceed = true;
                break;
            case '2':
                exportPDFFlag = true;
                proceed = true;
                break;
            case '3':
                exportCSVFlag = true;
                exportPDFFlag = true;
                proceed = true;
                break;
            case '4':
            default: // Treat null (cancel button) or invalid input as cancel
                proceed = false;
                break;
        }

        if (proceed) {
             console.log(`Export choice: CSV=${exportCSVFlag}, PDF=${exportPDFFlag}`);
             try {
                if (exportCSVFlag) {
                    console.log("Initiating CSV export of ALL data...");
                    exportCSV(database.inventory); // Export ALL data before finalization changes
                }
                if (exportPDFFlag) {
                     console.log("Initiating PDF export of CURRENTLY FILTERED data...");
                     // PDF Export uses 'currentInventory' which reflects the current filter state.
                     exportPDF(currentInventory);
                }
                 // Allow async time for potential file saves before resolving
                 setTimeout(() => resolve({ proceed: true }), 500); // Small delay
             } catch (exportError) {
                 console.error("Export failed during finalization prompt:", exportError);
                 alert(`Export failed: ${exportError.message}\n\nFinalization cancelled.`);
                 resolve({ proceed: false }); // Indicate cancel due to error
             }
        } else {
            console.log("Finalization cancelled by user at export prompt.");
            resolve({ proceed: false }); // Indicate cancel
        }
    });
}
