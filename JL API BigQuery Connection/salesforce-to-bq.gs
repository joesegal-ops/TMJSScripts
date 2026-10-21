/**
 * Salesforce "UP Support Request Report - ALL 7Days" email -> BigQuery importdata-494110.Salesforce
 *
 * The report lands ~10:00 UK as a CSV attachment. Each unprocessed email is loaded into
 * Salesforce.support_requests_staging (truncate) and MERGEd into Salesforce.support_requests
 * (one row per Support_Request_ID, most recently modified version wins). Processed threads get the Gmail label below,
 * so re-runs are safe and a missed day is picked up next run.
 *
 * Setup (once): Services -> add "BigQuery API" (identifier BigQuery). Run installTrigger().
 * Backfill: run loadSalesforceReports() by hand; it processes every unlabelled email oldest-first.
 */
const SF = {
  project: 'importdata-494110',
  dataset: 'Salesforce',
  staging: 'support_requests_staging',
  target: 'support_requests',
  query: 'subject:"Report results (UP Support Request Report - ALL 7Days)" has:attachment',
  label: 'SF-Loaded-BQ',
};

const SF_COLS = ['Support_Request_Owner', 'Account_Name', 'Subject', 'Date_Time_Opened', 'Age', 'Open',
  'Status', 'Opened_Date', 'Date_Time_Last_Modified', 'Member_Name', 'Support_Request_Type',
  'Support_Request_Owner_Alias', 'Support_Request_Number', 'Account_Owner', 'Account_Owner_Alias',
  'Description', 'Priority', 'Primary_Member_Name', 'Floor', 'Office_Numbers', 'Support_Request_Subtype',
  'Building_Name', 'Support_Request_ID'];

function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'loadSalesforceReports')
    .forEach(t => ScriptApp.deleteTrigger(t));
  // Runs 10:00-11:00 UK; a second run at 13:00 catches a late email.
  ScriptApp.newTrigger('loadSalesforceReports').timeBased().atHour(10).nearMinute(30).everyDays(1)
    .inTimezone('Europe/London').create();
  ScriptApp.newTrigger('loadSalesforceReports').timeBased().atHour(13).everyDays(1)
    .inTimezone('Europe/London').create();
}

function loadSalesforceReports() {
  const label = GmailApp.getUserLabelByName(SF.label) || GmailApp.createLabel(SF.label);
  const threads = GmailApp.search(`${SF.query} -label:${SF.label}`, 0, 100);
  // Oldest first, so the newest report's values win in the MERGE.
  const messages = threads.flatMap(t => t.getMessages())
    .sort((a, b) => a.getDate() - b.getDate());
  if (!messages.length) { Logger.log('No new Salesforce report emails.'); return; }

  for (const msg of messages) {
    const att = msg.getAttachments().find(a => /\.csv$/i.test(a.getName()));
    if (!att) { Logger.log(`No CSV on "${msg.getSubject()}" ${msg.getDate()} - skipped`); continue; }
    // Salesforce sends Windows-1252 despite the utf-8 header; re-encode to UTF-8 for BigQuery.
    const csv = att.getDataAsString('windows-1252');
    const rows = loadStaging_(csv);
    // Report_Date = the email's date, so a backfill doesn't stamp everything as today.
    runQuery_(mergeSql_(Utilities.formatDate(msg.getDate(), 'Europe/London', 'yyyy-MM-dd')));
    msg.getThread().addLabel(label);
    Logger.log(`${att.getName()}: ${rows} rows staged and merged`);
  }
}

function loadStaging_(csv) {
  const job = BigQuery.Jobs.insert({
    configuration: {
      load: {
        destinationTable: { projectId: SF.project, datasetId: SF.dataset, tableId: SF.staging },
        sourceFormat: 'CSV',
        skipLeadingRows: 1,
        allowQuotedNewlines: true,
        writeDisposition: 'WRITE_TRUNCATE',
        schema: { fields: SF_COLS.map(name => ({ name, type: 'STRING' })) },
      },
    },
  }, SF.project, Utilities.newBlob(csv, 'application/octet-stream'));
  const done = waitForJob_(job.jobReference);
  return done.statistics.load.outputRows;
}

function runQuery_(sql) {
  const job = BigQuery.Jobs.insert({ configuration: { query: { query: sql, useLegacySql: false } } }, SF.project);
  return waitForJob_(job.jobReference);
}

function waitForJob_(ref) {
  for (let i = 0; i < 120; i++) {
    const j = BigQuery.Jobs.get(ref.projectId, ref.jobId, { location: ref.location });
    if (j.status.state === 'DONE') {
      if (j.status.errorResult) throw new Error(`BigQuery job ${ref.jobId}: ${JSON.stringify(j.status.errors)}`);
      return j;
    }
    Utilities.sleep(2000);
  }
  throw new Error(`BigQuery job ${ref.jobId} timed out`);
}

// Same statement as salesforce_support_requests.sql step 1.
function mergeSql_(reportDate) {
  const t = `\`${SF.project}.${SF.dataset}.${SF.target}\``;
  const s = `\`${SF.project}.${SF.dataset}.${SF.staging}\``;
  const keyless = SF_COLS.filter(c => c !== 'Support_Request_ID');
  return `
MERGE ${t} t
USING (
  SELECT * REPLACE (LEFT(Support_Request_ID, 15) AS Support_Request_ID) FROM ${s}
  WHERE NULLIF(Support_Request_ID, '') IS NOT NULL
  -- Daily report sends 18-char IDs, Salesforce CSV exports 15-char: key on the 15-char form.
  QUALIFY ROW_NUMBER() OVER (PARTITION BY LEFT(Support_Request_ID, 15)) = 1
) s
ON t.Support_Request_ID = s.Support_Request_ID
WHEN MATCHED AND IFNULL(SAFE.PARSE_DATETIME('%m/%d/%Y, %I:%M %p', s.Date_Time_Last_Modified), DATETIME '1900-01-01')
        >= IFNULL(SAFE.PARSE_DATETIME('%m/%d/%Y, %I:%M %p', t.Date_Time_Last_Modified), DATETIME '1900-01-01') THEN UPDATE SET
  ${keyless.map(c => `${c} = s.${c}`).join(', ')},
  Report_Date = DATE '${reportDate}', Loaded_At = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (${SF_COLS.join(', ')}, Report_Date, Loaded_At)
  VALUES (${SF_COLS.map(c => `s.${c}`).join(', ')}, DATE '${reportDate}', CURRENT_TIMESTAMP());`;
}
