-- Neko Health AB (Sweden) model + reporting layer. Ported from UK DDL for views that depend
-- only on sweden_raw tables. DEFERRED: notes/enriched, quote_types enrichment, job_costs/
-- cost_line_items, invoices/PO/forms models, sla_analysis. all_in_job/quote_tracking/reporting.jobs
-- are enrichment-stripped variants. Dependency order matters (all_in_job before avg_visits_per_job).


CREATE OR REPLACE VIEW `vmimporteddata.sweden_models.customers` AS
SELECT Id AS customer_id, UniqueId AS customer_uid, Name AS customer_name, Active AS is_active,
       AccountNumber AS account_number, CustomReference AS custom_reference, Contact AS contact,
       EmailAddress AS email, Telephone AS telephone, Address AS address, Postcode AS postcode, _ingested_at
FROM `vmimporteddata.sweden_raw.customers`;

-- Quote tracking. job_type/job_category come from raw.quote_types (Quote/GetById;

CREATE OR REPLACE VIEW `vmimporteddata.sweden_models.all_jobs_report` AS
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
FROM `vmimporteddata.sweden_raw.jobs`;

CREATE OR REPLACE VIEW `vmimporteddata.sweden_models.job_and_visit_details` AS
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
FROM `vmimporteddata.sweden_raw.jobs` j
LEFT JOIN UNNEST(j.VisitsStatus) AS v
LEFT JOIN `vmimporteddata.sweden_raw.staff` st ON LOWER(st.EmailAddress) = LOWER(v.EngineerEmail);

-- Granular notes: one row per note (deduped by note UniqueId). _EntityType Job|Visit;

CREATE OR REPLACE VIEW `vmimporteddata.sweden_models.completed_visits_by_engineer` AS
SELECT Engineer AS engineer, DATE(VisitEndDateTime) AS date, COUNT(*) AS visits_completed
FROM `vmimporteddata.sweden_models.job_and_visit_details`
WHERE Visit_Status = "Complete" AND Engineer IS NOT NULL AND VisitEndDateTime IS NOT NULL
GROUP BY engineer, date;

CREATE OR REPLACE VIEW `vmimporteddata.sweden_models.job_statutory_category` AS
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
FROM `vmimporteddata.sweden_raw.jobs` j;

CREATE OR REPLACE VIEW `vmimporteddata.sweden_models.all_in_job` AS
SELECT
  j.JobNumber AS ID, j.SiteName AS Site, j.Area AS Area, j.SitePostcode AS Post_Code,
  CAST(j.Telephone AS STRING) AS Telephone, j.Contact AS Contact, j.Description AS Description,
  j.CustomerName AS Customer, j.OrderNumber AS Order_Number, j.JobStatusDescription AS Job_Status,
  j.DateLogged AS Date_Logged, j.AppointmentDate AS Estimated_Appointment, j.DateComplete AS DateComplete,
  j.TypeDescription AS Job_Type, j.CategoryDescription AS Job_Category,
  IF(j.DateComplete IS NULL, "OPEN", "CLOSE") AS Open_Closed_Job, (j.DateComplete IS NULL) AS Is_Open,
  j.CustomerCustomReference AS Custom_Reference, j.ReportedFaultCode AS Reported_Fault_Code,
  j.ReportedSubFaultCode AS Reported_Sub_Fault_Code, j.ActualFaultCode AS Actual_Fault_Code,
  j.ActualSubFaultCode AS Actual_Sub_Fault_Code,
  CAST(NULL AS NUMERIC) AS TotalJobCost, CAST(NULL AS NUMERIC) AS TotalJobSell,
  CAST(NULL AS NUMERIC) AS TotalQuoteCost, CAST(NULL AS NUMERIC) AS TotalQuoteSell,
  CAST(NULL AS NUMERIC) AS PurchaseOrderAdjustment,
  j.PriorityDescription AS Priority,
  (SELECT COUNT(*) FROM UNNEST(j.VisitsStatus) v WHERE v.StatusDescription = "Complete") AS Visit_Count,
  CAST(NULL AS STRING) AS Visit_Notes,
  j.Tags AS Job_Tags,
  CAST(NULL AS BOOL) AS Service_Job, CAST(NULL AS STRING) AS Service_Description,
  j.Id AS Job_Auto_Id, j._ingested_at
FROM `vmimporteddata.sweden_raw.jobs` j;

CREATE OR REPLACE VIEW `vmimporteddata.sweden_models.avg_visits_per_job` AS
WITH visits_per_job AS (
  SELECT
    v.ID,
    j.Job_Type,
    DATE_TRUNC(MIN(DATE(j.Date_Logged)), MONTH) AS Month,
    COUNT(*) AS Visit_Count
  FROM `vmimporteddata.sweden_models.job_and_visit_details` v
  LEFT JOIN `vmimporteddata.sweden_models.all_in_job` j ON v.ID = j.ID
  WHERE v.Visit_Status != "Cancelled"
  GROUP BY 1,2
)
SELECT ID, Job_Type, Month, AVG(Visit_Count) AS Avg_Visits_Per_Job, COUNT(*) AS Job_Count
FROM visits_per_job
GROUP BY 1,2,3
ORDER BY 3;

CREATE OR REPLACE VIEW `vmimporteddata.sweden_models.quote_tracking` AS
SELECT
  q.Id AS quote_id, q.QuoteNumber AS quote_number, q.Title AS title, q.Description AS description,
  CAST(NULL AS STRING) AS job_type, CAST(NULL AS STRING) AS job_type_code,
  CAST(NULL AS STRING) AS job_category, CAST(NULL AS STRING) AS job_category_code,
  q.QuoteStatusDescription AS status, q.OwnerName AS owner, DATE(q.DateLogged) AS date_logged,
  q.ApprovedDatetime AS approved_datetime, CAST(NULL AS DATE) AS date_rejected,
  q.CustomerName AS customer, q.CustomerCustomReference AS customer_reference,
  q.SiteName AS site, q.SitePostcode AS site_postcode, q.Contact AS contact, q.EmailAddress AS email,
  q.QuoteValueExcludingVat AS value_excl_vat, q.QuoteValue AS value_incl_vat,
  SAFE_CAST(q.ChanceOfSale AS FLOAT64) AS chance_of_sale,
  q.IsCancelled AS is_cancelled, q.IsRejected AS is_rejected, q.IsUpgraded AS is_upgraded, q._ingested_at
FROM `vmimporteddata.sweden_raw.quotes` q;

CREATE OR REPLACE VIEW `vmimporteddata.sweden_reporting.jobs` AS
-- Neko AB dashboard jobs view. Ported from UK reporting.jobs WITHOUT the notes columns (SE has no notes backfill).
SELECT
  j.JobNumber                 AS Job_Number,
  j.Id                        AS Job_Auto_Id,
  CONCAT("https://go.joblogic.com/Job/Detail/", CAST(j.Id AS STRING)) AS Job_URL,
  j.CustomerName              AS Customer,
  j.SiteName                  AS Site,
  j.Area                      AS Area,
  j.SitePostcode              AS Site_Postcode,
  j.Contact                   AS Contact,
  CAST(j.Telephone AS STRING) AS Telephone,
  j.EmailAddress              AS Email,
  j.Description               AS Job_Description,
  j.JobStatusDescription      AS Job_Status,
  j.TypeDescription           AS Job_Type,
  j.CategoryDescription       AS Job_Category,
  j.JobTrade                  AS Trade,
  j.PriorityDescription       AS Priority,
  j.OrderNumber               AS Order_Number,
  j.CustomerCustomReference   AS Custom_Reference,
  j.ReportedFaultCode         AS Reported_Fault_Code,
  j.ActualFaultCode           AS Actual_Fault_Code,
  j.Tags                      AS Job_Tags,
  j.NoOfVisits                AS No_Of_Visits,
  ARRAY_LENGTH(j.Subcontractors) > 0      AS Subcontractor_Used,
  ARRAY_TO_STRING(j.Subcontractors, ", ") AS Subcontractor_Names,
  j.DateLogged                AS Date_Logged,
  j.AppointmentDate           AS Appointment_Date,
  j.TargetAttendanceDate      AS Target_Attendance_Date,
  j.TargetCompletetionDate    AS Target_Completion_Date,
  j.DateJobAttended           AS Date_Attended,
  j.DateComplete              AS Date_Complete,
  CASE WHEN j.JobStatusDescription IN ("Completed","Invoiced","Costed","Cancelled")
       THEN "Closed" ELSE "Open" END AS Open_Closed,
  (j.JobStatusDescription NOT IN ("Completed","Invoiced","Costed","Cancelled")) AS Is_Open,
  DATE_DIFF(DATE(COALESCE(j.DateComplete, CURRENT_TIMESTAMP())), DATE(j.DateLogged), DAY) AS Age_Days,
  IF(j.JobStatusDescription NOT IN ("Completed","Invoiced","Costed","Cancelled"),
     DATE_DIFF(CURRENT_DATE(), DATE(j.DateLogged), DAY), NULL) AS Open_Age_Days,
  IF(j.DateJobAttended IS NOT NULL, TIMESTAMP_DIFF(j.DateJobAttended, j.DateLogged, HOUR), NULL) AS Response_Hours,
  NULLIF(j.PriorityResponseTime, 0) AS SLA_Target_Response_Minutes,
  j._ingested_at
FROM `vmimporteddata.sweden_raw.jobs` j;
