CREATE OR REPLACE VIEW `vmimporteddata.reporting.jobs` AS
WITH job_notes AS (
  SELECT job_id,
    STRING_AGG(note_text, "\n" ORDER BY date_added) AS Job_Notes,
    COUNT(*) AS Job_Note_Count
  FROM `vmimporteddata.models.notes`
  WHERE entity_type = "Job" AND note_text IS NOT NULL AND TRIM(note_text) != ""
  GROUP BY job_id
),
visit_notes AS (
  SELECT job_id,
    STRING_AGG(note_text, "\n" ORDER BY date_added) AS Engineer_Notes,
    COUNT(*) AS Engineer_Note_Count
  FROM `vmimporteddata.models.notes`
  WHERE entity_type = "Visit" AND note_text IS NOT NULL AND TRIM(note_text) != ""
  GROUP BY job_id
),
last_note AS (
  SELECT job_id, date_added AS Last_Note_Date, author AS Last_Note_By,
         entity_type AS Last_Note_Type, note_text AS Last_Note
  FROM `vmimporteddata.models.notes`
  WHERE note_text IS NOT NULL AND TRIM(note_text) != ""
  QUALIFY ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY date_added DESC, note_uid DESC) = 1
)
SELECT
  -- identifiers
  j.JobNumber                 AS Job_Number,
  j.Id                        AS Job_Auto_Id,
  CONCAT("https://go.joblogic.com/Job/Detail/", CAST(j.Id AS STRING)) AS Job_URL,
  -- who / where
  j.CustomerName              AS Customer,
  j.SiteName                  AS Site,
  j.Area                      AS Area,
  j.SitePostcode              AS Site_Postcode,
  j.Contact                   AS Contact,
  CAST(j.Telephone AS STRING) AS Telephone,
  j.EmailAddress              AS Email,
  -- what
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
  -- subcontractor (from raw.jobs.Subcontractors repeated field)
  ARRAY_LENGTH(j.Subcontractors) > 0      AS Subcontractor_Used,
  ARRAY_TO_STRING(j.Subcontractors, ", ") AS Subcontractor_Names,
  -- dates
  j.DateLogged                AS Date_Logged,
  j.AppointmentDate           AS Appointment_Date,
  j.TargetAttendanceDate      AS Target_Attendance_Date,
  j.TargetCompletetionDate    AS Target_Completion_Date,
  j.DateJobAttended           AS Date_Attended,
  j.DateComplete              AS Date_Complete,
  -- derived status / timing (Closed = status only; completion date is not used)
  CASE WHEN j.JobStatusDescription IN ("Completed","Invoiced","Costed","Cancelled")
       THEN "Closed" ELSE "Open" END AS Open_Closed,
  (j.JobStatusDescription NOT IN ("Completed","Invoiced","Costed","Cancelled")) AS Is_Open,
  DATE_DIFF(DATE(COALESCE(j.DateComplete, CURRENT_TIMESTAMP())), DATE(j.DateLogged), DAY) AS Age_Days,
  IF(j.JobStatusDescription NOT IN ("Completed","Invoiced","Costed","Cancelled"),
     DATE_DIFF(CURRENT_DATE(), DATE(j.DateLogged), DAY), NULL) AS Open_Age_Days,
  IF(j.DateJobAttended IS NOT NULL, TIMESTAMP_DIFF(j.DateJobAttended, j.DateLogged, HOUR), NULL) AS Response_Hours,
  NULLIF(j.PriorityResponseTime, 0) AS SLA_Target_Response_Minutes,
  -- notes
  jn.Job_Notes,
  vn.Engineer_Notes,
  COALESCE(jn.Job_Note_Count, 0)      AS Job_Note_Count,
  COALESCE(vn.Engineer_Note_Count, 0) AS Engineer_Note_Count,
  COALESCE(jn.Job_Note_Count, 0) + COALESCE(vn.Engineer_Note_Count, 0) AS Total_Note_Count,
  ln.Last_Note,
  ln.Last_Note_Date,
  ln.Last_Note_By,
  ln.Last_Note_Type,
  j._ingested_at
FROM `vmimporteddata.raw.jobs` j
LEFT JOIN job_notes   jn ON jn.job_id = j.Id
LEFT JOIN visit_notes vn ON vn.job_id = j.Id
LEFT JOIN last_note   ln ON ln.job_id = j.Id;

-- Neko Health UK Limited slice of reporting.jobs (Neko-specific dashboard). (2026-07-22)
CREATE OR REPLACE VIEW `vmimporteddata.reporting.jobs_neko` AS
SELECT *
FROM `vmimporteddata.reporting.jobs`
WHERE Customer = "Neko Health UK Limited";


