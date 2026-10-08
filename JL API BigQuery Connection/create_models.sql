-- Recreates the models layer (dataset `models`) + UDF. Region-agnostic (refers by name),
-- so it works whether raw/models are US or EU. sla_analysis reads an EU-local copy of the
-- status audit (vmimporteddata.models.job_status_audit) instead of the cross-region US table.
--
-- TIMEZONES (2026-10-07): raw.* TIMESTAMPs are true UTC instants (JL midnight -> 23:00 UTC in BST).
-- Every JL/Monday date-time these views OUTPUT is converted to UK wall-clock time with
-- DATETIME(x, "Europe/London") under its original column name, so Looker matches what JobLogic shows.
-- Day bucketing uses DATE(x, "Europe/London") / CURRENT_DATE("Europe/London"). Durations in hours or
-- minutes are taken on the raw UTC TIMESTAMPs (exact across clock changes). _ingested_at stays UTC.
-- A view that reads another models/reporting view gets local DATETIMEs already: don't convert twice.

CREATE OR REPLACE FUNCTION `vmimporteddata.models.business_hours_elapsed`(start_dt DATETIME, end_dt DATETIME)
RETURNS FLOAT64 AS (
  (SELECT CAST(COUNT(*) AS FLOAT64)
   FROM UNNEST(GENERATE_ARRAY(0, GREATEST(DATETIME_DIFF(end_dt, start_dt, HOUR) - 1, 0))) AS h
   WHERE EXTRACT(DAYOFWEEK FROM DATETIME_ADD(start_dt, INTERVAL h HOUR)) BETWEEN 2 AND 6
     AND EXTRACT(HOUR FROM DATETIME_ADD(start_dt, INTERVAL h HOUR)) BETWEEN 8 AND 17)
);

CREATE OR REPLACE VIEW `vmimporteddata.models.customers` AS
SELECT Id AS customer_id, UniqueId AS customer_uid, Name AS customer_name, Active AS is_active,
       AccountNumber AS account_number, CustomReference AS custom_reference, Contact AS contact,
       EmailAddress AS email, Telephone AS telephone, Address AS address, Postcode AS postcode, _ingested_at
FROM `vmimporteddata.raw.customers`;

-- Quote tracking. job_type/job_category come from raw.quote_types (Quote/GetById; the list endpoint
-- returns them null) resolved to names via the static code maps. date_rejected comes from the status
-- CDC (raw.quote_status_events) since the API exposes no rejection timestamp on standard quotes.
CREATE OR REPLACE VIEW `vmimporteddata.models.quote_tracking` AS
WITH rejected AS (
  SELECT quote_id, MIN(observed_at) AS date_rejected
  FROM `vmimporteddata.raw.quote_status_events`
  WHERE new_status = "Rejected"
  GROUP BY quote_id
)
SELECT
  q.Id AS quote_id,
  q.QuoteNumber AS quote_number, q.Title AS title, q.Description AS description,
  COALESCE(jtm.description, qt.job_type_code) AS job_type,
  qt.job_type_code AS job_type_code,
  COALESCE(jcm.description, qt.job_category_code) AS job_category,
  qt.job_category_code AS job_category_code,
  q.QuoteStatusDescription AS status, q.OwnerName AS owner, DATE(q.DateLogged, "Europe/London") AS date_logged,
  DATETIME(q.ApprovedDatetime, "Europe/London") AS approved_datetime,
  DATE(rj.date_rejected, "Europe/London") AS date_rejected,
  q.CustomerName AS customer, q.CustomerCustomReference AS customer_reference,
  q.SiteName AS site, q.SitePostcode AS site_postcode, q.Contact AS contact, q.EmailAddress AS email,
  q.QuoteValueExcludingVat AS value_excl_vat, q.QuoteValue AS value_incl_vat,
  SAFE_CAST(q.ChanceOfSale AS FLOAT64) AS chance_of_sale,
  q.IsCancelled AS is_cancelled, q.IsRejected AS is_rejected, q.IsUpgraded AS is_upgraded, q._ingested_at
FROM `vmimporteddata.raw.quotes` q
LEFT JOIN `vmimporteddata.raw.quote_types` qt ON qt.quote_id = q.Id
LEFT JOIN `vmimporteddata.raw.quote_jobtype_map` jtm ON jtm.code = qt.job_type_code
LEFT JOIN `vmimporteddata.raw.job_category_map`  jcm ON jcm.code = qt.job_category_code
LEFT JOIN rejected rj ON rj.quote_id = q.Id;

CREATE OR REPLACE VIEW `vmimporteddata.models.purchase_orders` AS
SELECT Id AS po_id, PONumber AS po_number, Status AS status_id, DATETIME(DateRaised, "Europe/London") AS date_raised,
       SupplierId AS supplier_id, JobId AS job_id, AccountNumber AS account_number,
       CustomReference AS custom_reference, DeliveryName AS delivery_name,
       DeliveryPostcode AS delivery_postcode, DATETIME(EstimatedDeliveryDate, "Europe/London") AS est_delivery_date,
       ARRAY_LENGTH(Lines) AS line_count, _ingested_at
FROM `vmimporteddata.raw.purchase_orders`;

CREATE OR REPLACE VIEW `vmimporteddata.models.purchase_order_lines` AS
SELECT po.Id AS po_id, po.PONumber AS po_number, DATETIME(po.DateRaised, "Europe/London") AS date_raised, po.SupplierId AS supplier_id,
       po.JobId AS job_id, l.Number AS line_number, l.Description AS description, l.Quantity AS quantity,
       l.PricePerUnit AS price_per_unit, l.TotalExcludingVat AS total_excl_vat, l.TotalVatAmount AS total_vat,
       l.IsDelivered AS is_delivered, DATETIME(l.DateDelivered, "Europe/London") AS date_delivered, po._ingested_at
FROM `vmimporteddata.raw.purchase_orders` po, UNNEST(po.Lines) AS l;

CREATE OR REPLACE VIEW `vmimporteddata.models.invoices` AS
SELECT InvoiceNumber AS invoice_number, Type AS invoice_type_id, DATETIME(DateRaised, "Europe/London") AS date_raised,
  DATETIME(PaymentDueDate, "Europe/London") AS payment_due_date, CustomerName AS customer, CustomerId AS customer_id,
  SiteName AS site, SiteId AS site_id, JobNumber AS job_number, JobId AS job_id,
  OrderNumber AS order_number, AccountNumber AS account_number, Description AS description,
  JobDescription AS job_description, TotalExcludingVat AS total_excl_vat, TotalIncludingVat AS total_incl_vat,
  GrandTotal AS grand_total, GlobalDiscount AS global_discount, IsCredit AS is_credit,
  CreditReason AS credit_reason, IsDraft AS is_draft, PPMContractId AS ppm_contract_id,
  Id AS invoice_id, UniqueId AS invoice_uid, _ingested_at
FROM `vmimporteddata.raw.invoices`;

