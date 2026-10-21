-- =====================================================================
-- UP Reporting - Weekly Job Report: output views
-- Project: importdata-494110   Dataset: JobLogic   Location: US
--
-- Run the whole file once in the BigQuery console (query location US).
-- Every statement is CREATE OR REPLACE, so it is safe to re-run.
--
-- Sources:
--   All_in_Job_clean, Job_and_Visit_Details_clean, Pending_Costs_clean,
--   Forms_Logbook_clean  (existing views fed by the email pipeline)
--   Salesforce.support_requests_clean  (daily Salesforce email loader)
--   Engineer_List  (small table pushed from the new sheet's input tab by
--   the Apps Script before each refresh)
--
-- All "today" logic uses UK time, matching TODAY() in the old sheet.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Input table (created empty here; the Apps Script overwrites it)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `importdata-494110.JobLogic.Engineer_List` (
  Row_Num INT64,
  Engineer STRING,
  Recipient STRING
);


-- ---------------------------------------------------------------------
-- Helper: normalise a reference number so 12196454, '12196454',
-- '12196454.0' and '1.2196454E7' all compare equal.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION `importdata-494110.JobLogic.norm_ref`(x ANY TYPE) AS (
  COALESCE(
    CAST(SAFE_CAST(TRIM(CAST(x AS STRING)) AS BIGNUMERIC) AS STRING),
    NULLIF(TRIM(CAST(x AS STRING)), '')
  )
);


-- ---------------------------------------------------------------------
-- Helper: one SF status per Support Request Number, from the Salesforce
-- dataset (latest modified wins if a number ever appears twice)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `importdata-494110.JobLogic.vw_SF_Status` AS
SELECT
  `importdata-494110.JobLogic.norm_ref`(Support_Request_Number) AS SF_Ref,
  Status AS SF_Status
FROM `importdata-494110.Salesforce.support_requests_clean`
WHERE Support_Request_Number IS NOT NULL
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY Support_Request_Number
  ORDER BY Date_Time_Last_Modified DESC
) = 1;


