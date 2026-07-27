/**
 * Uninvoiced Costs — cell-driven BigQuery pull for Google Sheets.
 *
 * Puts the result of models.job_uninvoiced_costs(<cutoff>) into a sheet, with the cutoff
 * date read from a cell — so users just type a date and hit refresh (no SQL editing).
 *
 * SETUP (one-off):
 *  1. Extensions → Apps Script, paste this file, Save.
 *  2. In the Apps Script editor: Services (+) → add "BigQuery API" (identifier: BigQuery).
 *  3. Back in the sheet, reload. A "BigQuery" menu appears → "Refresh uninvoiced costs".
 *  4. First run asks for authorization (your Google account needs BigQuery Data Viewer +
 *     Job User on project vmimporteddata).
 *
 * Cutoff date  -> read from  INPUTS!B1  (a real date value)
 * Results      -> written to UninvoicedCosts, starting at A1 (sheet auto-created if missing)
 */
const PROJECT_ID   = 'vmimporteddata';
const LOCATION     = 'EU';
const DATE_SHEET   = 'INPUTS';            // sheet holding the cutoff date
const DATE_CELL    = 'B1';                // cell with the cutoff date
const OUTPUT_SHEET = 'UninvoicedCosts';   // sheet the result table is written to
const OUTPUT_START = 'A1';                // top-left cell of the result table

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('BigQuery')
    .addItem('Refresh uninvoiced costs', 'refreshUninvoicedCosts')
    .addToUi();
}

function refreshUninvoicedCosts() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();

  const dateSheet = ss.getSheetByName(DATE_SHEET);
  if (!dateSheet) { ui.alert('Missing sheet "' + DATE_SHEET + '". Create it and put a cutoff date in ' + DATE_CELL + '.'); return; }

  const dateVal = dateSheet.getRange(DATE_CELL).getValue();
  if (!(dateVal instanceof Date)) {
    ui.alert('Put a cutoff date in ' + DATE_SHEET + '!' + DATE_CELL + ' (a real date value).');
    return;
  }
  const cutoff = Utilities.formatDate(dateVal, 'Europe/London', 'yyyy-MM-dd');

  const sql =
    'SELECT * FROM `vmimporteddata.models.job_uninvoiced_costs`(DATE "' + cutoff + '") ' +
    'ORDER BY Total_Sell_Exc_Vat DESC';

  // Run the query, waiting for completion.
  let resp = BigQuery.Jobs.query(
    { query: sql, useLegacySql: false, location: LOCATION, maxResults: 100000 },
    PROJECT_ID
  );
  const jobId = resp.jobReference.jobId;
  while (!resp.jobComplete) {
    Utilities.sleep(1000);
    resp = BigQuery.Jobs.getQueryResults(PROJECT_ID, jobId, { location: LOCATION, maxResults: 100000 });
  }

  // Collect all rows (follow pagination).
  const fields = resp.schema.fields.map(f => f.name);
  let rows = [];
  let page = resp;
  while (page && page.rows && page.rows.length) {
    rows = rows.concat(page.rows.map(r => r.f.map(c => (c.v === null ? '' : c.v))));
    if (!page.pageToken) break;
    page = BigQuery.Jobs.getQueryResults(PROJECT_ID, jobId,
      { location: LOCATION, pageToken: page.pageToken, maxResults: 100000 });
  }

  // Output sheet: create if missing, wipe it, then write header + rows from OUTPUT_START.
  let out = ss.getSheetByName(OUTPUT_SHEET);
  if (!out) out = ss.insertSheet(OUTPUT_SHEET);
  out.clearContents();

  const start = out.getRange(OUTPUT_START);
  const sr = start.getRow(), sc = start.getColumn();
  out.getRange(sr, sc, 1, fields.length).setValues([fields]);
  if (rows.length) out.getRange(sr + 1, sc, rows.length, fields.length).setValues(rows);

  // Stamp a refresh note next to the date cell on INPUTS.
  dateSheet.getRange(DATE_CELL).offset(0, 1)
    .setValue('Refreshed ' + Utilities.formatDate(new Date(), 'Europe/London', 'dd/MM/yyyy HH:mm')
              + '  (' + rows.length + ' jobs)');
}