CREATE OR REPLACE VIEW `vmimporteddata.models.forms_logbook` AS
SELECT FormName AS form_name, FullFormName AS full_form_name, FormType AS form_type,
  DATETIME(DateCreated, "Europe/London") AS date_created, Customer AS customer, CustomerId AS customer_id, Site AS site, SiteId AS site_id,
  Engineer AS engineer, JobNumber AS job_number, JobId AS job_id, AssetDescription AS asset,
  AssetNumber AS asset_number, VisitComplete AS visit_complete, IsGeneralForm AS is_general_form,
  IsDynamicForm AS is_dynamic_form, UniqueId AS form_uid, _ingested_at
FROM `vmimporteddata.raw.forms_logbook`;

-- RFQ form -> quote logged turnaround. One row per quote raised on a job that carries an
-- (HVAC) Request for Quotation form, plus one row (quote cols NULL) per RFQ job not yet quoted.
-- form = earliest RFQ form on the job; quote link is quotes.ParentJobAutoId = form job_id.
-- Measures to quote LOGGED, not sent: the API has no sent timestamp and the daily status CDC rarely
-- sees "Quote Sent" (quotes jump Outstanding -> Upgraded/Approved between snapshots). is_first_quote
-- flags the job's earliest quote so averages count one turnaround per form. (2026-10-07)
CREATE OR REPLACE VIEW `vmimporteddata.models.rfq_form_to_quote` AS
WITH rfq_form AS (
  SELECT job_id, job_number, form_name, date_created AS form_created_at, customer, site, engineer
  FROM `vmimporteddata.models.forms_logbook`
  WHERE job_id IS NOT NULL
    AND LOWER(form_name) LIKE "%request for quotation%"   -- "0 HVAC ... - V5", "1 Request for Quotation - V3" etc.
  QUALIFY ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY date_created) = 1
),
quotes AS (
  SELECT * FROM `vmimporteddata.raw.quotes`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1
)
SELECT
  f.job_number, f.job_id, f.form_name, f.form_created_at, f.engineer,
  COALESCE(q.CustomerName, f.customer) AS customer, COALESCE(q.SiteName, f.site) AS site,
  q.Id AS quote_id, q.QuoteNumber AS quote_number, q.QuoteStatusDescription AS quote_status,
  q.OwnerName AS quote_owner, DATETIME(q.DateLogged, "Europe/London") AS quote_logged_at,
  q.QuoteValueExcludingVat AS quote_value_excl_vat,
  q.Id IS NOT NULL
    AND ROW_NUMBER() OVER (PARTITION BY f.job_id ORDER BY q.DateLogged, q.Id) = 1 AS is_first_quote,
  DATE_DIFF(DATE(q.DateLogged, "Europe/London"), DATE(f.form_created_at), DAY)  AS days_form_to_quote_logged,
  ROUND(TIMESTAMP_DIFF(q.DateLogged, TIMESTAMP(f.form_created_at, "Europe/London"), MINUTE) / 60, 1)
                                                                                 AS hours_form_to_quote_logged,
  IF(q.Id IS NULL, DATE_DIFF(CURRENT_DATE("Europe/London"), DATE(f.form_created_at), DAY), NULL) AS days_awaiting_quote
FROM rfq_form f
LEFT JOIN quotes q ON q.ParentJobAutoId = f.job_id;

-- RFQ form -> quote SENT. quote_sent_at = first status-CDC observation of a sent-or-later status, so it
-- is only as precise as the daily snapshot; quotes already sent before the CDC seed day are excluded.
-- (Was live-only; captured into this file 2026-10-07.)
CREATE OR REPLACE VIEW `vmimporteddata.models.rfq_form_to_quote_sent` AS
WITH rfq_form AS (
  SELECT job_id, job_number, form_name, date_created AS form_created_at
  FROM `vmimporteddata.models.forms_logbook`
  WHERE job_id IS NOT NULL
    AND LOWER(form_name) LIKE "%request for quotation%"   -- "0 HVAC ... - V5", "1 Request for Quotation - V3" etc.
  QUALIFY ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY date_created) = 1
),
seed AS (SELECT MIN(observed_at) AS seed_at FROM `vmimporteddata.raw.quote_status_events`),
sent AS (
  SELECT e.quote_id, MIN(e.observed_at) AS quote_sent_at
  FROM `vmimporteddata.raw.quote_status_events` e, seed
  WHERE e.new_status IN ("Quote Sent", "Approved", "Rejected", "Upgraded")   -- sent-or-later (not Outstanding/Expired)
    AND DATE(e.observed_at, "Europe/London") > DATE(seed.seed_at, "Europe/London")
  GROUP BY e.quote_id
)
SELECT
  f.job_number, f.job_id, f.form_name, f.form_created_at,
  q.Id AS quote_id, q.QuoteNumber AS quote_number, q.QuoteStatusDescription AS quote_status,
  q.OwnerName AS quote_owner, q.CustomerName AS customer, q.SiteName AS site,
  DATETIME(q.DateLogged, "Europe/London")       AS quote_logged_at,
  DATETIME(s.quote_sent_at, "Europe/London")    AS quote_sent_at,
  DATETIME(q.ApprovedDatetime, "Europe/London") AS quote_approved_at,
  DATE_DIFF(DATE(q.DateLogged, "Europe/London"),    DATE(f.form_created_at), DAY) AS days_form_to_quote_logged,
  DATE_DIFF(DATE(s.quote_sent_at, "Europe/London"), DATE(f.form_created_at), DAY) AS days_form_to_quote_sent,
  IF(s.quote_sent_at IS NULL, DATE_DIFF(CURRENT_DATE("Europe/London"), DATE(f.form_created_at), DAY), NULL)
                                                                   AS days_form_awaiting_sent
FROM rfq_form f
JOIN (SELECT * FROM `vmimporteddata.raw.quotes`
      QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1) q
  ON q.ParentJobAutoId = f.job_id
LEFT JOIN sent s ON s.quote_id = q.Id;

CREATE OR REPLACE VIEW `vmimporteddata.models.all_jobs_report` AS
SELECT
  JobNumber AS Job_Number, Description AS Job_Description, DATETIME(DateLogged, "Europe/London") AS DateLogged, JobOwner AS Job_Owner,
  DATETIME(TargetAttendanceDate, "Europe/London") AS Target_AttendanceDate, DATETIME(AppointmentDate, "Europe/London") AS AppointmentDate,
  DATETIME(TargetCompletetionDate, "Europe/London") AS Target_CompletionDate,
  DATETIME(DateComplete, "Europe/London") AS CompletedDate, TypeDescription AS Job_Type, CategoryDescription AS Job_Category,
  JobTrade AS Job_Trade, JobStatusDescription AS Job_Status, PriorityDescription AS Priority,
  OrderNumber AS Order_Number, Contact AS Job_Contact, CAST(Telephone AS STRING) AS Job_Telephone,
  EmailAddress AS Email_Address, CustomerName AS Customer, CustomerCustomReference AS Custom_Reference,
  ReportedFaultCode AS Reported_Fault_Code, ActualFaultCode AS Actual_Fault_Code,
  SiteName AS Site, SiteAddress1 AS Site_Address_1, SiteAddress2 AS Site_Address_2,
  SiteAddress3 AS Site_Address_3, SiteAddress4 AS Site_Address_4, SitePostcode AS Site_Postcode,
  SiteCustomReference AS Site_Reference, Area, QuotedValue AS Quoted_Value, Tags AS Job_Tags,
  NoOfVisits AS No_Of_Visits, CustomerId AS Customer_Id, SiteId AS Site_id, Id AS Job_Auto_Id,
  DATETIME(UpdatedAt, "Europe/London") AS UpdatedAt, _ingested_at