-- ============================================================================
-- reporting.quote_to_job_completion  (added 2026-09-22)
-- One row per UPGRADED quote: quote approval -> completion of the job it became.
--
-- !! THE QUOTE -> UPGRADED-JOB LINK IS INFERRED, NOT INGESTED. !!
-- Joblogic's OAuth API exposes no job<->quote link in either direction (verified 2026-07-22:
-- Job/getall, Job/getbyid and Quote/getbyid all lack it; raw.jobs has only a HasParent bool).
-- The true link (UpgradedIntoJobNumber) exists ONLY in the cookie-authed web /Quote/Detail/{id},
-- which the VM cannot reach. So this view RECONSTRUCTS it from three observed regularities:
--   1. JL copies the quote's Description verbatim onto the upgraded job  (strongest signal)
--   2. the upgraded job carries the quote's OrderNumber
--   3. the upgraded job is logged within minutes of ApprovedDatetime, at the same site,
--      with HasParent = true
-- Candidates are ranked and the best one wins; link_confidence says which signal fired.
-- Validation: where signals 1 and 2 both resolve independently they agree on 98.9% of 1,218
-- quotes. Coverage 2,823 of 2,831 upgraded quotes (99.7%), 70% at "A - description (high)".
-- FILTER ON link_confidence FOR ANYTHING THAT MATTERS -- "D - time only" is a guess.
--
-- Other caveats when reading this view (2,823 rows at build time):
--   * 545 rows are jobs still open -- days_approval_to_completion is NULL for them, use
--     days_open_so_far. Always filter on is_complete before averaging a duration.
--   * 19 rows have a NEGATIVE duration (job completed before the quote was formally approved --
--     work started early, or back-dated entry). Left visible rather than clipped; exclude them
--     explicitly if they skew a chart.
--   * raw.jobs.DateComplete is date-only for a minority of jobs (~317 sit at 00:00:00 / 23:00:00),
--     so hours_approval_to_completion is spurious for those. PREFER days_* for reporting.
--   * job_category is NULL for ~980 rows -- a genuine JL gap (no category set on the quote),
--     not a mapping miss. job_type is 100% populated.
-- ============================================================================
CREATE OR REPLACE VIEW `vmimporteddata.reporting.quote_to_job_completion` AS
WITH upg AS (
  SELECT q.Id AS quote_id, q.QuoteNumber, q.ParentJobStringId, q.SiteId,
         q.ApprovedDatetime AS approved_at, q.DateLogged AS quote_logged,
         q.QuoteValue, q.QuoteValueExcludingVat, q.CustomerName, q.SiteName, q.OwnerName,
         UPPER(TRIM(q.OrderNumber)) AS onum,
         TO_HEX(MD5(TRIM(q.Description))) AS dhash
  FROM `vmimporteddata.raw.quotes` q
  WHERE (q.QuoteStatusDescription = "Upgraded" OR q.IsUpgraded)
    AND q.ApprovedDatetime IS NOT NULL
),
cand AS (
  SELECT u.*, j.Id AS job_id, j.JobNumber AS job_number, j.DateLogged AS job_logged,
         j.DateComplete AS job_completed, j.JobStatusDescription AS job_status,
         j.TypeDescription AS job_type_on_job, j.CategoryDescription AS job_category_on_job,
         j.JobOwner AS job_owner, j.QuotedValue AS job_quoted_value,
         (TO_HEX(MD5(TRIM(j.Description))) = u.dhash) AS desc_match,
         (UPPER(TRIM(j.OrderNumber)) = u.onum)        AS order_match,
         ABS(TIMESTAMP_DIFF(j.DateLogged, u.approved_at, MINUTE)) AS mins_from_approval
  FROM upg u
  JOIN `vmimporteddata.raw.jobs` j
    ON j.SiteId = u.SiteId
   AND j.JobNumber != IFNULL(u.ParentJobStringId, "~")          -- never match the ORIGINAL job
   AND (TO_HEX(MD5(TRIM(j.Description))) = u.dhash
        OR (j.HasParent AND ABS(TIMESTAMP_DIFF(j.DateLogged, u.approved_at, MINUTE)) <= 120))
),
ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY quote_id
      ORDER BY desc_match DESC, order_match DESC, mins_from_approval ASC, job_id ASC) AS rn,
    COUNTIF(desc_match) OVER (PARTITION BY quote_id) AS n_desc_matches
  FROM cand
)
SELECT
  r.quote_id, r.QuoteNumber AS quote_number,
  qt.job_type, qt.job_category,                       -- from models.quote_tracking (the quote's own)
  r.CustomerName AS customer, r.SiteName AS site, r.OwnerName AS quote_owner,
  r.QuoteValueExcludingVat AS quote_value_excl_vat, r.QuoteValue AS quote_value_incl_vat,
  DATE(r.quote_logged)  AS quote_logged_date,
  r.approved_at, DATE(r.approved_at) AS approved_date,
  r.ParentJobStringId AS original_job_number,
  r.job_number AS upgraded_job_number, r.job_id AS upgraded_job_id,
  r.job_status, r.job_type_on_job, r.job_category_on_job, r.job_owner, r.job_quoted_value,
  r.job_completed, DATE(r.job_completed) AS completed_date,
  r.job_completed IS NOT NULL AS is_complete,
  -- headline metric: approval -> completion. NULL while the job is still open.
  TIMESTAMP_DIFF(r.job_completed, r.approved_at, DAY)  AS days_approval_to_completion,
  TIMESTAMP_DIFF(r.job_completed, r.approved_at, HOUR) AS hours_approval_to_completion,
  -- how long an unfinished job has been running, for ageing/WIP views
  CASE WHEN r.job_completed IS NULL
       THEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), r.approved_at, DAY) END AS days_open_so_far,
  CASE WHEN r.desc_match AND r.n_desc_matches = 1 THEN "A - description (high)"
       WHEN r.desc_match                          THEN "B - description, tied (medium)"
       WHEN r.order_match                         THEN "C - order no + time (medium)"
       ELSE                                            "D - time only (low)" END AS link_confidence,
  r.mins_from_approval AS link_mins_from_approval,
  CONCAT("https://go.joblogic.com/Quote/Detail/", CAST(r.quote_id AS STRING)) AS quote_url,
  CONCAT("https://go.joblogic.com/Job/Detail/",   CAST(r.job_id   AS STRING)) AS job_url
FROM ranked r
LEFT JOIN `vmimporteddata.models.quote_tracking` qt ON qt.quote_id = r.quote_id
WHERE r.rn = 1;