-- ---------------------------------------------------------------------
-- 1. Engineer Completed Visit
-- Old logic: COUNTIFS on Job and Visit Details for each engineer in a
-- fixed list, for visits from TODAY()-WEEKDAY(TODAY(),2)-1-7 up to (not
-- including) TODAY()-WEEKDAY(TODAY(),2)-1. That is Saturday to Friday
-- of the week before last Saturday. WC is Monday of last week.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `importdata-494110.JobLogic.vw_Out_Engineer_Completed_Visit` AS
WITH params AS (
  SELECT
    DATE_SUB(DATE_TRUNC(CURRENT_DATE('Europe/London'), WEEK(MONDAY)), INTERVAL 9 DAY) AS window_start,  -- Saturday
    DATE_SUB(DATE_TRUNC(CURRENT_DATE('Europe/London'), WEEK(MONDAY)), INTERVAL 2 DAY) AS window_end,    -- following Saturday (exclusive)
    DATE_SUB(DATE_TRUNC(CURRENT_DATE('Europe/London'), WEEK(MONDAY)), INTERVAL 7 DAY) AS wc            -- Monday of last week
),
visits AS (
  SELECT
    LOWER(TRIM(v.Engineer)) AS eng_key,
    v.Visit_Status,
    IFNULL(CAST(v.Is_Job_Completing_Visit AS STRING), '') IN ('true', '1') AS is_completing
  FROM `importdata-494110.JobLogic.Job_and_Visit_Details_clean` v, params p
  WHERE CAST(v.VisitDateTime AS DATETIME) >= DATETIME(p.window_start)
    AND CAST(v.VisitDateTime AS DATETIME) <  DATETIME(p.window_end)
),
per_engineer AS (
  SELECT
    e.Row_Num,
    TRIM(e.Engineer) AS Engineer,
    COUNTIF(v.eng_key IS NOT NULL
            AND IFNULL(v.Visit_Status, '') NOT IN ('New', 'Cancelled', 'Not Sent', 'Rejected')) AS No_Visits,
    COUNTIF(v.is_completing AND v.Visit_Status = 'Complete') AS No_Completed_Jobs,
    NULLIF(TRIM(e.Recipient), '') AS Recipient_Override
  FROM `importdata-494110.JobLogic.Engineer_List` e
  LEFT JOIN visits v
    ON v.eng_key = LOWER(TRIM(e.Engineer))
  WHERE NULLIF(TRIM(e.Engineer), '') IS NOT NULL
  GROUP BY e.Row_Num, Engineer, Recipient_Override
),
ranked AS (
  SELECT
    *,
    SUM(No_Completed_Jobs) OVER () AS Total_Jobs_Completed,
    -- LARGE(C:C,3): third highest value, duplicates counted
    NTH_VALUE(No_Completed_Jobs, 3) OVER (
      ORDER BY No_Completed_Jobs DESC
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS Top3Jobs
  FROM per_engineer
)
SELECT
  r.Row_Num,
  r.Engineer,
  r.No_Visits,
  r.No_Completed_Jobs,
  SAFE_DIVIDE(r.No_Completed_Jobs, r.No_Visits) AS Pct_Completed,
  -- Old formula: first space becomes ".", apostrophes, hyphens and other spaces removed
  COALESCE(
    r.Recipient_Override,
    REGEXP_REPLACE(
      REGEXP_REPLACE(REGEXP_REPLACE(r.Engineer, r'^(\S+) ', r'\1.'), r"['-]", ''),
      ' ', ''
    ) || '@up-fm.com'
  ) AS Recipient,
  r.Total_Jobs_Completed,
  IFNULL(r.Top3Jobs, 0) AS Top3Jobs,
  -- Old formula sent this to everyone when nobody completed anything;
  -- the "> 0" stops a week of zeros congratulating the whole team.
  IF(r.No_Completed_Jobs >= IFNULL(r.Top3Jobs, 0) AND r.No_Completed_Jobs > 0,
     'Congratulations on being in the top 3 most effective engineers this week!',
     '') AS Context,
  p.wc AS WC
FROM ranked r, params p;


-- ---------------------------------------------------------------------
-- 2. Closed on SF
-- WeWork reactive jobs still OPEN in Joblogic whose Salesforce ticket is
-- Closed / Solved / Closed Duplicate, excluding jobs tagged
-- "Solved on SF". (The old formula also stopped at row 30044; this
-- view covers the whole table.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `importdata-494110.JobLogic.vw_Out_Closed_on_SF` AS
SELECT
  j.ID, j.Site, j.Area, j.Post_Code, j.Telephone, j.Contact, j.Description,
  j.Customer, j.Order_Number, j.Job_Status, j.Date_Logged,
  j.Estimated_Appointment, j.DateComplete, j.Job_Type, j.Job_Category,
  j.Open_Closed_Job, j.Is_Open, j.Custom_Reference, j.Reported_Fault_Code,
  j.Reported_Sub_Fault_Code, j.Actual_Fault_Code, j.Actual_Sub_Fault_Code,
  j.TotalJobCost, j.TotalJobSell, j.TotalQuoteCost, j.TotalQuoteSell,
  j.PurchaseOrderAdjustment, j.Priority, j.Visit_Notes, j.Job_Tags,
  j.Service_Job,
  s.SF_Status
FROM `importdata-494110.JobLogic.All_in_Job_clean` j
JOIN `importdata-494110.JobLogic.vw_SF_Status` s
  ON s.SF_Ref = `importdata-494110.JobLogic.norm_ref`(j.Order_Number)
WHERE j.Customer = 'WeWork Ltd'
  AND IFNULL(j.Job_Tags, '') != 'Solved on SF'
  AND j.Job_Type = 'Reactive'
  AND j.Open_Closed_Job = 'OPEN'
  AND s.SF_Status IN ('Closed', 'Solved', 'Closed Duplicate');


-- ---------------------------------------------------------------------
-- 3. Shared base for the two "Missing Closed Dates" tabs
-- Visit-level rows for jobs that are Completed / Costed / Invoiced but
-- have no Date_Complete, plus:
--   Actually_Completed_Date: latest end time of a Complete visit, or the
--     latest visit end time if the job has no Complete visit
--   SF_Status: Salesforce status, matched via Job_Reference (or
--     Order_Number) from Pending Costs when it looks like a SF number
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `importdata-494110.JobLogic.vw_Missing_Closed_Dates_Base` AS
WITH jobs AS (
  SELECT *
  FROM `importdata-494110.JobLogic.Job_and_Visit_Details_clean`
  WHERE Date_Complete IS NULL
    AND Job_Status IN ('Completed', 'Costed', 'Invoiced')
),
completed AS (
  SELECT
    ID,
    CASE
      WHEN COUNTIF(Visit_Status = 'Complete') > 0
        THEN MAX(IF(Visit_Status = 'Complete', CAST(VisitEndDateTime AS DATETIME), NULL))
      ELSE MAX(CAST(VisitEndDateTime AS DATETIME))
    END AS Actually_Completed_Date
  FROM jobs
  GROUP BY ID
),
pc AS (
  SELECT
    Job_Number,
    `importdata-494110.JobLogic.norm_ref`(Job_Reference) AS job_ref,
    `importdata-494110.JobLogic.norm_ref`(Order_Number)  AS order_ref
  FROM `importdata-494110.JobLogic.Pending_Costs_clean`
  WHERE Job_Number IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY Job_Number) = 1
),
sf_ref AS (
  SELECT
    Job_Number,
    CASE
      WHEN REGEXP_CONTAINS(IFNULL(job_ref, ''),   r'^1\d{7}$') THEN job_ref
      WHEN REGEXP_CONTAINS(IFNULL(order_ref, ''), r'^1\d{7}$') THEN order_ref
    END AS ref
  FROM pc
)
SELECT
  j.Customer, j.Site, j.Area, j.ID, j.Job_Description, j.Job_Status,
  j.Order_Number, j.Task_Type_ID, j.Task_Type, j.Date_Logged,
  j.Target_Completion_Date, j.Date_Complete, j.Engineer, j.Engineer_Active,
  j.VisitDateTime, j.VisitEndDateTime, j.Visit_Status, j.Revisit_Reason,
  j.Site_id,
  c.Actually_Completed_Date,
  IFNULL(s.SF_Status, '') AS SF_Status
FROM jobs j
LEFT JOIN completed c ON c.ID = j.ID
LEFT JOIN sf_ref r    ON r.Job_Number = j.ID
LEFT JOIN `importdata-494110.JobLogic.vw_SF_Status` s ON s.SF_Ref = r.ref;


-- 3a. Jobs Missing Closed Dates (reactive: IDs starting "R")
CREATE OR REPLACE VIEW `importdata-494110.JobLogic.vw_Out_Jobs_Missing_Closed_Dates` AS
SELECT *
FROM `importdata-494110.JobLogic.vw_Missing_Closed_Dates_Base`
WHERE STARTS_WITH(ID, 'R');

-- 3b. Project Jobs Missing Closed Dates (IDs starting "PROJ")
CREATE OR REPLACE VIEW `importdata-494110.JobLogic.vw_Out_Project_Jobs_Missing_Closed_Dates` AS
SELECT *
FROM `importdata-494110.JobLogic.vw_Missing_Closed_Dates_Base`
WHERE STARTS_WITH(ID, 'PROJ');


-- ---------------------------------------------------------------------
-- 4. Missing Categories
-- Pending Costs rows with a job number but no Job_Category.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `importdata-494110.JobLogic.vw_Out_Missing_Categories` AS
SELECT
  Job_Number, Job_Description, DateLogged, Logged_By, TargetAttendanceDate,
  AppointmentDate, Target_CompletionDate, CompletedDate, Job_Type, Job_Category
FROM `importdata-494110.JobLogic.Pending_Costs_clean`
WHERE NULLIF(TRIM(Job_Number), '') IS NOT NULL
  AND NULLIF(TRIM(Job_Category), '') IS NULL;


-- ---------------------------------------------------------------------
-- 5. Proj Jobs with Child Quote
-- Open project jobs (not Completed / Costed / Cancelled / Invoiced) that
-- have a child quote.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `importdata-494110.JobLogic.vw_Out_Proj_Jobs_with_Child_Quote` AS
SELECT
  Job_Number, Job_Description, DateLogged, Logged_By, TargetAttendanceDate,
  AppointmentDate, Target_CompletionDate, CompletedDate, Job_Type,
  Job_Category, Job_Trade, Job_Reference, Status, Priority, Order_Number,
  Contact, Telephone, Email_Address, Customer_ID, Customer, AccountNumber,
  Reported_Fault_Code, Reported_Sub_Fault_Code, Actual_Fault_Code,
  Actual_Sub_Fault_Code, Custom_Reference
FROM `importdata-494110.JobLogic.Pending_Costs_clean`
WHERE Job_Type = 'Project'
  AND NULLIF(TRIM(Child_Quote), '') IS NOT NULL
  AND IFNULL(Status, '') NOT IN ('Completed', 'Costed', 'Cancelled', 'Invoiced');


-- ---------------------------------------------------------------------
-- 6. H&S Issues
-- Electrical jobs logged since Monday of last week where the description
-- says "Is this a H&S issue: Yes" (case-insensitive, like SEARCH()).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `importdata-494110.JobLogic.vw_Out_HS_Issues` AS
SELECT
  ID, Site, Area, Post_Code, Telephone, Contact, Description, Customer,
  Order_Number, Job_Status, Date_Logged, Estimated_Appointment, DateComplete,
  Job_Type, Job_Category, Open_Closed_Job, Is_Open, Custom_Reference,
  Reported_Fault_Code, Reported_Sub_Fault_Code, Actual_Fault_Code,
  Actual_Sub_Fault_Code, TotalJobCost, TotalJobSell, TotalQuoteCost,
  TotalQuoteSell, PurchaseOrderAdjustment, Priority, Visit_Notes, Job_Tags,
  Service_Job
FROM `importdata-494110.JobLogic.All_in_Job_clean`
WHERE STRPOS(LOWER(IFNULL(Description, '')), 'is this a h&s issue: yes') > 0
  AND CAST(Date_Logged AS DATE) >=
      DATE_SUB(DATE_TRUNC(CURRENT_DATE('Europe/London'), WEEK(MONDAY)), INTERVAL 7 DAY)
  AND Job_Category = 'Electrical';


-- ---------------------------------------------------------------------
-- 7. Near Misses
-- Near Miss forms submitted in the last 7 days.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `importdata-494110.JobLogic.vw_Out_Near_Misses` AS
SELECT
  Form_Name, FormDate, Job_Number, Customer, Site, Engineer, Asset, Form_Hyperlink
FROM `importdata-494110.JobLogic.Forms_Logbook_clean`
WHERE REGEXP_CONTAINS(IFNULL(Form_Name, ''), r'Near Miss*')  -- same regex as the old REGEXMATCH
  AND CAST(FormDate AS DATETIME) >
      DATETIME(DATE_SUB(CURRENT_DATE('Europe/London'), INTERVAL 7 DAY));
