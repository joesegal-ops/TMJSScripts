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