FROM `vmimporteddata.raw.jobs`;

CREATE OR REPLACE VIEW `vmimporteddata.models.job_and_visit_details` AS
SELECT
  j.CustomerName AS Customer, j.SiteName AS Site, j.Area AS Area, j.JobNumber AS ID,
  j.Description AS Job_Description, j.JobStatusDescription AS Job_Status, j.OrderNumber AS Order_Number,
  j.TypeDescription AS Task_Type, j.CategoryDescription AS Job_Category, j.JobTrade AS Trade,
  DATETIME(j.DateLogged, "Europe/London") AS Date_Logged, DATETIME(j.TargetCompletetionDate, "Europe/London") AS Target_Completion_Date,
  DATETIME(j.DateComplete, "Europe/London") AS Date_Complete,
  v.EngineerName AS Engineer, v.EngineerEmail AS Engineer_Email, st.Active AS Engineer_Active,
  DATETIME(v.StartDate, "Europe/London") AS VisitDateTime, DATETIME(v.EndDate, "Europe/London") AS VisitEndDateTime, v.StatusDescription AS Visit_Status,
  j.VisitRevisitReason AS Revisit_Reason, j.SiteId AS Site_id, j.Id AS Job_Auto_Id, v.VisitId AS Visit_Id,
  j.NoOfVisits AS No_Of_Visits, j.HasMoreThanThreeVisits AS Visits_Capped_At_3,
  ROW_NUMBER() OVER (PARTITION BY j.Id ORDER BY v.StartDate) AS Visit_Order, j._ingested_at
FROM `vmimporteddata.raw.jobs` j
LEFT JOIN UNNEST(j.VisitsStatus) AS v
LEFT JOIN `vmimporteddata.raw.staff` st ON LOWER(st.EmailAddress) = LOWER(v.EngineerEmail);

-- Granular notes: one row per note (deduped by note UniqueId). _EntityType Job|Visit; Job notes are
-- system/admin notes on the job, Visit notes are the engineer notes captured against a specific visit.
-- Enriched with JobNumber/Customer/Site from raw.jobs for standalone reporting.
CREATE OR REPLACE VIEW `vmimporteddata.models.notes` AS
SELECT
  n.UniqueId       AS note_uid,
  n._EntityType    AS entity_type,
  n._JobId         AS job_id,
  n._VisitId       AS visit_id,
  n.NoteText       AS note_text,
  n.Author         AS author,
  DATETIME(n.DateAdded, "Europe/London") AS date_added,
  n.NoteVisibility AS visibility,
  j.JobNumber      AS job_number,
  j.CustomerName   AS customer,
  j.SiteName       AS site,
  n._ingested_at
FROM `vmimporteddata.raw.notes` n
LEFT JOIN `vmimporteddata.raw.jobs` j ON j.Id = n._JobId
QUALIFY ROW_NUMBER() OVER (PARTITION BY n.UniqueId ORDER BY n.DateAdded) = 1;

-- Enriched job+visit (adds Job_Type, Is_Open, Is_Job_Completing_Visit). Notes wired in from models.notes:
-- Job_Notes = STRING_AGG of Job-entity notes per job; Engineer_Notes = Visit-entity notes for THIS
-- specific visit (per Visit_Id) — granular, NOT the whole job's visit notes concatenated. Blank notes dropped.
CREATE OR REPLACE VIEW `vmimporteddata.models.job_and_visit_details_enriched` AS
WITH job_notes AS (
  SELECT job_id, STRING_AGG(note_text, "\n" ORDER BY date_added) AS Job_Notes
  FROM `vmimporteddata.models.notes`
  WHERE entity_type = "Job" AND note_text IS NOT NULL AND TRIM(note_text) != ""
  GROUP BY job_id
),
visit_notes AS (
  SELECT visit_id, STRING_AGG(note_text, "\n" ORDER BY date_added) AS Engineer_Notes
  FROM `vmimporteddata.models.notes`
  WHERE entity_type = "Visit" AND note_text IS NOT NULL AND TRIM(note_text) != ""
  GROUP BY visit_id
)
SELECT
  jvd.*,
  CASE WHEN jvd.Visit_Status = "Complete"
            AND DATE(jvd.VisitEndDateTime) = DATE(jvd.Date_Complete)
       THEN TRUE ELSE FALSE END              AS Is_Job_Completing_Visit,
  j.TypeDescription                          AS Job_Type,
  (j.DateComplete IS NULL)                   AS Is_Open,
  jn.Job_Notes                               AS Job_Notes,
  vn.Engineer_Notes                          AS Engineer_Notes
FROM `vmimporteddata.models.job_and_visit_details` jvd
LEFT JOIN `vmimporteddata.raw.jobs` j ON j.Id = jvd.Job_Auto_Id
LEFT JOIN job_notes  jn ON jn.job_id   = jvd.Job_Auto_Id
LEFT JOIN visit_notes vn ON vn.visit_id = jvd.Visit_Id;

