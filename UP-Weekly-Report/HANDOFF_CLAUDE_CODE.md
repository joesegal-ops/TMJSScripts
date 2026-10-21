# Handoff: UP Reporting weekly outputs on BigQuery

## Goal

Replace the heavy "UP Reporting - Weekly Job Report" Google Sheet with a light one that only holds the 8 output tabs, each filled from a BigQuery view. The old sheet errors because it imports ~35k-row Joblogic reports and filters them with formulas.

## Files in this folder

| File | What it is |
|---|---|
| `up_weekly_report_views.sql` | Creates 2 input tables, 1 helper UDF and 10 views in BigQuery |
| `Code.gs` | Apps Script bound to the new sheet: pushes input tabs to BigQuery, pulls each view into its tab |
| `appsscript.json` | Apps Script manifest (BigQuery advanced service, scopes, Europe/London time zone) |
| `UP_Reporting_Weekly_Outputs.xlsx` | Starter workbook: Control, 8 output tabs, Engineer List (prefilled), SF Check (headers only) |

## Environment

- GCP project: `importdata-494110`
- Dataset: `JobLogic`
- Location: **EU** (every query and job must specify EU or it fails)
- Existing source views the SQL reads from: `All_in_Job_clean`, `Job_and_Visit_Details_clean`, `Pending_Costs_clean`, `Forms_Logbook_clean`
- Old workbook ID (only used by an optional import function): `18Icoh6tjcAXd5nPQphKZko5YC6KvuGVfVdiFx9obVDU`

## Step 1: Check prerequisites

```bash
gcloud auth list
gcloud config set project importdata-494110
bq ls --location=EU importdata-494110:JobLogic | grep -E "All_in_Job_clean|Job_and_Visit_Details_clean|Pending_Costs_clean|Forms_Logbook_clean"
```

All four source views must exist. If `Pending_Costs_clean` is missing but `Pending_Costs` exists, find-and-replace `Pending_Costs_clean` with `Pending_Costs` in the SQL file before running it.

Check that the columns the SQL uses exist with these names (they mirror the Joblogic report headers):

```bash
for v in All_in_Job_clean Job_and_Visit_Details_clean Pending_Costs_clean Forms_Logbook_clean; do
  echo "== $v"; bq show --format=prettyjson --location=EU importdata-494110:JobLogic.$v | jq -r '.schema.fields[] | "\(.name) \(.type)"'
done
```

Columns referenced:
- `All_in_Job_clean`: ID, Site, Area, Post_Code, Telephone, Contact, Description, Customer, Order_Number, Job_Status, Date_Logged, Estimated_Appointment, DateComplete, Job_Type, Job_Category, Open_Closed_Job, Is_Open, Custom_Reference, Reported_Fault_Code, Reported_Sub_Fault_Code, Actual_Fault_Code, Actual_Sub_Fault_Code, TotalJobCost, TotalJobSell, TotalQuoteCost, TotalQuoteSell, PurchaseOrderAdjustment, Priority, Visit_Notes, Job_Tags, Service_Job
- `Job_and_Visit_Details_clean`: Customer, Site, Area, ID, Job_Description, Job_Status, Order_Number, Task_Type_ID, Task_Type, Date_Logged, Target_Completion_Date, Date_Complete, Engineer, Engineer_Active, VisitDateTime, VisitEndDateTime, Visit_Status, Revisit_Reason, Site_id, Is_Job_Completing_Visit
- `Pending_Costs_clean`: Job_Number, Job_Description, DateLogged, Logged_By, TargetAttendanceDate, AppointmentDate, Target_CompletionDate, CompletedDate, Job_Type, Job_Category, Job_Trade, Job_Reference, Status, Priority, Order_Number, Contact, Telephone, Email_Address, Customer_ID, Customer, AccountNumber, Reported_Fault_Code, Reported_Sub_Fault_Code, Actual_Fault_Code, Actual_Sub_Fault_Code, Custom_Reference, Child_Quote
- `Forms_Logbook_clean`: Form_Name, FormDate, Job_Number, Customer, Site, Engineer, Asset, Form_Hyperlink

