# Telecom Inventory Helper

A simple, offline-first web application designed to help manage and count telecom inventory items, with specific features for handling reels and calculating footage. Built with vanilla JavaScript, HTML, and CSS, using IndexedDB for local storage.

**(Note: This is a client-side only application. All data is stored locally in your browser's IndexedDB database.)**

## Overview

This tool provides a user-friendly interface for:

*   Maintaining a list of inventory items (SKU, Description, Location).
*   Performing inventory counts, including manual quantity entry and footage calculation for cable reels.
*   Tracking the status of items (Active, Inactive, Counted, Uncounted).
*   Importing inventory lists from CSV files.
*   Exporting the current inventory state to CSV or PDF formats.
*   Logging all significant actions (counts, imports, status changes) for an audit trail.
*   Managing inventory cycles with "Start New Count" and "Finalize Inventory" actions.

## Key Features

*   **Offline First:** Uses IndexedDB to store all inventory data and transaction history locally in the browser. Works without an internet connection after initial load.
*   **Inventory Management:** Add, view, and update inventory items with details like SKU, Description, Location, and Notes.
*   **Quantity Counting & Flagging:** Easily input counted quantities or flag items as "uncounted".
*   **Reel Footage Calculation:** Supports standard and "two-way" reels. Automatically calculates footage based on inner/outer sequence numbers and a defined footage factor, updating the item's quantity.
*   **Filtering & Status:** Filter the inventory list by location and status (Active, Inactive, All). Items are visually distinguished based on their status (Counted, Uncounted, Inactive).
*   **CSV Import/Export:**
    *   Import inventory data from a CSV file (headers detected automatically, see format below).
    *   Export the complete inventory or filtered view to a CSV file.
*   **PDF Export:** Generate a printable PDF report of the currently filtered inventory view.
*   **Transaction History:**
    *   Logs actions like count updates, flagging, imports, description changes, status changes, and cycle management.
    *   View a global history of all transactions.
    *   View the specific history for an individual item via a modal dialog.
*   **Count Cycle Management:**
    *   **Start New Count Cycle:** Resets counts, flags, and sequences for all *active* items, marking them as "uncounted".
    *   **Finalize Inventory:** Marks *active* items with zero or null quantity as "inactive".
*   **User Identification:** Records a user-provided name/ID alongside transactions in the history log.
*   **Responsive Design:** Basic responsiveness for use on different screen sizes.

## Screenshots (Placeholder)

*Include screenshots here to showcase the UI.*

`[Screenshot Placeholder: Main Inventory View with Filters]`
`[Screenshot Placeholder: Item Detail Showing Reel Calculation]`
`[Screenshot Placeholder: Item History Modal]`
`[Screenshot Placeholder: Global History View]`

## Getting Started

This is a client-side application and does not require a web server to run.

1.  **Download/Clone:** Download or clone this repository to your local machine.
2.  **Dependencies:** Ensure the following JavaScript library files are present in the same directory as `index.html` (or update the paths in `index.html` if you place them elsewhere):
    *   `papaparse.min.js` (for CSV parsing)
    *   `jspdf.umd.min.js` (for PDF generation)
    *   `jspdf.plugin.autotable.min.js` (for PDF table generation)
    *   *(You can typically download these from their respective project websites/CDNs)*
3.  **Open:** Open the `index.html` file directly in a modern web browser (like Chrome, Firefox, Edge, Safari) that supports IndexedDB and ES6+ JavaScript.

## Usage

1.  **Set Counter Name:** Enter your name or identifier in the "Counter Name" field at the top. This name will be associated with your actions in the transaction history.
2.  **Import (Optional):** Use the "Import CSV" button to load an initial inventory list or update existing items.
3.  **Filter:** Use the "Filter Location" input and "Status" dropdown, then click "Apply Filters" to narrow down the displayed inventory. "Clear Filters" resets the view.
4.  **Count/Update:**
    *   For standard items, enter the quantity in the "Qty" input field.
    *   For reels, enter the inner/outer sequence numbers. The quantity will update automatically if the footage factor is set and sequences are valid.
    *   Use the "Flag" button to mark an item as uncounted (clears quantity/sequences).
    *   Add optional notes in the text area.
    *   Changes are auto-saved to IndexedDB.
5.  **View History:**
    *   Click the "History" button on an item row to see its specific transaction log.
    *   Click "View All History" in the navigation menu to see the global log.
6.  **Export:** Use the "Export CSV" or "Export PDF" buttons to generate files based on the *current* inventory data (PDF export uses the currently applied filters).
7.  **Manage Cycles:**
    *   Use "Start New Count Cycle" (typically at the beginning of a count) to reset active items.
    *   Use "Finalize Inventory" (typically at the end of a count) to deactivate items with zero quantity. **Use with caution.**

## CSV Import Format

The CSV importer uses PapaParse and attempts to automatically detect headers (case-insensitive).

*   **Required Header:**
    *   `SKU` (or `item`, `partnumber`, `part number`) - The unique identifier for the item. Rows without a SKU will be skipped. Duplicate SKUs within the *same file* will cause later rows to be skipped.
*   **Recommended Headers:**
    *   `Description` (or `desc`)
    *   `location` (or `loc`)
*   **Optional Headers (Will update existing item data or set for new items):**
    *   `counted` (or `quantity`, `qty`, `count`) - Explicit quantity. *Note: This is ignored if valid sequences are provided for a reel.*
    *   `capturedQuantity` (or `expectedquantity`, `expected qty`, `captured qty`) - An optional field to store an expected or previously recorded quantity.
    *   `notes` (or `note`, `comments`)
    *   `isActive` (or `active`) - `true`, `1`, `yes` for active; `false`, `0`, `no` for inactive. Defaults to active if missing or not recognized as inactive.
    *   `isReel` (or `reel`) - `true`, `1`, `yes` if it's a reel; otherwise `false`. Defaults to false.
    *   `isTwoWayReel` (or `twowayreel`, `two way reel`) - `true`, `1`, `yes` if it's a two-way reel; otherwise `false`. Only applicable if `isReel` is also true. Defaults to false.
    *   `footageFactor` (or `factor`, `ft factor`) - The numerical factor used for footage calculation on reels.
    *   `innerSequence` (or `inner seq`, `inner`) - First inner sequence number.
    *   `outerSequence` (or `outer seq`, `outer`) - First outer sequence number.
    *   `innerSequence2` (or `inner seq 2`, `inner2`) - Second inner sequence number (for two-way reels).
    *   `outerSequence2` (or `outer seq 2`, `outer2`) - Second outer sequence number (for two-way reels).

**Import Logic:**

*   If an imported SKU exists, the item's data will be updated with values from the CSV.
*   If an imported SKU does not exist, a new item will be created.
*   If the `Description` in the CSV differs from an existing item's description, the change is logged in the transaction history.
*   The item's `counted` quantity is determined by:
    1.  Valid sequence numbers (if it's a reel with a factor).
    2.  The value in the `counted` (or similar) column (if sequences aren't used or invalid).
    3.  If neither is present/valid, the existing count state is preserved (or defaults to uncounted for new items).

## Technical Details

*   **Frontend:** HTML5, CSS3, JavaScript (ES6+)
*   **Storage:** Browser IndexedDB (via `offlineDB.js` wrapper)
*   **Libraries:**
    *   PapaParse.js (CSV Parsing)
    *   jsPDF.js & jsPDF-AutoTable plugin (PDF Generation)

## Future Enhancements Ideas

*   Implement robust search functionality within the inventory list.
*   Add more advanced filtering/sorting options (e.g., by description, date last counted).
*   Integrate barcode scanning capabilities (e.g., using device camera).
*   Add basic reporting/analytics within the app.
*   Improve UI/UX, potentially with a modern framework (though the goal here was simplicity).
*   Implement unit/integration tests.
*   Offer a cloud synchronization option (would require backend infrastructure).

## Contributing

Contributions, issues, and feature requests are welcome. Please feel free to open an issue or submit a pull request.

## License

*(Optional: Add a license here, e.g., MIT License)*