-- All-in-Job (job grain, one row per job) — reproduces the old importdata All_in_Job_clean columns.
-- PARTIAL BUILD (2026-07-20): job fields + Visit_Notes (aggregated per job from models.notes) populated.
-- TotalJobCost/Sell come from raw.job_costs (JobCost endpoint, ex-VAT; load_job_costs.py). The other 3
-- money columns (TotalQuoteCost/Sell, PurchaseOrderAdjustment) and the 2 Service columns are typed NULL
-- placeholders pending the FULL pass: quote figures need UNNEST(quotes.Lines) cost roll-up joined via
-- quotes.ParentJobAutoId; PO adjustment needs UNNEST(purchase_orders.Lines) per JobId.
CREATE OR REPLACE VIEW `vmimporteddata.models.all_in_job` AS
WITH visit_notes AS (
  SELECT job_id, STRING_AGG(note_text, "\n" ORDER BY date_added) AS Visit_Notes
  FROM `vmimporteddata.models.notes`
  WHERE entity_type = "Visit" AND note_text IS NOT NULL AND TRIM(note_text) != ""
  GROUP BY job_id
),
last_visit_note AS (  -- single most-recent Visit-entity note per job
  SELECT job_id, note_text AS Last_Engineer_Note
  FROM `vmimporteddata.models.notes`
  WHERE entity_type = "Visit" AND note_text IS NOT NULL AND TRIM(note_text) != ""
  QUALIFY ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY date_added DESC) = 1
),
job_cost AS (  -- one row per job; QUALIFY guards against upsert dupes
  SELECT job_id, total_cost_exvat, total_sell_exvat
  FROM `vmimporteddata.raw.job_costs`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY _ingested_at DESC) = 1
)
SELECT
  j.JobNumber                 AS ID,
  j.SiteName                  AS Site,
  j.Area                      AS Area,
  j.SitePostcode              AS Post_Code,
  CAST(j.Telephone AS STRING) AS Telephone,
  j.Contact                   AS Contact,
  j.Description               AS Description,
  j.CustomerName              AS Customer,
  j.OrderNumber               AS Order_Number,
  j.JobStatusDescription      AS Job_Status,
  DATETIME(j.DateLogged, "Europe/London")      AS Date_Logged,
  DATETIME(j.AppointmentDate, "Europe/London") AS Estimated_Appointment,
  DATETIME(j.DateComplete, "Europe/London")    AS DateComplete,
  j.TypeDescription           AS Job_Type,
  j.CategoryDescription       AS Job_Category,
  IF(j.DateComplete IS NULL, "OPEN", "CLOSE") AS Open_Closed_Job,
  (j.DateComplete IS NULL)    AS Is_Open,
  j.CustomerCustomReference   AS Custom_Reference,
  j.ReportedFaultCode         AS Reported_Fault_Code,
  j.ReportedSubFaultCode      AS Reported_Sub_Fault_Code,
  j.ActualFaultCode           AS Actual_Fault_Code,
  j.ActualSubFaultCode        AS Actual_Sub_Fault_Code,
  CAST(ROUND(jc.total_cost_exvat, 2) AS NUMERIC) AS TotalJobCost,  -- ex-VAT, raw.job_costs
  CAST(ROUND(jc.total_sell_exvat, 2) AS NUMERIC) AS TotalJobSell,  -- ex-VAT, raw.job_costs
  CAST(NULL AS NUMERIC)       AS TotalQuoteCost,           -- FULL PASS: needs quote line-item costs
  CAST(NULL AS NUMERIC)       AS TotalQuoteSell,           -- FULL PASS: quote roll-up per job
  CAST(NULL AS NUMERIC)       AS PurchaseOrderAdjustment,  -- FULL PASS: PO line-item roll-up
  j.PriorityDescription       AS Priority,
  -- count of COMPLETE visits only (for First Time Fix: FTF job = Visit_Count = 1).
  (SELECT COUNT(*) FROM UNNEST(j.VisitsStatus) v
     WHERE v.StatusDescription = "Complete") AS Visit_Count,
  vn.Visit_Notes              AS Visit_Notes,
  (SELECT v.EngineerName FROM UNNEST(j.VisitsStatus) v
     WHERE v.EngineerName IS NOT NULL ORDER BY v.StartDate DESC LIMIT 1) AS Engineer,
  lvn.Last_Engineer_Note      AS Last_Engineer_Note,
  j.Tags                      AS Job_Tags,
  CAST(NULL AS BOOL)          AS Service_Job,              -- FULL PASS: PPM service flag
  CAST(NULL AS STRING)        AS Service_Description,      -- FULL PASS: PPM service
  j.Id                        AS Job_Auto_Id,
  j._ingested_at
FROM `vmimporteddata.raw.jobs` j
LEFT JOIN visit_notes vn ON vn.job_id = j.Id
LEFT JOIN last_visit_note lvn ON lvn.job_id = j.Id
LEFT JOIN job_cost jc ON jc.job_id = j.Id;

-- Avg visits per job (faithful port of old importdata Avg_Visits_Per_Job). Sources = models.job_and_visit_details
-- (visits) + models.all_in_job (Job_Type, Date_Logged). Excludes cancelled visits; per-job grain.
CREATE OR REPLACE VIEW `vmimporteddata.models.avg_visits_per_job` AS
WITH visits_per_job AS (
  SELECT
    v.ID,
    j.Job_Type,
    DATE_TRUNC(MIN(DATE(j.Date_Logged)), MONTH) AS Month,
    COUNT(*) AS Visit_Count
  FROM `vmimporteddata.models.job_and_visit_details` v
  LEFT JOIN `vmimporteddata.models.all_in_job` j ON v.ID = j.ID
  WHERE v.Visit_Status != "Cancelled"
  GROUP BY 1,2
)
SELECT ID, Job_Type, Month, AVG(Visit_Count) AS Avg_Visits_Per_Job, COUNT(*) AS Job_Count
FROM visits_per_job
GROUP BY 1,2,3
ORDER BY 3;

CREATE OR REPLACE VIEW `vmimporteddata.models.completed_visits_by_engineer` AS
SELECT Engineer AS engineer, DATE(VisitEndDateTime) AS date, COUNT(*) AS visits_completed
FROM `vmimporteddata.models.job_and_visit_details`
WHERE Visit_Status = "Complete" AND Engineer IS NOT NULL AND VisitEndDateTime IS NOT NULL
GROUP BY engineer, date;

-- Subcontractor allocation = subcontractor POs (bulk) enriched with job detail. Column names match
-- the old Subcontractor_Job_Allocation_clean. Nulls need heavier per-PO/per-job pulls (see notes).
CREATE OR REPLACE VIEW `vmimporteddata.models.subcontractor_allocation` AS
SELECT
  spo.JobNumber                          AS Job_Number,
  TRIM(spo.SubContractorName)            AS Subcontractor_Name,
  spo.Status                             AS Status,
  j.PriorityDescription                  AS Subcontractor_Priority,
  DATETIME(spo.DateRaised, "Europe/London")          AS DateAllocated,          -- PO raised date (proxy for allocation)
  CAST(NULL AS STRING)                   AS Allocated_By,           -- needs JobSubcontractor (per-job)
  (j.TypeDescription = "Maintenance")    AS PPM_Allocation,
  DATETIME(j.AppointmentDate, "Europe/London")       AS Preferred_Appointment,
  DATETIME(j.TargetCompletetionDate, "Europe/London") AS Target_Completion,
  j.Description                          AS Work_Description,
  CAST(NULL AS STRING)                   AS Work_Instructions,      -- needs JobSubcontractor (per-job)
  CAST(NULL AS NUMERIC)                  AS Total_Estimated_Value,  -- needs SubcontractorPO line items
  spo.PONumber                           AS PO_Number,
  spo.CompletionStatus                   AS PO_Completion_Status,
  CAST(NULL AS STRING)                   AS PO_Invoice_Status,      -- needs SubcontractorPO invoice lookup
  spo.UniqueId                           AS spo_uid,
  spo.AccountNumber, spo.CustomReference, spo._ingested_at
FROM `vmimporteddata.raw.subcontractor_purchase_orders` spo
LEFT JOIN `vmimporteddata.raw.jobs` j ON j.JobNumber = spo.JobNumber;