If a name differs, edit the SQL to match the real schema. Do not rename columns in the source views. Date columns may be DATE, DATETIME or TIMESTAMP; the SQL casts them, so any of those is fine.

## Step 2: Create the views

```bash
bq query --location=EU --use_legacy_sql=false < up_weekly_report_views.sql
```

It is a multi-statement script and every statement is `CREATE OR REPLACE` or `CREATE TABLE IF NOT EXISTS`, so re-running is safe.

## Step 3: Smoke-test the views

The input tables (`SF_Check`, `Engineer_List`) start empty, so the Closed on SF view, the SF Status columns and the Engineer view will be empty until the script has pushed them. The rest should return rows.

```bash
for v in vw_Out_Jobs_Missing_Closed_Dates vw_Out_Project_Jobs_Missing_Closed_Dates vw_Out_Missing_Categories vw_Out_Proj_Jobs_with_Child_Quote vw_Out_HS_Issues vw_Out_Near_Misses; do
  echo -n "$v: "
  bq query --location=EU --use_legacy_sql=false --format=csv "SELECT COUNT(*) FROM \`importdata-494110.JobLogic.$v\`" | tail -1
done
```

Rough row counts seen in the old sheet on 20/10/2026, for sanity only (the source data will have moved on): Jobs Missing Closed Dates 92, Project Jobs Missing Closed Dates 14, Missing Categories 336, Proj Jobs with Child Quote 10, H&S Issues 1, Near Misses 1, Closed on SF 35.

Report any errors with the full message. Do not change the filter logic to make counts match; the logic was verified row for row against the old sheet.

## Step 4: Create the sheet and bind the script

Creating the Google Sheet needs a person in the browser:

1. Joe uploads `UP_Reporting_Weekly_Outputs.xlsx` to Drive and opens it with Google Sheets (File > Save as Google Sheets), then copies the new spreadsheet ID from its URL.

Then, with `clasp` (`npm install -g @google/clasp`, `clasp login`, and the Apps Script API turned on at https://script.google.com/home/usersettings):

```bash
mkdir up-weekly-script && cd up-weekly-script
clasp create --type sheets --title "UP Weekly Outputs script" --parentId <SPREADSHEET_ID>
cp ../Code.gs ../appsscript.json .
clasp push --force
```

`--parentId` binds the script to the existing sheet. `clasp push --force` overwrites the default manifest with ours.

## Step 5: First run (Joe, in the browser)

These need the OAuth consent screen, so Joe does them:

1. Open the sheet, then Extensions > Apps Script, choose `setup` and press Run. Approve the permissions. This renames the shortened "Project Jobs Missing Closed Dat" tab, adds the UP Reporting menu and a daily 07:00 trigger.
2. Reload the sheet. Use UP Reporting > Import SF Check from old workbook (or paste the Salesforce report into SF Check).
3. UP Reporting > Refresh all tabs. The Control tab lists each tab with its row count or error.

## Behaviour notes (decisions already made, keep them)

- **Engineer week window** copies the old formula: visits from Saturday to the following Friday, the week before last Saturday. WC shows Monday of last week. The window is set in `vw_Out_Engineer_Completed_Visit` (`INTERVAL 9 DAY` and `INTERVAL 2 DAY`) if Joe wants Monday to Sunday later.
- **Engineer List**: "Human Van De Merwe" renamed to "Human Van Der Merwe" to match Joblogic (email kept as before), duplicate Chris Howlett removed, names matched ignoring case and spaces.
- **Congratulations message** only goes to engineers with at least one completed job (the old sheet congratulated everyone when all were zero).
- **Closed on SF** covers the whole table (the old formula stopped at row 30,044).
- **Kept columns**: "Email Sent" (Engineer Completed Visit, used by the mail merge) and "Correct Job Category" (Missing Categories, AI formula) keep their values between refreshes, matched on column A.
- **SF Check** is a Salesforce export, not in BigQuery. The script uploads it to `JobLogic.SF_Check` (WRITE_TRUNCATE) at the start of every refresh, and Engineer List to `JobLogic.Engineer_List`.

## Do not

- Do not edit or delete the old workbook or its Drive folder.
- Do not change the `_clean` source views.
- Do not create extra tables or views beyond those in the SQL file without asking Joe.
