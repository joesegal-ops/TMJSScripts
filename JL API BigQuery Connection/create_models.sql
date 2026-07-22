-- Recreates the models layer (dataset `models`) + UDF. Region-agnostic (refers by name),
-- so it works whether raw/models are US or EU. sla_analysis reads an EU-local copy of the
-- status audit (vmimporteddata.models.job_status_audit) instead of the cross-region US table.

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
  q.QuoteNumber AS quote_number, q.Title AS title, q.Description AS description,
  COALESCE(jtm.description, qt.job_type_code) AS job_type,
  qt.job_type_code AS job_type_code,
  COALESCE(jcm.description, qt.job_category_code) AS job_category,
  qt.job_category_code AS job_category_code,
  q.QuoteStatusDescription AS status, q.OwnerName AS owner, DATE(q.DateLogged) AS date_logged,
  q.ApprovedDatetime AS approved_datetime,
  DATE(rj.date_rejected) AS date_rejected,
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
SELECT Id AS po_id, PONumber AS po_number, Status AS status_id, DateRaised AS date_raised,
       SupplierId AS supplier_id, JobId AS job_id, AccountNumber AS account_number,
       CustomReference AS custom_reference, DeliveryName AS delivery_name,
       DeliveryPostcode AS delivery_postcode, EstimatedDeliveryDate AS est_delivery_date,
       ARRAY_LENGTH(Lines) AS line_count, _ingested_at
FROM `vmimporteddata.raw.purchase_orders`;

CREATE OR REPLACE VIEW `vmimporteddata.models.purchase_order_lines` AS
SELECT po.Id AS po_id, po.PONumber AS po_number, po.DateRaised AS date_raised, po.SupplierId AS supplier_id,
       po.JobId AS job_id, l.Number AS line_number, l.Description AS description, l.Quantity AS quantity,
       l.PricePerUnit AS price_per_unit, l.TotalExcludingVat AS total_excl_vat, l.TotalVatAmount AS total_vat,
       l.IsDelivered AS is_delivered, l.DateDelivered AS date_delivered, po._ingested_at
FROM `vmimporteddata.raw.purchase_orders` po, UNNEST(po.Lines) AS l;

CREATE OR REPLACE VIEW `vmimporteddata.models.invoices` AS
SELECT InvoiceNumber AS invoice_number, Type AS invoice_type_id, DateRaised AS date_raised,
  PaymentDueDate AS payment_due_date, CustomerName AS customer, CustomerId AS customer_id,
  SiteName AS site, SiteId AS site_id, JobNumber AS job_number, JobId AS job_id,
  OrderNumber AS order_number, AccountNumber AS account_number, Description AS description,
  JobDescription AS job_description, TotalExcludingVat AS total_excl_vat, TotalIncludingVat AS total_incl_vat,
  GrandTotal AS grand_total, GlobalDiscount AS global_discount, IsCredit AS is_credit,
  CreditReason AS credit_reason, IsDraft AS is_draft, PPMContractId AS ppm_contract_id,
  Id AS invoice_id, UniqueId AS invoice_uid, _ingested_at
FROM `vmimporteddata.raw.invoices`;

CREATE OR REPLACE VIEW `vmimporteddata.models.forms_logbook` AS
SELECT FormName AS form_name, FullFormName AS full_form_name, FormType AS form_type,
  DateCreated AS date_created, Customer AS customer, CustomerId AS customer_id, Site AS site, SiteId AS site_id,
  Engineer AS engineer, JobNumber AS job_number, JobId AS job_id, AssetDescription AS asset,
  AssetNumber AS asset_number, VisitComplete AS visit_complete, IsGeneralForm AS is_general_form,
  IsDynamicForm AS is_dynamic_form, UniqueId AS form_uid, _ingested_at
FROM `vmimporteddata.raw.forms_logbook`;

CREATE OR REPLACE VIEW `vmimporteddata.models.all_jobs_report` AS
SELECT
  JobNumber AS Job_Number, Description AS Job_Description, DateLogged, JobOwner AS Job_Owner,
  TargetAttendanceDate AS Target_AttendanceDate, AppointmentDate, TargetCompletetionDate AS Target_CompletionDate,
  DateComplete AS CompletedDate, TypeDescription AS Job_Type, CategoryDescription AS Job_Category,
  JobTrade AS Job_Trade, JobStatusDescription AS Job_Status, PriorityDescription AS Priority,
  OrderNumber AS Order_Number, Contact AS Job_Contact, CAST(Telephone AS STRING) AS Job_Telephone,
  EmailAddress AS Email_Address, CustomerName AS Customer, CustomerCustomReference AS Custom_Reference,
  ReportedFaultCode AS Reported_Fault_Code, ActualFaultCode AS Actual_Fault_Code,
  SiteName AS Site, SiteAddress1 AS Site_Address_1, SiteAddress2 AS Site_Address_2,
  SiteAddress3 AS Site_Address_3, SiteAddress4 AS Site_Address_4, SitePostcode AS Site_Postcode,
  SiteCustomReference AS Site_Reference, Area, QuotedValue AS Quoted_Value, Tags AS Job_Tags,
  NoOfVisits AS No_Of_Visits, CustomerId AS Customer_Id, SiteId AS Site_id, Id AS Job_Auto_Id,
  UpdatedAt, _ingested_at
FROM `vmimporteddata.raw.jobs`;