CREATE OR REPLACE VIEW `vmimporteddata.models.sla_analysis` AS
WITH first_visits AS (
  SELECT
    j.Job_Number AS ID, j.Site, j.Priority,
    j.DateLogged AS Date_Logged, j.CompletedDate AS DateComplete,
    MIN(v.VisitDateTime) AS First_Visit,
    COALESCE(MIN(v.VisitDateTime),
             IF(j.CompletedDate IS NULL, CURRENT_DATETIME("Europe/London"), j.CompletedDate)) AS Effective_End,
    CASE
      WHEN j.Priority LIKE "%P1%" OR j.Priority LIKE "%Emergency%" THEN 2
      WHEN j.Priority LIKE "%24-hour%" OR j.Priority LIKE "%P3%" THEN 24
      WHEN j.Priority LIKE "%8-hour%" THEN 8
      WHEN j.Priority LIKE "%4-hour%" OR j.Priority LIKE "%P2%" THEN 4
      WHEN j.Priority LIKE "%P4%" THEN 48
      WHEN j.Priority LIKE "%P5%" THEN 120
    END AS SLA_Target_Hours
  FROM `vmimporteddata.models.all_jobs_report` j
  LEFT JOIN `vmimporteddata.models.job_and_visit_details` v
    ON j.Job_Number = v.ID AND v.Visit_Status = "Complete"
  WHERE j.Job_Type = "Reactive"
  GROUP BY 1,2,3,4,5
),
status_timeline AS (
  SELECT Job_ID, New_Job_Status, Timestamp AS period_start,
    LEAD(Timestamp) OVER (PARTITION BY Job_ID ORDER BY Timestamp) AS period_end
  FROM `vmimporteddata.models.job_status_audit`
),
pause_hours AS (
  SELECT st.Job_ID,
    SUM(GREATEST(0, DATETIME_DIFF(
      LEAST(COALESCE(st.period_end, fv.Effective_End), fv.Effective_End),
      GREATEST(st.period_start, fv.Date_Logged), HOUR))) AS total_pause_hours
  FROM status_timeline st
  INNER JOIN first_visits fv ON st.Job_ID = fv.ID
  WHERE st.New_Job_Status IN ("Waiting on Submitter","Waiting on External Party","Waiting on Approval",
        "CM Action Required","Pending","Awaiting Parts")
    AND st.period_start < fv.Effective_End
  GROUP BY st.Job_ID
),
with_hours AS (
  SELECT fv.*, COALESCE(p.total_pause_hours, 0) AS Pause_Hours,
    GREATEST(0,
      CASE
        WHEN fv.Priority LIKE "%P1%" OR fv.Priority LIKE "%P2%" OR fv.Priority LIKE "%Emergency%"
             OR (fv.Priority LIKE "%4-hour%" AND fv.Priority NOT LIKE "%24-hour%")
        THEN CAST(DATETIME_DIFF(fv.Effective_End, fv.Date_Logged, HOUR) AS FLOAT64)
        ELSE `vmimporteddata.models.business_hours_elapsed`(fv.Date_Logged, fv.Effective_End)
      END - COALESCE(p.total_pause_hours, 0)
    ) AS Hours_to_Visit
  FROM first_visits fv LEFT JOIN pause_hours p ON fv.ID = p.Job_ID
)
SELECT ID, Site, Priority, Date_Logged, DateComplete, First_Visit, Hours_to_Visit, Pause_Hours,
  SLA_Target_Hours,
  CASE WHEN SLA_Target_Hours IS NULL THEN "No Priority Set"
       WHEN Hours_to_Visit > SLA_Target_Hours THEN "Breached"
       ELSE "Within SLA" END AS SLA_Breached
FROM with_hours;

-- Statutory / Critical classification from job Tags (2026-07-21). Returns ALL raw.jobs columns EXCEPT
-- the 27 that are 100% NULL/empty (listed in EXCEPT below) plus a derived Statutory_Category. Tags is a
-- comma-separated STRING; split + trim so we match WHOLE tags, not substrings (so "Critical Spares" is NOT
-- counted as "Critical"). Statutory wins if a job somehow carries both. Critical branch is currently 0 rows
-- (no exact "Critical" tag exists yet) but is future-proof. One row per job.
-- NB the EXCEPT list is a point-in-time snapshot of all-empty columns; if a previously-empty column starts
-- getting populated it will stay hidden until removed from this list (re-run the null-count check to refresh).
-- Is_Subcontracted (2026-10-07): TRUE if a subcontractor is allocated on the job (raw.jobs.Subcontractors)
-- OR the job has a non-cancelled subcontractor PO. Both are needed: ~650 jobs carry a subcontractor with
-- no PO, and ~190 have a live PO but no subcontractor left on the job. Subcontractor_Names unions both.
CREATE OR REPLACE VIEW `vmimporteddata.models.job_statutory_category` AS
WITH spo AS (
  SELECT JobNumber,
         ARRAY_AGG(DISTINCT TRIM(SubContractorName) IGNORE NULLS) AS spo_names,
         COUNT(DISTINCT PONumber)                                  AS spo_count
  FROM `vmimporteddata.raw.subcontractor_purchase_orders`
  WHERE JobNumber IS NOT NULL AND IFNULL(Status, "") != "Cancelled"
  GROUP BY JobNumber
)
SELECT
  j.* EXCEPT (
    ActualFaultCode, ActualSubFaultCode, AssetFrequency, AttributeDescriptions, AxaAuthorisationCode,
    AxaRef, CustomerContractId, CustomerContractNumber, DepotId, DepotName, DocumentName, EDIReference,
    EquipmentClass, ExternalProjectNumber, ImportedEndDate, ImportedStartDate, JobSpendLimit, JobTempSite,
    ProjectColor, ProjectMilestoneDate, ProjectMilestoneId, ProjectMilestoneName, ReportedFaultCode,
    ReportedSubFaultCode, SitePreferredEngineerName, SiteTypeDescription, SiteTypeId
  ) REPLACE (
    DATETIME(j.AppointmentDate, "Europe/London")        AS AppointmentDate,
    DATETIME(j.ApprovedDate, "Europe/London")           AS ApprovedDate,
    DATETIME(j.DateComplete, "Europe/London")           AS DateComplete,
    DATETIME(j.DateJobAttended, "Europe/London")        AS DateJobAttended,
    DATETIME(j.DateLogged, "Europe/London")             AS DateLogged,
    DATETIME(j.NextContactDate, "Europe/London")        AS NextContactDate,
    DATETIME(j.TargetAttendanceDate, "Europe/London")   AS TargetAttendanceDate,
    DATETIME(j.TargetCompletetionDate, "Europe/London") AS TargetCompletetionDate,
    DATETIME(j.UpdatedAt, "Europe/London")              AS UpdatedAt,
    ARRAY(SELECT AS STRUCT v.* REPLACE (DATETIME(v.StartDate, "Europe/London") AS StartDate,
                                        DATETIME(v.EndDate, "Europe/London")   AS EndDate)
          FROM UNNEST(j.VisitsStatus) v WITH OFFSET o ORDER BY o) AS VisitsStatus
  ),
  CASE
    WHEN EXISTS (SELECT 1 FROM UNNEST(SPLIT(j.Tags, ",")) t WHERE LOWER(TRIM(t)) = "statutory") THEN "Statutory"
    WHEN EXISTS (SELECT 1 FROM UNNEST(SPLIT(j.Tags, ",")) t WHERE LOWER(TRIM(t)) = "critical")  THEN "Critical"
    ELSE "Non-Statutory"
  END AS Statutory_Category,
  (ARRAY_LENGTH(j.Subcontractors) > 0 OR spo.JobNumber IS NOT NULL) AS Is_Subcontracted,
  (SELECT STRING_AGG(DISTINCT n, ", " ORDER BY n)
     FROM UNNEST(ARRAY_CONCAT(IFNULL(j.Subcontractors, []), IFNULL(spo.spo_names, []))) n
    WHERE TRIM(n) != "")                                             AS Subcontractor_Names,
  IFNULL(spo.spo_count, 0)                                           AS Subcontractor_PO_Count
