# Telecom Inventory Helper

A simple, offline-first web application designed to help manage and count telecom inventory items, with specific features for handling reels and calculating footage. Built with vanilla JavaScript, HTML, and CSS, using IndexedDB for local storage.

**(Note: This is a client-side only application. All data is stored locally in your browser's IndexedDB database.)**

## Overview

This tool provides a user-friendly interface for:

*   Maintaining a list of inventory items (SKU, Description, Location, Reel Number).
*   Managing inventory count cycles using CSV imports to define what needs counting.
*   Performing inventory counts, including manual quantity entry and footage calculation for cable reels.
*   Tracking the status of items (Active, Inactive, Counted, Uncounted).
*   Importing inventory lists from CSV files (for initial setup, cycle start, or general updates).
*   Exporting the current inventory state to CSV or PDF formats (prompted during finalization).
*   Logging all significant actions (counts, imports, status changes) for an audit trail.
*   Finalizing a count cycle, which deactivates specific reels and prepares for the next cycle.

## Key Features

*   **Offline First:** Uses IndexedDB to store all inventory data and transaction history locally in the browser. Works without an internet connection after initial load.
*   **Count Cycle Management:**
    *   **Start New Count Cycle:** Initiates a CSV import. Items listed in the CSV are marked with a `toCount` flag, making them visible for the current cycle. Items *not* in the CSV are hidden. Sequence data in *this specific* import is treated as historical reference and *does not* update the quantity.
    *   **Finalize Inventory:** Prompts the user to export data (CSV/PDF/Both). Then, marks *active REELS* with zero or null quantity as "inactive". Finally, clears the `toCount` flag from *all* items, effectively ending the current cycle and hiding items from the main view until the next cycle starts.
*   **Targeted Counting:** The main inventory list primarily displays only items marked `toCount = true` for the current cycle.
*   **Inventory Management:** Add, view, and update inventory items with details like SKU, Description, Location, Reel Number, and Notes.
*   **Quantity Counting & Flagging:** Easily input counted quantities or flag items as "uncounted".
*   **Reel Footage Calculation:** Supports standard and "two-way" reels. Automatically calculates footage based on inner/outer sequence numbers and a defined footage factor, updating the item's quantity (except during the "Start New Count" import).
*   **Filtering & Status:** Filter the displayed (`toCount = true`) inventory list by location and status (Active, Inactive, All). Items are visually distinguished based on their status (Counted, Uncounted, Inactive).
*   **CSV Import/Export:**
    *   Import inventory data from a CSV file (headers detected automatically, see format below). Used for starting cycles or general updates.
    *   Export the complete inventory or filtered view to a CSV file (prompted during finalization).
*   **PDF Export:** Generate a printable PDF report of the currently filtered inventory view (prompted during finalization).
*   **Transaction History:**
    *   Logs actions like count updates, flagging, imports (cycle start vs regular), description changes, status changes, and cycle management.
    *   View a global history of all transactions.
    *   View the specific history for an individual item via a modal dialog.
*   **User Identification:** Records a user-provided name/ID alongside transactions in the history log.
*   **Responsive Design:** Basic responsiveness for use on different screen sizes.

## Getting Started

This is a client-side application and does not require a web server to run.

1.  **Download/Clone:** Download or clone this repository to your local machine.
2.  **Dependencies:** Ensure the following JavaScript library files are present in the same directory as `index.html` (or update the paths in `index.html` if you place them elsewhere):
    *   `papaparse.min.js` (for CSV parsing)
    *   `jspdf.umd.min.js` (for PDF generation)
    *   `jspdf.plugin.autotable.min.js` (for PDF table generation)
    *   *(You can typically download these from their respective project websites/CDNs)*
3.  **Open:** Open the `index.html` file directly in a modern web browser (like Chrome, Firefox, Edge, Safari) that supports IndexedDB and ES6+ JavaScript.

## Usage Workflow

1.  **Set Counter Name:** Enter your name or identifier in the "Counter Name" field.
2.  **Start a Count Cycle:**
    *   Click "Start New Count Cycle".
    *   Select the CSV file containing *all* SKUs that need to be counted in this cycle.
    *   Items from the CSV will be added or updated, and marked `toCount = true`. They will appear in the list. Items *not* in the CSV will be hidden (`toCount = false`).
3.  **Filter (Optional):** Use the "Filter Location" and "Status" controls to further refine the list of items *to be counted*.
4.  **Count/Update Items:**
    *   Work through the filtered list.
    *   Enter quantities, flag items, enter reel sequences, add notes.
    *   Changes are auto-saved.
    *   *(Optional: Perform mid-cycle CSV imports using the "Import CSV" button for updates, without affecting the `toCount` flags set by "Start New Count Cycle".)*
5.  **Finalize the Cycle:**
    *   Click "Finalize Inventory".
    *   Choose your desired export format (CSV, PDF, Both, or Cancel). Exports will be generated.
    *   Confirm the finalization warning.
    *   *Active REELS* with 0 or null quantity will be marked inactive.
    *   The `toCount` flag will be cleared for *all* items, emptying the main list.
    *   The application is now ready for the next "Start New Count Cycle".
6.  **View History:** Use the item-specific or global history views at any time.

## CSV Import Format

The CSV importer uses PapaParse and attempts to automatically detect headers (case-insensitive).

*   **Required Header:**
    *   `SKU` (or `item`, `partnumber`, `part number`) - The unique identifier for the item. Rows without a SKU will be skipped.
*   **Required Header for Reels (for duplicate check):**
    *   `reelNumber` (or `reel num`, `reel #`, `reel no`, `reel no.`, `reel number`) - Unique identifier for the specific reel. Required if the item is identified as a reel; rows missing this for reels will be skipped.
*   **Recommended Headers:**
    *   `Description` (or `desc`)
    *   `location` (or `loc`)
*   **Optional Headers (Will update existing item data or set for new items):**
    *   `counted` (or `quantity`, `qty`, `count`) - Explicit quantity. *Note: This is ignored if valid sequences are provided for a reel (unless it's the "Start New Count" import).*
    *   `capturedQuantity` (or `expectedquantity`, `expected qty`, `captured qty`) - An optional field to store an expected or previously recorded quantity.
    *   `notes` (or `note`, `comments`)
    *   `isActive` (or `active`) - `true`, `1`, `yes` for active; `false`, `0`, `no` for inactive. Defaults to active if missing or not recognized as inactive.
    *   `isReel` (or `reel`, `reel #`, `reel no`, `reel no.`, `reel number`) - `true`, `1`, `yes` if it's a reel; otherwise `false`. Item also considered a reel if `reelNumber` is provided. Defaults to false.
    *   `isTwoWayReel` (or `twowayreel`, `two way reel`, 'two-way', '2-way', '2 way') - `true`, `1`, `yes` if it's a two-way reel; otherwise `false`. Only applicable if `isReel` is true. Defaults to false.
    *   `footageFactor` (or `factor`, `ft factor`, 'feet', 'footage', 'ft', 'reelft', 'reel ft', 'reel footage') - The numerical factor used for footage calculation on reels.
    *   `innerSequence` (or `inner seq`, `inner`, 'in1', 'inner1', 'i1') - First inner sequence number.
    *   `outerSequence` (or `outer seq`, `outer`, 'ou1', 'outer1', 'o1') - First outer sequence number.
    *   `innerSequence2` (or `inner seq 2`, `inner2`, 'in2', 'inner2', 'i2') - Second inner sequence number (for two-way reels).
    *   `outerSequence2` (or `outer seq 2`, `outer2`, 'ou2', 'outer2', 'o2') - Second outer sequence number (for two-way reels).

**Import Logic:**

*   **Duplicate Skipping (within the same file):**
    *   **Non-Reels:** Skipped if another row in the *same file* has the same SKU and the same Location.
    *   **Reels:** Skipped if another row in the *same file* has the same `reelNumber`. Reels missing a `reelNumber` are skipped.
*   **Updates/Adds:** If not skipped, the item is added (if new SKU) or updated (if existing SKU).
*   **Description Changes:** Logged if the imported description differs from the existing one.
*   **Sequence Handling:**
    *   **During "Start New Count" Import:** Sequences are stored, but *not* used to calculate or update the `counted` quantity. Items are marked `toCount = true` and `isUncounted = true`.
    *   **During Regular "Import CSV":** Sequences *are* used to calculate footage and update `counted` quantity if valid and the item is a reel with a factor.
*   **`toCount` Flag:** Only modified during the "Start New Count" import (sets to true for items in file, false for others) and "Finalize Inventory" (sets all to false). Regular imports do not change this flag.

## Technical Details

*   **Frontend:** HTML5, CSS3, JavaScript (ES6+)
*   **Storage:** Browser IndexedDB (via `offlineDB.js` wrapper)
*   **Libraries:**
    *   PapaParse.js (CSV Parsing)
    *   jsPDF.js & jsPDF-AutoTable plugin (PDF Generation)

## Future Enhancements Ideas

*   Implement robust search functionality within the inventory list (possibly searching beyond just `toCount=true` items).
*   Add more advanced filtering/sorting options.
*   Provide a dedicated view to see *all* items, regardless of `toCount` status.
*   Improve the Export Options dialog (use a proper modal).
*   Integrate barcode scanning capabilities.
*   Implement unit/integration tests.

## Contributing

Contributions, issues, and feature requests are welcome. Please feel free to open an issue or submit a pull request.
