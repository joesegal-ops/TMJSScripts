/**
 * Uninvoiced Costs — scheduled BigQuery pull for Google Sheets (headless / trigger-driven).
 *
 * Writes the result of models.job_uninvoiced_costs(<cutoff>) into a sheet. The cutoff date is
 * read from a cell. No UI — designed to run from a time-based trigger every morning.
 *
 * SETUP (one-off):
 *  1. Extensions → Apps Script, paste this file, Save.
 *  2. Services (+) → add "BigQuery API" (identifier: BigQuery).
 *  3. Triggers (clock icon) → Add Trigger:
 *       function = refreshUninvoicedCosts | event source = Time-driven | Day timer | e.g. 6–7am.
 *  4. First save/run asks for authorization (your Google account needs BigQuery Data Viewer +
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

function refreshUninvoicedCosts() {
  const ss = SpreadsheetApp.getActive();

  const dateSheet = ss.getSheetByName(DATE_SHEET);
  if (!dateSheet) throw new Error('Missing sheet "' + DATE_SHEET + '" — create it with a cutoff date in ' + DATE_CELL + '.');

  const dateVal = dateSheet.getRange(DATE_CELL).getValue();
  if (!(dateVal instanceof Date)) throw new Error('Put a cutoff date in ' + DATE_SHEET + '!' + DATE_CELL + ' (a real date value).');
  const cutoff = Utilities.formatDate(dateVal, 'Europe/London', 'yyyy-MM-dd');

  // Tenant-wide function, filtered to WeWork Ltd only for this report (join back to raw.jobs
  // on Job_Number to reach CustomerName, which the function itself doesn't return).
  const sql =
    'SELECT u.* ' +
    'FROM `vmimporteddata.models.job_uninvoiced_costs`(DATE "' + cutoff + '") u ' +
    'JOIN `vmimporteddata.raw.jobs` j ON j.JobNumber = u.Job_Number ' +
    'WHERE j.CustomerName = "WeWork Ltd" ' +
    'ORDER BY u.Total_Sell_Exc_Vat DESC';

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
  // NOTE: the BigQuery REST API returns TIMESTAMP values as epoch SECONDS (a float
  // string like "1.75526022E9"), not an ISO string — write those raw and the sheet
  // shows a number, not a date. Convert per-column using the schema field type.
  const fields = resp.schema.fields.map(f => f.name);
  const types  = resp.schema.fields.map(f => f.type);

  function convert(cell, type) {
    if (cell === null || cell === '') return '';
    if (type === 'TIMESTAMP') return new Date(parseFloat(cell) * 1000); // epoch seconds -> Date
    if (type === 'DATE' || type === 'DATETIME') return new Date(cell);   // ISO string -> Date
    return cell;
  }

  let rows = [];
  let page = resp;
  while (page && page.rows && page.rows.length) {
    rows = rows.concat(page.rows.map(r => r.f.map((c, i) => convert(c.v, types[i]))));
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

  Logger.log('Uninvoiced costs refreshed for cutoff %s — %s jobs.', cutoff, rows.length);
}