FROM `vmimporteddata.raw.jobs` j
LEFT JOIN spo ON spo.JobNumber = j.JobNumber;

-- Neko Health UK Limited slice of job_statutory_category (for a Neko-specific report). (2026-07-22)
CREATE OR REPLACE VIEW `vmimporteddata.models.job_statutory_category_neko` AS
SELECT *
FROM `vmimporteddata.models.job_statutory_category`
WHERE CustomerName = "Neko Health UK Limited";

-- v2 of job_statutory_category (2026-10-08). Same rows/columns as v1 (v1 left untouched), but Statutory_Category
-- also looks at the PPM CONTRACT's tags and the job Description, because PPM jobs usually carry no job tags —
-- e.g. PM0000137/157 has no tags but its contract PM0000137 is tagged "StatutoryPPM" and the description says
-- "STATUTORY - Must be completed". Precedence: Statutory (any source) > Critical (job or contract tag) > Non-Statutory.
--   * Contract tags come from raw.ppm_contract_tags (contract number = JobNumber prefix before "/"). The public API's
--     PPMContract/GetAll has no tags, so that table comes from the web app's /api/PPMContract/SearchPPMContract,
--     refreshed nightly ~01:00 by the Mac scheduled task "refresh-ppm-contract-tags" (pull_ppm_contract_tags.js
--     + load_ppm_contract_tags.py) — NOT the VM. Contract tag "Non Statutory" is deliberately not matched.
--     Contract details without tags: raw.ppm_contracts (VM, nightly 03:00 via PPMContract/GetAll).
--   * Description: whole word "statutory", ignoring "non-statutory"/"non statutory".
-- Statutory_Source / Critical_Source list every source that matched (e.g. "Contract Tag, Description").
CREATE OR REPLACE VIEW `vmimporteddata.models.job_statutory_category_v2` AS
WITH flagged AS (
  SELECT
    v.* EXCEPT (Statutory_Category),
    ct.Tags AS Contract_Tags,
    EXISTS (SELECT 1 FROM UNNEST(SPLIT(v.Tags, ",")) t WHERE LOWER(TRIM(t)) = "statutory")     AS stat_job_tag,
    EXISTS (SELECT 1 FROM UNNEST(ct.TagList) t WHERE LOWER(TRIM(t)) = "statutoryppm")          AS stat_contract_tag,
    REGEXP_CONTAINS(REGEXP_REPLACE(LOWER(IFNULL(v.Description, "")), r"non[\s-]*statutory", ""),
                    r"\bstatutory\b")                                                           AS stat_description,
    EXISTS (SELECT 1 FROM UNNEST(SPLIT(v.Tags, ",")) t WHERE LOWER(TRIM(t)) = "critical")      AS crit_job_tag,
    EXISTS (SELECT 1 FROM UNNEST(ct.TagList) t WHERE LOWER(TRIM(t)) = "critical")              AS crit_contract_tag
  FROM `vmimporteddata.models.job_statutory_category` v
  LEFT JOIN `vmimporteddata.raw.ppm_contract_tags` ct
    ON ct.PPMContractNumber = REGEXP_EXTRACT(v.JobNumber, r"^(PM\d+)/")
)
SELECT
  f.* EXCEPT (stat_job_tag, stat_contract_tag, stat_description, crit_job_tag, crit_contract_tag),
  CASE
    WHEN stat_job_tag OR stat_contract_tag OR stat_description THEN "Statutory"
    WHEN crit_job_tag OR crit_contract_tag                     THEN "Critical"
    ELSE "Non-Statutory"
  END AS Statutory_Category,
  ARRAY_TO_STRING(ARRAY(SELECT s FROM UNNEST([
    IF(stat_job_tag, "Job Tag", NULL), IF(stat_contract_tag, "Contract Tag", NULL),
    IF(stat_description, "Description", NULL)]) s WHERE s IS NOT NULL), ", ")   AS Statutory_Source,
  ARRAY_TO_STRING(ARRAY(SELECT s FROM UNNEST([
    IF(crit_job_tag, "Job Tag", NULL), IF(crit_contract_tag, "Contract Tag", NULL)]) s
    WHERE s IS NOT NULL), ", ")                                                 AS Critical_Source
FROM flagged f;

-- Invoice header + Job Type/Category/Status (one row per invoice). SELL side only (no cost on invoices).
-- Job fields NULL for batch/PPM/credit invoices with no single-job link (~880). (2026-07-22)
CREATE OR REPLACE VIEW `vmimporteddata.models.invoices_enriched` AS
SELECT
  i.InvoiceNumber            AS Invoice_Number,
  i.Id                       AS Invoice_Id,
  i.Type                     AS Invoice_Type_Id,
  (i.PPMContractId IS NOT NULL) AS Is_PPM_Invoice,
  DATETIME(i.DateRaised, "Europe/London")     AS Invoice_Date,
  DATETIME(i.PaymentDueDate, "Europe/London") AS Payment_Due_Date,
  i.CustomerName             AS Customer,
  i.CustomerId               AS Customer_Id,
  i.SiteName                 AS Site,
  i.SiteId                   AS Site_Id,
  i.SitePostCode             AS Site_Postcode,
  i.OrderNumber              AS Order_Number,
  i.Description              AS Description,
  i.JobDescription           AS Job_Description,
  i.TotalExcludingVat        AS Total_Excl_VAT,
  i.TotalVatAmount           AS Total_VAT,
  i.TotalIncludingVat        AS Total_Incl_VAT,
  i.GrandTotal               AS Grand_Total,
  i.GlobalDiscount           AS Global_Discount,
  i.IsCredit                 AS Is_Credit,
  i.CreditReason             AS Credit_Reason,
  i.IsDraft                  AS Is_Draft,
  i.Tags                     AS Invoice_Tags,
  i.JobNumber                AS Job_Number,
  i.JobId                    AS Job_Id,
  j.TypeDescription          AS Job_Type,
  j.CategoryDescription      AS Job_Category,
  j.JobStatusDescription     AS Job_Status,
  j.JobTrade                 AS Job_Trade,
  i.PPMContractId            AS PPM_Contract_Id,
  i.UniqueId                 AS Invoice_Uid,
  i._ingested_at
FROM `vmimporteddata.raw.invoices` i
LEFT JOIN `vmimporteddata.raw.jobs` j ON j.Id = i.JobId;

-- Neko Health UK Limited slice of invoices_enriched. (2026-07-22)
CREATE OR REPLACE VIEW `vmimporteddata.models.invoices_enriched_neko` AS
SELECT *
FROM `vmimporteddata.models.invoices_enriched`
WHERE Customer = "Neko Health UK Limited";

-- Neko Health UK Limited slice of all_in_job. (2026-07-23)
CREATE OR REPLACE VIEW `vmimporteddata.models.all_in_job_neko` AS
SELECT *
FROM `vmimporteddata.models.all_in_job`
WHERE Customer = "Neko Health UK Limited";