CREATE OR REPLACE VIEW `vmimporteddata.models.job_and_visit_details` AS
SELECT
  j.CustomerName AS Customer, j.SiteName AS Site, j.Area AS Area, j.JobNumber AS ID,
  j.Description AS Job_Description, j.JobStatusDescription AS Job_Status, j.OrderNumber AS Order_Number,
  j.TypeDescription AS Task_Type, j.CategoryDescription AS Job_Category, j.JobTrade AS Trade,
  j.DateLogged AS Date_Logged, j.TargetCompletetionDate AS Target_Completion_Date, j.DateComplete AS Date_Complete,
  v.EngineerName AS Engineer, v.EngineerEmail AS Engineer_Email, st.Active AS Engineer_Active,
  v.StartDate AS VisitDateTime, v.EndDate AS VisitEndDateTime, v.StatusDescription AS Visit_Status,
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
  n.DateAdded      AS date_added,
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
-- The 5 money columns (TotalJobCost/Sell, TotalQuoteCost/Sell, PurchaseOrderAdjustment) and the 2
-- Service columns are typed NULL placeholders pending the FULL pass: TotalJobCost/Sell need the JobCost
-- API endpoint backfilled into raw; quote figures need UNNEST(quotes.Lines) cost roll-up joined via
-- quotes.ParentJobAutoId; PO adjustment needs UNNEST(purchase_orders.Lines) per JobId.
CREATE OR REPLACE VIEW `vmimporteddata.models.all_in_job` AS
WITH visit_notes AS (
  SELECT job_id, STRING_AGG(note_text, "\n" ORDER BY date_added) AS Visit_Notes
  FROM `vmimporteddata.models.notes`
  WHERE entity_type = "Visit" AND note_text IS NOT NULL AND TRIM(note_text) != ""
  GROUP BY job_id
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
  j.DateLogged                AS Date_Logged,
  j.AppointmentDate           AS Estimated_Appointment,
  j.DateComplete              AS DateComplete,
  j.TypeDescription           AS Job_Type,
  j.CategoryDescription       AS Job_Category,
  IF(j.DateComplete IS NULL, "OPEN", "CLOSE") AS Open_Closed_Job,
  (j.DateComplete IS NULL)    AS Is_Open,
  j.CustomerCustomReference   AS Custom_Reference,
  j.ReportedFaultCode         AS Reported_Fault_Code,
  j.ReportedSubFaultCode      AS Reported_Sub_Fault_Code,
  j.ActualFaultCode           AS Actual_Fault_Code,
  j.ActualSubFaultCode        AS Actual_Sub_Fault_Code,
  CAST(NULL AS NUMERIC)       AS TotalJobCost,             -- FULL PASS: needs JobCost endpoint
  CAST(NULL AS NUMERIC)       AS TotalJobSell,             -- FULL PASS: needs JobCost endpoint
  CAST(NULL AS NUMERIC)       AS TotalQuoteCost,           -- FULL PASS: needs quote line-item costs
  CAST(NULL AS NUMERIC)       AS TotalQuoteSell,           -- FULL PASS: quote roll-up per job
  CAST(NULL AS NUMERIC)       AS PurchaseOrderAdjustment,  -- FULL PASS: PO line-item roll-up
  j.PriorityDescription       AS Priority,
  vn.Visit_Notes              AS Visit_Notes,
  j.Tags                      AS Job_Tags,
  CAST(NULL AS BOOL)          AS Service_Job,              -- FULL PASS: PPM service flag
  CAST(NULL AS STRING)        AS Service_Description,      -- FULL PASS: PPM service
  j.Id                        AS Job_Auto_Id,
  j._ingested_at
FROM `vmimporteddata.raw.jobs` j
LEFT JOIN visit_notes vn ON vn.job_id = j.Id;

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
  spo.DateRaised                         AS DateAllocated,          -- PO raised date (proxy for allocation)
  CAST(NULL AS STRING)                   AS Allocated_By,           -- needs JobSubcontractor (per-job)
  (j.TypeDescription = "Maintenance")    AS PPM_Allocation,
  j.AppointmentDate                      AS Preferred_Appointment,
  j.TargetCompletetionDate               AS Target_Completion,
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
    MIN(DATETIME(v.VisitDateTime)) AS First_Visit,
    COALESCE(MIN(DATETIME(v.VisitDateTime)),
             IF(j.CompletedDate IS NULL, CURRENT_DATETIME(), DATETIME(j.CompletedDate))) AS Effective_End,
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
      GREATEST(st.period_start, DATETIME(fv.Date_Logged)), HOUR))) AS total_pause_hours
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
        THEN CAST(DATETIME_DIFF(fv.Effective_End, DATETIME(fv.Date_Logged), HOUR) AS FLOAT64)
        ELSE `vmimporteddata.models.business_hours_elapsed`(DATETIME(fv.Date_Logged), fv.Effective_End)
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
CREATE OR REPLACE VIEW `vmimporteddata.models.job_statutory_category` AS
SELECT
  j.* EXCEPT (
    ActualFaultCode, ActualSubFaultCode, AssetFrequency, AttributeDescriptions, AxaAuthorisationCode,
    AxaRef, CustomerContractId, CustomerContractNumber, DepotId, DepotName, DocumentName, EDIReference,
    EquipmentClass, ExternalProjectNumber, ImportedEndDate, ImportedStartDate, JobSpendLimit, JobTempSite,
    ProjectColor, ProjectMilestoneDate, ProjectMilestoneId, ProjectMilestoneName, ReportedFaultCode,
    ReportedSubFaultCode, SitePreferredEngineerName, SiteTypeDescription, SiteTypeId
  ),
  CASE
    WHEN EXISTS (SELECT 1 FROM UNNEST(SPLIT(j.Tags, ",")) t WHERE LOWER(TRIM(t)) = "statutory") THEN "Statutory"
    WHEN EXISTS (SELECT 1 FROM UNNEST(SPLIT(j.Tags, ",")) t WHERE LOWER(TRIM(t)) = "critical")  THEN "Critical"
    ELSE "Non-Statutory"
  END AS Statutory_Category
FROM `vmimporteddata.raw.jobs` j;
