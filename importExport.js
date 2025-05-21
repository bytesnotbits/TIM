// --- START OF FILE importExport.js ---
// Check if required libraries are loaded
if (typeof Papa === 'undefined') {
    console.error("PapaParse library not found. CSV features will be unavailable.");
}
// PDF library (jspdf) checked within the exportPDF function

// Global variable to store skipped rows from the last import for download
let lastSkippedImportRows = [];

// Function to download the skipped rows report
function downloadSkippedRowsReport() {
    if (!lastSkippedImportRows || lastSkippedImportRows.length === 0) {
        alert("No skipped rows from the last import to download.");
        return;
    }

    try {
        const csvData = Papa.unparse({
            fields: ["Row Number in File", "Reason Skipped", "SKU", "Location", "ReelNumber", "Full Row Data (JSON)"],
            data: lastSkippedImportRows.map(skipped => ({
                "Row Number in File": skipped.rowNumber,
                "Reason Skipped": skipped.reason,
                "SKU": skipped.rowData?.SKU || skipped.rowData?.[findHeader(['sku', 'item', 'partnumber', 'part number'], Object.keys(skipped.rowData))] || '',
                "Location": skipped.rowData?.location || skipped.rowData?.[findHeader(['location', 'loc'], Object.keys(skipped.rowData))] || '',
                "ReelNumber": skipped.rowData?.reelNumber || skipped.rowData?.[findHeader(['reelnumber', 'reel num', 'reel #', 'reel no', 'reel no.', 'reel number'], Object.keys(skipped.rowData))] || '',
                "Full Row Data (JSON)": JSON.stringify(skipped.rowData)
            }))
        }, {
            header: true,
            newline: "\r\n"
        });

        const blob = new Blob([`\uFEFF${csvData}`], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        link.setAttribute("href", url);
        link.setAttribute("download", `skipped_import_rows_${timestamp}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log("Skipped rows report download initiated.");
    } catch (error) {
        console.error("Error generating skipped rows CSV:", error);
        alert("Failed to generate skipped rows report. Check console.");
    }
}
// Expose to global scope for console calling if needed
window.downloadSkippedRowsReport = downloadSkippedRowsReport;


// Helper to find header (case-insensitive, accounts for BOM)
// Moved to be accessible by downloadSkippedRowsReport as well
const findHeader = (possibleNames, actualHeaders) => {
    for (const pName of possibleNames) {
        const foundHeader = actualHeaders.find(h => {
            let cleanH = h;
            if (cleanH && cleanH.charCodeAt(0) === 0xFEFF) { // BOM
                cleanH = cleanH.substring(1);
            }
            return cleanH && cleanH.trim().toLowerCase() === pName.toLowerCase();
        });
        if (foundHeader) return foundHeader; // Return the actual header name from the file
    }
    return null;
};


// MODIFIED to handle itemId structure, import contexts, and use findExistingItemRecord
// Accepts cycleId and cutOffDateStr for 'new_count' context.
async function showImportDialog(importContext = 'update', cycleId = null, cutOffDateStr = null) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv, text/csv';
    input.style.display = 'none';
    lastSkippedImportRows = []; // Clear previous skipped rows

    console.log(`showImportDialog called with Context: ${importContext}, CycleID: ${cycleId}, CutOffDate: ${cutOffDateStr}`);

    input.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) {
             if (input.parentNode) { input.parentNode.removeChild(input); } // Clean up if no file selected
            return;
        }
        console.log(`Attempting to import CSV: ${file.name} (Context: ${importContext})`);

        // Specific to 'recount' context
        let recountBatchId = null;
        let recountCutOffDate = null;

        // Recount Batch Setup (if importContext === 'recount')
        if (importContext === 'recount') {
            let parentCycleIdForRecount = null;
            try {
                const openCycle = await DB.getOpenCycle();
                if (openCycle) {
                    parentCycleIdForRecount = openCycle.cycleId;
                }
            } catch (e) {
                console.warn("Could not determine open cycle for recount batch:", e);
            }

            // The prompts and variable assignments for recountBatchId and recountCutOffDate
             const batchIdentifier = prompt(`Enter a unique identifier for this RECOUNT batch (e.g., YYMMDD.R<n>, like ${new Date().toISOString().slice(2,10).replace(/-/g,'')}.R1):`);
             const dateInput = prompt(`Enter the Cut-off Date for this recount batch (YYYY-MM-DD):`); 

             if (!batchIdentifier || !dateInput || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
                 alert("Recount import cancelled: Valid Batch Identifier and Cut-off Date (YYYY-MM-DD) are required.");
                 if (input.parentNode) { input.parentNode.removeChild(input); }
                 return;
             }
             recountBatchId = batchIdentifier.trim();
             recountCutOffDate = dateInput; // Variable specific to recount context // Corrected: was 'let recountCutOffDate'

             try {
                 const existingBatch = await DB.getRecountBatchDetails(recountBatchId);
                 if (existingBatch) {
                     alert(`Recount Batch ID "${recountBatchId}" already exists. Please use a unique ID.`);
                     if (input.parentNode) { input.parentNode.removeChild(input); }
                     return;
                 }
                 // Create the batch record in the DB
                 // This is the ONLY DB.createRecountBatch call for recounts
                await DB.createRecountBatch({
                    recountBatchId: recountBatchId,
                    cutOffDate: recountCutOffDate,
                    status: 'open',
                    createdAt: new Date().toISOString(),
                    createdBy: getUserIdentifier(),
                    parentCycleId: parentCycleIdForRecount // Correctly passed
                });
                console.log(`Created recount batch ${recountBatchId} with cut-off ${recountCutOffDate} and parentCycleId ${parentCycleIdForRecount}.`);
            } catch (dbError) {
                console.error("Error checking/creating recount batch:", dbError);
                alert(`Failed to create recount batch in database. ${dbError.message}`);
                if (input.parentNode) { input.parentNode.removeChild(input); }
                return;
            }
        }

        try {
            const fileContent = await readFile(file).catch(readError => {
                throw new Error(`Failed to read file: ${readError.message}`);
            });

            const result = Papa.parse(fileContent, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: false, 
                transformHeader: header => {
                    let cleanHeader = header;
                    if (cleanHeader && cleanHeader.charCodeAt(0) === 0xFEFF) {
                        cleanHeader = cleanHeader.substring(1);
                    }
                    return cleanHeader ? cleanHeader.trim() : header;
                }
            });
            
            if (result.errors.length > 0) {
                console.error("CSV Parsing Errors:", result.errors);
                const errorMessages = result.errors.map(err => `Row ${err.row}: ${err.message}`).join('\n');
                throw new Error(`CSV parsing failed:\n${errorMessages}`);
            }
            const parsedData = result.data;
            if (!parsedData || parsedData.length === 0) {
                throw new Error("CSV file is empty or contains no data rows.");
            }

            // --- Header Detection (using the global findHeader function) ---
            const headers = result.meta.fields;
            const skuHeader = findHeader(['sku', 'item', 'partnumber', 'part number'], headers);
            const locHeader = findHeader(['location', 'loc'], headers);
            const reelNumHeader = findHeader(['reelnumber', 'reel num', 'reel #', 'reel no', 'reel no.', 'reel number'], headers);

            if (!skuHeader) throw new Error("Required header 'SKU' (or similar) not found in CSV.");
            if (!locHeader && !reelNumHeader) throw new Error("CSV must contain either a 'Location' or 'ReelNumber' column (or similar).");
            
            // Optional headers
            const descHeader = findHeader(['description', 'desc'], headers);
            const countHeader = findHeader(['counted', 'quantity', 'qty', 'count'], headers);
            const capturedQtyHeader = findHeader(['capturedquantity', 'expectedquantity', 'expected qty', 'captured qty'], headers);
            const notesHeader = findHeader(['notes', 'note'], headers); 
            const isActiveHeader = findHeader(['isactive', 'active'], headers);
            const isReelHeader = findHeader(['isreel', 'reel'], headers);
            const isTwoWayReelHeader = findHeader(['istwowayreel', 'twowayreel', '2wayreel'], headers); 
            const footageFactorHeader = findHeader(['footagefactor', 'factor'], headers); 
            const innerSeqHeader = findHeader(['innersequence', 'innerseq', 'inner1'], headers); 
            const outerSeqHeader = findHeader(['outersequence', 'outerseq', 'outer1'], headers); 
            const innerSeq2Header = findHeader(['innersequence2', 'innerseq2', 'inner2'], headers); 
            const outerSeq2Header = findHeader(['outersequence2', 'outerseq2', 'outer2'], headers); 
            
            console.log("Detected Headers:", { skuHeader, locHeader, reelNumHeader, descHeader /* ... and others */ });

            // Helper functions for processing row data.
            // **MODIFIED: Pass 'row' as the first argument.**
            const getValue = (row, headerName, currentVal, defaultValue = '') => {
                return headerName && row.hasOwnProperty(headerName) && row[headerName] !== undefined && row[headerName] !== null
                       ? String(row[headerName]).trim()
                       : (currentVal ?? defaultValue);
            };

            const getNumericValue = (row, headerName, currentVal, defaultValue = null) => {
                if (headerName && row.hasOwnProperty(headerName) && row[headerName] !== undefined && row[headerName] !== null && String(row[headerName]).trim() !== '') {
                    const num = Number(String(row[headerName]).trim());
                    return isNaN(num) ? defaultValue : num;
                }
                return currentVal ?? defaultValue;
            };

            const getBooleanValue = (row, headerName, currentVal, defaultValue = false) => {
                if (headerName && row.hasOwnProperty(headerName) && row[headerName] !== undefined && row[headerName] !== null) {
                    const valStr = String(row[headerName]).trim().toLowerCase();
                    if (valStr === 'true' || valStr === 'yes' || valStr === '1') return true;
                    if (valStr === 'false' || valStr === 'no' || valStr === '0') return false;
                }
                return currentVal ?? defaultValue;
            };

            const isSetInRow = (row, headerName) => {
                return headerName && row.hasOwnProperty(headerName) && row[headerName] !== undefined && row[headerName] !== null && String(row[headerName]).trim() !== '';
            };


            // *** DEFERRED CYCLE CREATION for 'new_count' ***
            if (importContext === 'new_count') {
                if (!cycleId || !cutOffDateStr) {
                    console.error("Critical: 'new_count' context missing cycleId or cutOffDateStr.");
                    throw new Error("Internal error: Cycle information missing for new count initialization.");
                }
                const cycleData = {
                    cycleId: cycleId,
                    cutOffDate: cutOffDateStr,
                    startDate: new Date().toISOString(),
                    status: 'open',
                    finalizedTimestamp: null,
                    createdBy: getUserIdentifier() 
                };
                try {
                    await DB.saveCycle(cycleData); 
                    console.log(`New count cycle ${cycleId} created and saved successfully.`);
                } catch (cycleSaveError) {
                    console.error(`Failed to save new count cycle ${cycleId}:`, cycleSaveError);
                    alert(`Error: Could not save the new count cycle information. Import aborted. ${cycleSaveError.message}`);
                    if (input.parentNode) { input.parentNode.removeChild(input); } 
                    return; 
                }
            }
            // *** END DEFERRED CYCLE CREATION ***

            let importAddedCount = 0;
            let importUpdatedCount = 0;
            let skippedCount = 0;
            let descChanges = 0;
            let itemsMarkedToCount = 0; 
            let itemsAddedToRecount = 0; 
            
            const identifiersInThisImport = new Set(); 
            let processedItemsForSave = [];

            // --- Process Rows (Main Loop) ---
            for (let index = 0; index < parsedData.length; index++) {
                const row = parsedData[index]; // 'row' is defined here for the current iteration
                const rowNum = index + 2; 

                const sku = String(row[skuHeader] || '').trim();
                let location = locHeader ? String(row[locHeader] || '').trim() : '';
                let reelNumber = reelNumHeader ? String(row[reelNumHeader] || '').trim() : '';

                if (!sku) {
                    skippedCount++;
                    lastSkippedImportRows.push({ rowNumber: rowNum, rowData: row, reason: "Missing SKU" });
                    continue;
                }
                if (!location && !reelNumber) {
                    skippedCount++;
                    lastSkippedImportRows.push({ rowNumber: rowNum, rowData: row, reason: "Missing Location AND ReelNumber" });
                    continue;
                }

                const isLikelyReelFromCSV = !!reelNumber;
                if (isLikelyReelFromCSV && !reelNumber) { // This condition is redundant given the above, but safe
                     skippedCount++;
                     lastSkippedImportRows.push({ rowNumber: rowNum, rowData: row, reason: "Reel item indicated but ReelNumber is missing/empty." });
                     continue;
                }
                
                const fileIdentifier = isLikelyReelFromCSV ? `sku-${sku}|reel-${reelNumber}` : `sku-${sku}|loc-${location.toLowerCase()}`;
                if (identifiersInThisImport.has(fileIdentifier)) {
                    skippedCount++;
                    lastSkippedImportRows.push({ rowNumber: rowNum, rowData: row, reason: "Duplicate SKU+ReelNumber or SKU+Location within this CSV file." });
                    continue;
                }
                identifiersInThisImport.add(fileIdentifier);

                // --- Database Lookup ---
                let existingItemRecord = null;
                if (isLikelyReelFromCSV) {
                    existingItemRecord = await DB.findItemBySkuAndReelNumber(sku, reelNumber);
                } else {
                    existingItemRecord = await DB.findItemBySkuAndLocation(sku, location);
                }
                
                const wasExisting = !!existingItemRecord;
                let currentItemData = wasExisting ? { ...existingItemRecord } : {};

                // --- Merge Data ---
                let newItemDataForRow = { ...currentItemData }; 
                newItemDataForRow.itemId = wasExisting ? existingItemRecord.itemId : DB.generateSimpleId(); 
                newItemDataForRow.SKU = sku;

                // **MODIFIED: Pass 'row' to helper functions**
                newItemDataForRow.location = isSetInRow(row, locHeader) ? location : (wasExisting ? currentItemData.location : (isLikelyReelFromCSV ? '' : 'No Location'));
                newItemDataForRow.reelNumber = isSetInRow(row, reelNumHeader) ? reelNumber : (wasExisting ? currentItemData.reelNumber : '');

                const existingDesc = currentItemData.Description ?? '';
                const incomingDesc = getValue(row, descHeader, existingDesc, 'No Description');
                if (wasExisting && existingDesc !== incomingDesc && incomingDesc !== 'No Description') {
                    descChanges++;
                }
                newItemDataForRow.Description = incomingDesc;

                newItemDataForRow.notes = getValue(row, notesHeader, currentItemData.notes, '');
                newItemDataForRow.isActive = getBooleanValue(row, isActiveHeader, currentItemData.isActive, true);
                
                newItemDataForRow.isReel = getBooleanValue(row, isReelHeader, currentItemData.isReel, isLikelyReelFromCSV);
                if (newItemDataForRow.isReel) {
                    newItemDataForRow.isTwoWayReel = getBooleanValue(row, isTwoWayReelHeader, currentItemData.isTwoWayReel, false);
                    newItemDataForRow.footageFactor = getNumericValue(row, footageFactorHeader, currentItemData.footageFactor, null);
                    newItemDataForRow.innerSequence = getValue(row, innerSeqHeader, currentItemData.innerSequence, '');
                    newItemDataForRow.outerSequence = getValue(row, outerSeqHeader, currentItemData.outerSequence, '');
                    if (newItemDataForRow.isTwoWayReel) {
                        newItemDataForRow.innerSequence2 = getValue(row, innerSeq2Header, currentItemData.innerSequence2, '');
                        newItemDataForRow.outerSequence2 = getValue(row, outerSeq2Header, currentItemData.outerSequence2, '');
                    } else {
                        newItemDataForRow.innerSequence2 = ''; newItemDataForRow.outerSequence2 = '';
                    }
                } else { 
                    newItemDataForRow.isTwoWayReel = false; newItemDataForRow.footageFactor = null;
                    newItemDataForRow.innerSequence = ''; newItemDataForRow.outerSequence = '';
                    newItemDataForRow.innerSequence2 = ''; newItemDataForRow.outerSequence2 = '';
                    newItemDataForRow.calculatedFootage = null; 
                }
                newItemDataForRow.capturedQuantity = getNumericValue(row, capturedQtyHeader, currentItemData.capturedQuantity, null);

                // Preserve/Reset Count State based on Context
                const nowTimestamp = new Date().toISOString();
                if (importContext === 'update') {
                    if (isSetInRow(row, countHeader)) {
                        newItemDataForRow.counted = getNumericValue(row, countHeader, currentItemData.counted);
                        newItemDataForRow.isUncounted = newItemDataForRow.counted === null;
                        newItemDataForRow.lastCountTimestamp = newItemDataForRow.counted !== null ? nowTimestamp : currentItemData.lastCountTimestamp;
                        if (!isSetInRow(row, innerSeqHeader) && !isSetInRow(row, outerSeqHeader)) {
                            newItemDataForRow.calculatedFootage = null;
                        }
                    }
                } else if (importContext === 'new_count' || importContext === 'recount') {
                    newItemDataForRow.counted = null;
                    newItemDataForRow.isUncounted = true;
                    newItemDataForRow.lastCountTimestamp = nowTimestamp;
                    newItemDataForRow.calculatedFootage = null;
                }

                // Handle Flags based on Context
                if (importContext === 'new_count') {
                    if (!newItemDataForRow.toCount) itemsMarkedToCount++;
                    newItemDataForRow.toCount = true;
                    newItemDataForRow.currentRecountBatchId = null;
                } else if (importContext === 'recount') {
                    if (newItemDataForRow.currentRecountBatchId !== recountBatchId) itemsAddedToRecount++;
                    newItemDataForRow.currentRecountBatchId = recountBatchId;
                    newItemDataForRow.toCount = true; 
                } else { 
                    newItemDataForRow.toCount = currentItemData.toCount ?? false;
                    newItemDataForRow.currentRecountBatchId = currentItemData.currentRecountBatchId ?? null;
                }
                
                const [processedItem] = applyDataDefaults([newItemDataForRow]); 
                
                if (importContext === 'update' && processedItem.isReel && processedItem.footageFactor > 0 && (isSetInRow(row, innerSeqHeader) || isSetInRow(row, outerSeqHeader))) {
                     const tempSequences = {
                        inner1: processedItem.innerSequence, outer1: processedItem.outerSequence,
                        inner2: processedItem.innerSequence2, outer2: processedItem.outerSequence2
                     };
                     const calculatedFootageFromCSV = calculateFootageForItem(processedItem, tempSequences); 
                     if (calculatedFootageFromCSV !== null) { 
                        processedItem.counted = calculatedFootageFromCSV; 
                        processedItem.isUncounted = false;
                        processedItem.lastCountTimestamp = nowTimestamp;
                     }
                }

                if (processedItem) {
                    processedItemsForSave.push(processedItem);
                    if (wasExisting) { importUpdatedCount++; } else { importAddedCount++; }
                } else {
                    skippedCount++;
                    lastSkippedImportRows.push({ rowNumber: rowNum, rowData: row, reason: "Failed data defaults application." });
                    identifiersInThisImport.delete(fileIdentifier);
                }
            } // End for loop

            // --- Post-Processing & Saving ---
            let finalInventoryState = [...database.inventory]; 
            
            processedItemsForSave.forEach(newItem => {
                const existingIndex = finalInventoryState.findIndex(item => item.itemId === newItem.itemId);
                if (existingIndex > -1) {
                    finalInventoryState[existingIndex] = newItem; 
                } else {
                    finalInventoryState.push(newItem); 
                }
            });

            let markedNotToCount = 0;
            if (importContext === 'new_count') {
                const importedItemIds = new Set(processedItemsForSave.map(item => item.itemId));
                finalInventoryState = finalInventoryState.map(item => {
                    if (!importedItemIds.has(item.itemId) && item.toCount) {
                        markedNotToCount++;
                        return { ...item, toCount: false, lastCountTimestamp: new Date().toISOString() };
                    }
                    return item;
                });
            }

            database.inventory = finalInventoryState; 
            console.log(`In-memory database.inventory updated. Final Size: ${database.inventory.length}`);

            if (importAddedCount > 0 || importUpdatedCount > 0 || (importContext === 'new_count' && markedNotToCount > 0)) {
                await DB.saveInventory(database.inventory);
                console.log("Inventory saved successfully to IndexedDB.");
            } else { console.log("No changes to inventory required saving from this import."); }

            // --- Log Import Transaction ---
            let logDetails = {
                fileName: file.name, addedCount: importAddedCount, updatedCount: importUpdatedCount,
                skippedCount: skippedCount, descChanges: descChanges, recordsInFile: parsedData.length
            }; 
            let logType = 'import_csv';

            if (importContext === 'new_count') {
                logType = 'new_count_started_import';
                logDetails.cycleId = cycleId; 
                logDetails.cutOffDate = cutOffDateStr; 
                logDetails.itemsMarkedToCount = itemsMarkedToCount + importAddedCount; // Corrected: was skusImported which is not defined
                logDetails.markedNotToCount = markedNotToCount;
            } else if (importContext === 'recount') {
                logType = 'recount_items_imported';
                logDetails.recountBatchId = recountBatchId;
                logDetails.itemsAddedToRecount = itemsAddedToRecount;
            }
            if (importAddedCount > 0 || importUpdatedCount > 0 || skippedCount > 0 || markedNotToCount > 0 || itemsAddedToRecount > 0) {
                await logTransaction({ type: logType, details: logDetails }); 
            }

            applyCurrentFilters();  
            updateSummaryCards(); 

            // --- User Feedback ---
            let message = `Import complete (Context: ${importContext})!\n`;
            message += `File: ${file.name}\n`;
            message += `Records in File: ${parsedData.length}\n`;
            message += `Added to Inventory: ${importAddedCount}\n`;
            message += `Updated in Inventory: ${importUpdatedCount}\n`;
            message += `Skipped Rows: ${skippedCount}`;

            if (importContext === 'new_count') {
                message += `\nCycle ID: ${cycleId}`;
                message += `\nItems Marked 'To Count': ${itemsMarkedToCount + importAddedCount}`;
                message += `\nExisting Items Marked NOT 'To Count': ${markedNotToCount}`;
            }
            if (importContext === 'recount') {
                message += `\nRecount Batch ID: ${recountBatchId}`;
                message += `\nItems Processed for Recount: ${itemsAddedToRecount}`; // Corrected: was itemsMarkedToCount
            }
            if (descChanges > 0) message += `\nDescription changes: ${descChanges}`;
            
            const existingDownloadButton = document.getElementById('downloadSkippedReportBtn');
            if (existingDownloadButton) existingDownloadButton.remove();

            if (skippedCount > 0) {
                message += `\n\nSkipped rows report is available.`;
                const quickActionsSection = document.querySelector('.quick-actions');
                if (quickActionsSection) {
                    const downloadBtn = document.createElement('button');
                    downloadBtn.id = 'downloadSkippedReportBtn';
                    downloadBtn.textContent = `Download ${skippedCount} Skipped Rows`;
                    downloadBtn.className = 'btn-warning'; 
                    downloadBtn.onclick = () => {
                        downloadSkippedRowsReport();
                        downloadBtn.remove(); 
                    };
                    quickActionsSection.appendChild(downloadBtn);
                     message += ` Click the 'Download Skipped Rows' button.`;
                } else {
                    message += ` Call downloadSkippedRowsReport() in console to get them.`;
                }
            }
            alert(message);

        } catch (processingError) {
             console.error("Error processing imported CSV data:", processingError);
             alert(`Error processing CSV data: ${processingError.message}\nOperation cancelled.`);
             if (typeof applyCurrentFilters === 'function') applyCurrentFilters();
             if (typeof updateSummaryCards === 'function') updateSummaryCards();
        } finally {
            if (input && input.parentNode) { input.parentNode.removeChild(input); }
        }
    }; 

    document.body.appendChild(input);
    input.click(); 
} 


// Helper to read file content as text
function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = (event) => reject(new Error(`File could not be read: ${event.target.error}`));
        reader.readAsText(file); 
    });
}

// --- CSV Export ---
function exportCSV(data) {
    try {
        if (!data || data.length === 0) {
            alert("No inventory data to export.");
            return;
        }
        const headers = [
            "itemId", "SKU", "Description", "location", "reelNumber", 
            "counted", "isUncounted", "lastCountTimestamp", "capturedQuantity", 
            "isActive", "isReel", "isTwoWayReel", "footageFactor", 
            "innerSequence", "outerSequence", "innerSequence2", "outerSequence2", 
            "calculatedFootage", "toCount", "currentRecountBatchId", "notes"
        ];

        const csv = Papa.unparse({
            fields: headers,
             data: data.map(item => {
                 const row = {};
                 headers.forEach(header => {
                     if (typeof item[header] === 'boolean') {
                         row[header] = item[header] ? 'TRUE' : 'FALSE';
                     } else {
                         row[header] = item[header] ?? ''; 
                     }
                 });
                 return row;
             })
        }, {
            header: true,
            newline: "\r\n" 
        });

        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }); 
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
function exportPDF(data) {
    try {
        if (typeof jspdf === 'undefined' || typeof jspdf.jsPDF === 'undefined') throw new Error("jsPDF library not found.");
        if (typeof jspdf.jsPDF.API?.autoTable !== 'function') throw new Error("jsPDF AutoTable plugin not found.");

        const dataToExport = currentInventory; 
        if (!dataToExport || dataToExport.length === 0) {
            alert("No inventory data matching current filters to export to PDF.");
            return;
        }

        const { jsPDF } = jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
        const timestamp = new Date().toLocaleString();
        const user = getUserIdentifier();

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

        const columns = [
            { header: 'SKU', dataKey: 'SKU' },
            { header: 'Description', dataKey: 'Description' },
            { header: 'Location', dataKey: 'location' },
            { header: 'Reel#', dataKey: 'reelNumber' }, 
            { header: 'Qty', dataKey: 'displayQty' }, 
            { header: 'Status', dataKey: 'displayStatus' }, 
            { header: 'Notes', dataKey: 'notes' },
        ];

        const rows = dataToExport.map(item => {
            let displayStatus = item.isActive ? (item.toCount ? 'To Count' : 'Finished') : 'Inactive';
            if (item.isUncounted && item.toCount) displayStatus = 'Flagged'; 

            let displayQty = item.counted ?? (item.isUncounted ? '---' : '0');
             if (item.calculatedFootage !== null) displayQty = `${item.calculatedFootage.toFixed(2)} ft`;

            return {
                SKU: item.SKU ?? '',
                Description: item.Description ?? '',
                location: item.location ?? '',
                reelNumber: item.reelNumber ?? '', 
                displayQty: displayQty,
                displayStatus: displayStatus,
                notes: item.notes ?? '',
            };
        });

        doc.setFontSize(16);
        doc.text("Telecom Inventory Report", 40, 40);
        doc.setFontSize(10);
        doc.text(`Generated: ${timestamp} by ${user}`, 40, 55);
        doc.text(filterDesc, doc.internal.pageSize.getWidth() - 40, 55, { align: 'right'});

        doc.autoTable({
            columns: columns,
            body: rows,
            startY: 70,
            theme: 'grid', 
            headStyles: { fillColor: [44, 62, 80] }, 
            styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' }, 
            columnStyles: {
                SKU: { cellWidth: 80 },
                Description: { cellWidth: 170 },
                location: { cellWidth: 70 },
                reelNumber: { cellWidth: 60 }, 
                displayQty: { cellWidth: 50, halign: 'right' },
                displayStatus: { cellWidth: 50, halign: 'center' },
                notes: { cellWidth: 'auto' }, 
            },
             didDrawPage: function (data) { 
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
async function showExportOptionsDialog() {
    return new Promise((resolve) => {
        const choice = prompt("Export before finalizing?\nOptions:\n1. CSV Only (All Items)\n2. PDF Only (Current Filtered View)\n3. Both CSV and PDF\n4. Cancel Finalization\n\nEnter number (1-4):", "3");

        let exportCSVFlag = false;
        let exportPDFFlag = false;
        let proceed = false;

        switch (choice) {
            case '1': exportCSVFlag = true; proceed = true; break;
            case '2': exportPDFFlag = true; proceed = true; break;
            case '3': exportCSVFlag = true; exportPDFFlag = true; proceed = true; break;
            case '4': default: proceed = false; break;
        }

        if (proceed) {
             console.log(`Export choice: CSV=${exportCSVFlag}, PDF=${exportPDFFlag}`);
             try {
                if (exportCSVFlag) {
                    console.log("Initiating CSV export of ALL data...");
                    exportCSV(database.inventory); 
                }
                if (exportPDFFlag) {
                     console.log("Initiating PDF export of CURRENTLY FILTERED data...");
                     exportPDF(currentInventory);
                }
                 setTimeout(() => resolve({ proceed: true }), 500); 
             } catch (exportError) {
                 console.error("Export failed during finalization prompt:", exportError);
                 alert(`Export failed: ${exportError.message}\n\nFinalization cancelled.`);
                 resolve({ proceed: false }); 
             }
        } else {
            console.log("Finalization cancelled by user at export prompt.");
            resolve({ proceed: false }); 
        }
    });
}

// --- END OF FILE importExport.js ---