-- Neko Health UK Limited slice of quote_tracking. (2026-07-23)
CREATE OR REPLACE VIEW `vmimporteddata.models.quote_tracking_neko` AS
SELECT *
FROM `vmimporteddata.models.quote_tracking`
WHERE customer = "Neko Health UK Limited";

-- Cost line items: one row per JobCost line (exploded from raw.job_costs.lines_json). (2026-07-23)
CREATE OR REPLACE VIEW `vmimporteddata.models.cost_line_items` AS
-- One row per JobCost line, exploded from raw.job_costs.lines_json across all 10 categories.
-- Invoiced lines link to the invoice by InvoiceGuid (InvoiceId is mostly null); we join
-- InvoiceGuid -> raw.invoices.UniqueId (fallback InvoiceId -> Id) to get invoice number + date.
WITH exploded AS (
  SELECT job_id, job_number, _ingested_at, "Material" AS category, line
  FROM `vmimporteddata.raw.job_costs`, UNNEST(JSON_QUERY_ARRAY(lines_json, "$.MaterialLines")) AS line
  UNION ALL
  SELECT job_id, job_number, _ingested_at, "Labour" AS category, line
  FROM `vmimporteddata.raw.job_costs`, UNNEST(JSON_QUERY_ARRAY(lines_json, "$.LabourLines")) AS line
  UNION ALL
  SELECT job_id, job_number, _ingested_at, "Expense" AS category, line
  FROM `vmimporteddata.raw.job_costs`, UNNEST(JSON_QUERY_ARRAY(lines_json, "$.ExpenseLines")) AS line
  UNION ALL
  SELECT job_id, job_number, _ingested_at, "Travel" AS category, line
  FROM `vmimporteddata.raw.job_costs`, UNNEST(JSON_QUERY_ARRAY(lines_json, "$.TravelLines")) AS line
  UNION ALL
  SELECT job_id, job_number, _ingested_at, "Mileage" AS category, line
  FROM `vmimporteddata.raw.job_costs`, UNNEST(JSON_QUERY_ARRAY(lines_json, "$.MileageLines")) AS line
  UNION ALL
  SELECT job_id, job_number, _ingested_at, "Callout" AS category, line
  FROM `vmimporteddata.raw.job_costs`, UNNEST(JSON_QUERY_ARRAY(lines_json, "$.CalloutLines")) AS line
  UNION ALL
  SELECT job_id, job_number, _ingested_at, "Overtime" AS category, line
  FROM `vmimporteddata.raw.job_costs`, UNNEST(JSON_QUERY_ARRAY(lines_json, "$.OvertimeLines")) AS line
  UNION ALL
  SELECT job_id, job_number, _ingested_at, "Subcontractor" AS category, line
  FROM `vmimporteddata.raw.job_costs`, UNNEST(JSON_QUERY_ARRAY(lines_json, "$.SubcontractorLines")) AS line
  UNION ALL
  SELECT job_id, job_number, _ingested_at, "ScheduleOfRates" AS category, line
  FROM `vmimporteddata.raw.job_costs`, UNNEST(JSON_QUERY_ARRAY(lines_json, "$.ScheduleOfRatesLines")) AS line
  UNION ALL
  SELECT job_id, job_number, _ingested_at, "Other" AS category, line
  FROM `vmimporteddata.raw.job_costs`, UNNEST(JSON_QUERY_ARRAY(lines_json, "$.OtherLines")) AS line
)
SELECT
  e.job_id, e.job_number,
  j.TypeDescription                                                  AS job_type,
  e.category,
  SAFE_CAST(JSON_VALUE(e.line, "$.Id") AS INT64)                     AS line_id,
  JSON_VALUE(e.line, "$.Description")                                AS description,
  SAFE_CAST(JSON_VALUE(e.line, "$.Quantity") AS FLOAT64)             AS quantity,
  DATETIME(SAFE.PARSE_TIMESTAMP("%Y-%m-%dT%H:%M:%S", JSON_VALUE(e.line, "$.DateIncurred")), "Europe/London") AS date_incurred,
  SAFE_CAST(JSON_VALUE(e.line, "$.TotalCostExcludingVat") AS FLOAT64) AS cost_excl_vat,
  SAFE_CAST(JSON_VALUE(e.line, "$.TotalSellExcludingVat") AS FLOAT64) AS sell_excl_vat,
  (JSON_VALUE(e.line, "$.HasBeenInvoiced") = "true")                 AS has_been_invoiced,
  (JSON_VALUE(e.line, "$.IsChargeable") = "true")                    AS is_chargeable,
  (JSON_VALUE(e.line, "$.IsQuotedValue") = "true")                   AS is_quoted_value,
  JSON_VALUE(e.line, "$.EngineerName")                               AS engineer_name,
  JSON_VALUE(e.line, "$.SubcontractorName")                          AS subcontractor_name,
  JSON_VALUE(e.line, "$.StatusDescription")                          AS status,
  JSON_VALUE(e.line, "$.InvoiceGuid")                                AS invoice_guid,
  COALESCE(ig.InvoiceNumber, ii.InvoiceNumber)                       AS invoice_number,
  DATE(COALESCE(ig.DateRaised, ii.DateRaised), "Europe/London")      AS invoiced_date,
  e._ingested_at
FROM exploded e
LEFT JOIN `vmimporteddata.raw.jobs` j ON j.Id = e.job_id
LEFT JOIN `vmimporteddata.raw.invoices` ig ON ig.UniqueId = JSON_VALUE(e.line, "$.InvoiceGuid")
LEFT JOIN `vmimporteddata.raw.invoices` ii ON ii.Id = SAFE_CAST(JSON_VALUE(e.line, "$.InvoiceId") AS INT64);


-- Parameterised report: per-job roll-up of costs NOT invoiced before `cutoff`. (2026-07-23)
CREATE OR REPLACE TABLE FUNCTION `vmimporteddata.models.job_uninvoiced_costs`(cutoff DATE) AS (
-- Per-job roll-up of outstanding (uninvoiced) sell value, from TWO sources:
--  (A) COST-LINE jobs: cost lines NOT invoiced before `cutoff` (never-invoiced OR invoiced
--      on/after cutoff). Total_Sell_Exc_Vat = sell of those included lines only.
--  (B) QUOTE-BILLED jobs (empty cost tab, e.g. Projects): jobs whose value lives in
--      raw.jobs.QuotedValue rather than cost lines. Total_Sell_Exc_Vat = QuotedValue minus
--      invoiced-to-date (ex VAT); included only when that remainder is > 0.
--      The `cutoff` does NOT apply to branch (B) — outstanding is a point-in-time balance.
-- Grain: one row per job. Branches are mutually exclusive (B requires an empty cost tab, so
-- such jobs never appear in `incl`), so no job is counted twice.
WITH incl AS (
  SELECT job_id,
         SUM(sell_excl_vat)   AS total_sell,
         MAX(invoiced_date)   AS max_invoiced_date
  FROM `vmimporteddata.models.cost_line_items`
  WHERE invoiced_date IS NULL OR invoiced_date >= cutoff
  GROUP BY job_id
),
inv AS (  -- invoiced-to-date per job (ex VAT), for the quote-billed branch
  SELECT JobNumber              AS job_number,
         SUM(TotalExcludingVat) AS invoiced_net,
         MAX(DATE(DateRaised, "Europe/London")) AS last_invoiced
  FROM `vmimporteddata.raw.invoices`
  WHERE JobNumber IS NOT NULL
  GROUP BY JobNumber
),
po AS (
  SELECT job_id, STRING_AGG(DISTINCT pon, ", ") AS po_numbers FROM (
    SELECT SAFE_CAST(po.JobId AS INT64) AS job_id, po.PONumber AS pon
    FROM `vmimporteddata.raw.purchase_orders` po WHERE po.PONumber IS NOT NULL
    UNION ALL
    SELECT j.Id AS job_id, spo.PONumber AS pon
    FROM `vmimporteddata.raw.subcontractor_purchase_orders` spo
    JOIN `vmimporteddata.raw.jobs` j ON j.JobNumber = spo.JobNumber
    WHERE spo.PONumber IS NOT NULL
  ) GROUP BY job_id
)
-- (A) cost-line branch
SELECT
  incl.max_invoiced_date        AS Invoice_Date,
  j.SiteName                    AS Site_Name,
  j.CategoryDescription         AS Job_Category,
  incl.total_sell               AS Total_Sell_Exc_Vat,
  j.OrderNumber                 AS Customer_Order_Number,
  j.Description                 AS Job_Description,
  DATETIME(j.DateComplete, "Europe/London") AS Date_Complete,
  j.TypeDescription             AS Job_Type,
  (SELECT v.EngineerName FROM UNNEST(j.VisitsStatus) v
     WHERE v.EngineerName IS NOT NULL ORDER BY v.StartDate DESC LIMIT 1) AS Last_Engineer,
  po.po_numbers                 AS PO_Number,
  j.JobStatusDescription        AS Job_Status,
  j.JobNumber                   AS Job_Number
FROM incl
JOIN `vmimporteddata.raw.jobs` j ON j.Id = incl.job_id
LEFT JOIN po ON po.job_id = incl.job_id

UNION ALL

-- (B) quote-billed branch: empty cost tab, QuotedValue not fully invoiced
SELECT
  inv.last_invoiced                             AS Invoice_Date,
  j.SiteName                                    AS Site_Name,
  j.CategoryDescription                         AS Job_Category,
  j.QuotedValue - COALESCE(inv.invoiced_net, 0) AS Total_Sell_Exc_Vat,
  j.OrderNumber                                 AS Customer_Order_Number,
  j.Description                                 AS Job_Description,
  DATETIME(j.DateComplete, "Europe/London")                 AS Date_Complete,
  j.TypeDescription                             AS Job_Type,
  (SELECT v.EngineerName FROM UNNEST(j.VisitsStatus) v
     WHERE v.EngineerName IS NOT NULL ORDER BY v.StartDate DESC LIMIT 1) AS Last_Engineer,
  po.po_numbers                                 AS PO_Number,
  j.JobStatusDescription                        AS Job_Status,
  j.JobNumber                                   AS Job_Number
FROM `vmimporteddata.raw.jobs` j
LEFT JOIN `vmimporteddata.raw.job_costs` jc ON jc.job_id = j.Id
LEFT JOIN inv ON inv.job_number = j.JobNumber
LEFT JOIN po  ON po.job_id      = j.Id
WHERE COALESCE(jc.n_lines, 0) = 0
  AND j.QuotedValue > 0
  AND j.QuotedValue - COALESCE(inv.invoiced_net, 0) > 0.01
);

-- Neko Health UK Limited slice of cost_line_items (filtered by Neko's jobs). (2026-07-27)
CREATE OR REPLACE VIEW `vmimporteddata.models.cost_line_items_neko` AS
SELECT cli.*
FROM `vmimporteddata.models.cost_line_items` cli
WHERE cli.job_id IN (
  SELECT Id FROM `vmimporteddata.raw.jobs` WHERE CustomerName = "Neko Health UK Limited"
);

-- PPM contracts with a Compliance_Rating (Statutory / Critical / Non-Statutory). (2026-10-08)
-- Contract details: raw.ppm_contracts (VM, nightly 03:00). Tags: raw.ppm_contract_tags (Mac task, nightly ~01:00).
-- Same rules as job_statutory_category_v2 so a contract and its jobs agree. Precedence Statutory > Critical:
--   Statutory  = contract tag "StatutoryPPM", OR any of its jobs is Statutory in v2 (job tag / description)
--   Critical   = contract tag "Critical", OR any of its jobs is Critical in v2
--   PPM Contract = contract tag "PPM Contract" — checked FIRST, overrides the others (added 2026-10-08)
-- Contract tag "Non Statutory" is not matched. Compliance_Source lists every rule that fired.
CREATE OR REPLACE VIEW `vmimporteddata.models.ppm_contracts` AS
WITH jobs AS (
  SELECT REGEXP_EXTRACT(JobNumber, r"^(PM\d+)/") AS PPMContractNumber,
         LOGICAL_OR(Statutory_Category = "Statutory") AS any_stat_job,
         LOGICAL_OR(Statutory_Category = "Critical")  AS any_crit_job,
         COUNT(*)                                     AS Job_Count
  FROM `vmimporteddata.models.job_statutory_category_v2`
  WHERE STARTS_WITH(JobNumber, "PM")
  GROUP BY 1
), f AS (
  SELECT c.*,
         t.Tags AS Contract_Tags,
         IFNULL(j.Job_Count, 0) AS Job_Count,
         "StatutoryPPM" IN UNNEST(IFNULL(t.TagList, [])) AS stat_tag,
         "Critical"     IN UNNEST(IFNULL(t.TagList, [])) AS crit_tag,
         "PPM Contract" IN UNNEST(IFNULL(t.TagList, [])) AS ppm_tag,
         IFNULL(j.any_stat_job, FALSE) AS stat_job,
         IFNULL(j.any_crit_job, FALSE) AS crit_job
  FROM `vmimporteddata.raw.ppm_contracts` c
  LEFT JOIN `vmimporteddata.raw.ppm_contract_tags` t USING (PPMContractNumber)
  LEFT JOIN jobs j USING (PPMContractNumber)
)
SELECT
  f.* EXCEPT (stat_tag, crit_tag, ppm_tag, stat_job, crit_job),
  CASE WHEN ppm_tag              THEN "PPM Contract"
       WHEN stat_tag OR stat_job THEN "Statutory"
       WHEN crit_tag OR crit_job THEN "Critical"
       ELSE "Non-Statutory" END AS Compliance_Rating,
  ARRAY_TO_STRING(ARRAY(SELECT s FROM UNNEST([
    IF(ppm_tag, "Contract Tag: PPM Contract", NULL),
    IF(stat_tag, "Contract Tag: StatutoryPPM", NULL), IF(stat_job, "Job(s) Statutory", NULL),
    IF(crit_tag, "Contract Tag: Critical", NULL),     IF(crit_job, "Job(s) Critical", NULL)]) s
    WHERE s IS NOT NULL), ", ") AS Compliance_Source
FROM f;
