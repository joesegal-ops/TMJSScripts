-- reporting.projects — Monday project items married to their JobLogic jobs and quotes.
--
-- Grain: ONE ROW PER MONDAY ITEM across the three project boards (WW Active, WW TRIAGE,
-- Other Clients), with a `Board` column. This is the projects counterpart to reporting.jobs.
--
-- Depends on: models.monday_* (create_monday_views.sql), reporting.jobs, models.quote_tracking,
-- raw.quotes. Rebuild with:
--   bq --project_id=vmimporteddata query --use_legacy_sql=false < create_reporting_projects.sql
--
-- QUOTE LINKING uses BOTH directions and keeps the disagreement visible:
--   (a) JL-authoritative — raw.quotes.ParentJobStringId = the item's job ref.
--   (b) Monday-typed     — UP-numbers parsed out of the item's Quote cell.
-- The two rarely disagree, but when they do that IS the finding: Quotes_Missing_From_Monday
-- (JL raised a quote nobody logged on the board) and Quotes_Only_On_Monday (typo, or a quote
-- raised outside the normal flow). Both boards' cells are free text, so parsing is
-- zero-padding-tolerant — same rule as sync_monday.py's canon().

CREATE OR REPLACE VIEW `vmimporteddata.reporting.projects` AS
WITH item_base AS (
  -- Minor Projects - WW Active: the main board, and the only one with the upgraded-job ref.
  SELECT
    "WW Active" AS Board, item_id AS Item_Id, Project, Stage, Item_State, Site,
    NULLIF(TRIM(Original_Job_Ref), "") AS Job_Ref,
    NULLIF(TRIM(Upgraded_Job_Ref), "") AS Upgraded_Job_Ref,
    Quote AS Quote_Cell,
    NULLIF(TRIM(Client_Ref), "") AS Client_Ref, NULLIF(TRIM(PO_Number), "") AS PO_Number,
    Project_Type, Client, Priority, PM_Stat, Finance_Stat, Lead_PM, Support_PM, Contractor_Tech,
    Project_Request_Date AS Request_Date, Quoted_Date, Approved_Date, Complete_Date, Due_Date,
    Works_Start, Works_End, Cost_Est_exVAT, Price_Est_exVAT,
    created_at, updated_at, item_url, _ingested_at
  FROM `vmimporteddata.models.monday_ww_active`

  UNION ALL
  -- Minor Projects - Other Clients: same lifecycle, but the job ref column is new so it is
  -- mostly blank (48/502) — here the Quote cell (461/502) is the real link to JL.
  SELECT
    "Other Clients", item_id, Project, Stage, Item_State, Site,
    NULLIF(TRIM(Job_Ref), ""), CAST(NULL AS STRING), Quote_Ref,
    NULLIF(TRIM(Client_Ref), ""), CAST(NULL AS STRING),
    Project_Type, Client, Priority, PM_Stat, Finance_Stat, Lead, Support, Tech_Contractor,
    Project_Inception, Quoted_Date, Approved_Date, Complete_Date, Due_Date,
    Works_Start, Works_End, Cost_Est_exVAT, Price_Est_exVAT,
    created_at, updated_at, item_url, _ingested_at
  FROM `vmimporteddata.models.monday_other_clients`

  UNION ALL
  -- Minor Projects - WW TRIAGE: pre-quote intake. No Quoted/Approved/Complete dates and no
  -- money columns on this board, so those come through NULL by design.
  SELECT
    "WW TRIAGE", item_id, Project, Stage, Item_State, Site,
    NULLIF(TRIM(Job_Ref), ""), CAST(NULL AS STRING), Quote,
    NULLIF(TRIM(Client_Ref), ""), NULLIF(TRIM(PO_Number), ""),
    Project_Type, CAST(NULL AS STRING), Priority, PM_Stat, CAST(NULL AS STRING),
    Lead_PM, Support_PM, CAST(NULL AS STRING),
    Project_Inception, CAST(NULL AS DATE), CAST(NULL AS DATE), CAST(NULL AS DATE), Req_Due_Date,
    CAST(NULL AS DATE), CAST(NULL AS DATE), CAST(NULL AS NUMERIC), CAST(NULL AS NUMERIC),
    created_at, updated_at, item_url, _ingested_at
  FROM `vmimporteddata.models.monday_ww_triage`
),

-- (b) every UP-number typed into the item's Quote cell, zero-padding normalised
monday_q AS (
  SELECT b.Item_Id, REGEXP_REPLACE(q, r"^UP0+", "UP") AS q_canon
  FROM item_base b,
       UNNEST(REGEXP_EXTRACT_ALL(UPPER(REGEXP_REPLACE(IFNULL(b.Quote_Cell, ""), r"\s+", "")),
                                 r"UP\d+")) AS q
),
-- (a) every quote JobLogic says hangs off this item's job
jl_q AS (
  SELECT b.Item_Id, REGEXP_REPLACE(UPPER(TRIM(qq.QuoteNumber)), r"^UP0+", "UP") AS q_canon
  FROM item_base b
  JOIN `vmimporteddata.raw.quotes` qq
    ON UPPER(TRIM(qq.ParentJobStringId)) = UPPER(b.Job_Ref)
  WHERE b.Job_Ref IS NOT NULL AND qq.QuoteNumber IS NOT NULL AND TRIM(qq.QuoteNumber) != ""
),
all_q AS (
  SELECT Item_Id, q_canon,
         LOGICAL_OR(src = "monday") AS on_monday,
         LOGICAL_OR(src = "jl")     AS on_jl
  FROM (
    SELECT Item_Id, q_canon, "monday" AS src FROM monday_q
    UNION ALL
    SELECT Item_Id, q_canon, "jl"     AS src FROM jl_q
  )
  GROUP BY Item_Id, q_canon
),
q_enriched AS (
  SELECT a.Item_Id, a.q_canon, a.on_monday, a.on_jl,
         t.quote_number, t.status, t.value_excl_vat, t.date_logged,
         t.approved_datetime, t.date_rejected, t.job_type, t.job_category, t.is_upgraded
  FROM all_q a
  LEFT JOIN `vmimporteddata.models.quote_tracking` t
    ON REGEXP_REPLACE(UPPER(TRIM(t.quote_number)), r"^UP0+", "UP") = a.q_canon
),
q_agg AS (
  SELECT
    Item_Id,
    COUNT(*)                                                          AS Quote_Count,
    STRING_AGG(IFNULL(quote_number, q_canon), ", " ORDER BY q_canon)  AS Quote_Numbers,
    SUM(value_excl_vat)                                               AS Quote_Value_exVAT,
    MIN(date_logged)                                                  AS First_Quote_Date,
    MAX(date_logged)                                                  AS Last_Quote_Date,
    MIN(approved_datetime)                                            AS First_Quote_Approved_At,
    MIN(date_rejected)                                                AS First_Quote_Rejected_Date,
    COUNTIF(is_upgraded)                                              AS Upgraded_Quote_Count,
    STRING_AGG(DISTINCT status, ", " ORDER BY status)                 AS Quote_Statuses,
    STRING_AGG(DISTINCT job_type, ", " ORDER BY job_type)             AS Quote_Job_Types,
    STRING_AGG(DISTINCT job_category, ", " ORDER BY job_category)     AS Quote_Job_Categories,
    -- Restricted to path-(a) quotes: the ones JobLogic itself hangs off this job. Durations
    -- MUST use these. A quote reached only via the Monday cell (path b) usually belongs to a
    -- DIFFERENT job -- see Job_Ref_Is_Child_Job below -- and would produce negative elapsed time.
    COUNTIF(on_jl)                                                    AS Linked_Quote_Count,
    MIN(IF(on_jl, date_logged, NULL))                                 AS First_Linked_Quote_Date,
    MIN(IF(on_jl, approved_datetime, NULL))                           AS First_Linked_Quote_Approved_At,
    COUNTIF(on_jl AND NOT on_monday)                                  AS Quotes_Missing_From_Monday,
    COUNTIF(on_monday AND NOT on_jl)                                  AS Quotes_Only_On_Monday,
    COUNTIF(quote_number IS NULL)                                     AS Quotes_Not_Found_In_JL
  FROM q_enriched
  GROUP BY Item_Id
)
,
-- raw.jobs.HasParent flags a job created FROM a quote (an upgraded job). When the board's
-- "Original Job Ref" holds one of those, the cell is mislabelled: 618 of 620 negative
-- job->quote durations were this. Deduped because we only need the flag.
job_parent AS (
  SELECT JobNumber, LOGICAL_OR(IFNULL(HasParent, FALSE)) AS HasParent
  FROM `vmimporteddata.raw.jobs`
  WHERE JobNumber IS NOT NULL
  GROUP BY JobNumber
)

SELECT
  -- ---------- the Monday item ----------
  b.Board, b.Item_Id, b.Project, b.Stage, b.Item_State,
  b.Site, b.Project_Type, b.Client, b.Priority,
  b.PM_Stat, b.Finance_Stat, b.Lead_PM, b.Support_PM, b.Contractor_Tech,
  b.Client_Ref, b.PO_Number,
  b.Cost_Est_exVAT, b.Price_Est_exVAT,
  b.Price_Est_exVAT - b.Cost_Est_exVAT                            AS Margin_Est_exVAT,
  SAFE_DIVIDE(b.Price_Est_exVAT - b.Cost_Est_exVAT, b.Price_Est_exVAT) AS Margin_Est_Pct,

  -- ---------- Monday's own lifecycle dates (PM-entered) ----------
  b.Request_Date, b.Quoted_Date, b.Approved_Date, b.Complete_Date, b.Due_Date,
  b.Works_Start, b.Works_End,

  -- ---------- durations from Monday's dates ----------
  -- The headline "how long did it take us to quote". Populated for ~75% of WW Active.
  DATE_DIFF(b.Quoted_Date,   b.Request_Date, DAY)                 AS Days_Request_To_Quoted,
  DATE_DIFF(b.Approved_Date, b.Quoted_Date,  DAY)                 AS Days_Quoted_To_Approved,
  DATE_DIFF(b.Complete_Date, b.Approved_Date, DAY)                AS Days_Approved_To_Complete,
  DATE_DIFF(b.Complete_Date, b.Request_Date, DAY)                 AS Days_Request_To_Complete,
  -- Still open: how long it has been sitting unquoted / unapproved as of today.
  IF(b.Quoted_Date   IS NULL, DATE_DIFF(CURRENT_DATE(), b.Request_Date, DAY), NULL)
                                                                  AS Days_Awaiting_Quote,
  IF(b.Quoted_Date IS NOT NULL AND b.Approved_Date IS NULL,
     DATE_DIFF(CURRENT_DATE(), b.Quoted_Date, DAY), NULL)         AS Days_Awaiting_Approval,
  b.Due_Date < CURRENT_DATE() AND b.Complete_Date IS NULL         AS Is_Overdue,

  -- ---------- the JobLogic original job ----------
  b.Job_Ref                                                       AS Job_Ref,
  j.Job_Number                                                    AS JL_Job_Number,
  j.Job_URL                                                       AS JL_Job_URL,
  j.Job_Status                                                    AS JL_Job_Status,
  j.Job_Type                                                      AS JL_Job_Type,
  j.Job_Category                                                  AS JL_Job_Category,
  j.Customer                                                      AS JL_Customer,
  j.Site                                                          AS JL_Site,
  j.Date_Logged                                                   AS JL_Job_Logged_At,
  j.Open_Closed                                                   AS JL_Job_Open_Closed,
  b.Job_Ref IS NOT NULL AND j.Job_Number IS NULL                  AS Job_Ref_Not_Found_In_JL,

  -- ---------- the JobLogic upgraded job (WW Active only) ----------
  b.Upgraded_Job_Ref,
  u.Job_Number                                                    AS JL_Upgraded_Job_Number,
  u.Job_URL                                                       AS JL_Upgraded_Job_URL,
  u.Job_Status                                                    AS JL_Upgraded_Job_Status,
  u.Open_Closed                                                   AS JL_Upgraded_Job_Open_Closed,
  u.Date_Logged                                                   AS JL_Upgraded_Job_Logged_At,
  u.Date_Complete                                                 AS JL_Upgraded_Job_Completed_At,

  -- ---------- quotes (union of the JL link and the Monday cell) ----------
  b.Quote_Cell                                                    AS Monday_Quote_Cell,
  q.Quote_Numbers, q.Quote_Count, q.Quote_Value_exVAT, q.Quote_Statuses,
  q.Quote_Job_Types, q.Quote_Job_Categories, q.Upgraded_Quote_Count,
  q.First_Quote_Date, q.Last_Quote_Date,
  q.First_Quote_Approved_At, q.First_Quote_Rejected_Date,

  -- ---------- durations from JobLogic's own timestamps (system-generated) ----------
  -- Independent of PM data entry, so use these to sanity-check Days_Request_To_Quoted.
  q.Linked_Quote_Count, q.First_Linked_Quote_Date,
  DATE_DIFF(q.First_Linked_Quote_Date, DATE(j.Date_Logged), DAY)  AS JL_Days_Job_To_First_Quote,
  DATE_DIFF(DATE(q.First_Linked_Quote_Approved_At), q.First_Linked_Quote_Date, DAY)
                                                                  AS JL_Days_Quote_To_Approved,
  DATE_DIFF(b.Quoted_Date, q.First_Linked_Quote_Date, DAY)        AS Quoted_Date_Vs_JL_Quote_Days,
  -- TRUE => the job ref on the board is an upgraded job, not the original. The board cell is
  -- mislabelled; JL_Days_Job_To_First_Quote is meaningless for these and comes through NULL.
  IFNULL(p.HasParent, FALSE)                                      AS Job_Ref_Is_Child_Job,

  -- ---------- reconciliation ----------
  -- NULL (not 0) when the item has no resolvable JL job: with nothing to compare against,
  -- "only on Monday" would just be counting every quote on every unlinked item (494 of them).
  IF(j.Job_Number IS NOT NULL, IFNULL(q.Quotes_Missing_From_Monday, 0), NULL)
                                                                  AS Quotes_Missing_From_Monday,
  IF(j.Job_Number IS NOT NULL, IFNULL(q.Quotes_Only_On_Monday, 0), NULL)
                                                                  AS Quotes_Only_On_Monday,
  IFNULL(q.Quotes_Not_Found_In_JL, 0)                             AS Quotes_Not_Found_In_JL,

  -- ---------- stage timing, from the Monday activity log ----------
  -- models.monday_stage_summary; NULL until raw.monday_activity has covered the item's life.
  sh.Current_Stage_Entered_At,
  sh.Days_In_Current_Stage,
  sh.Stage_Changes,
  sh.Days_To_First_Move,
  sh.History_Is_Complete                                          AS Stage_History_Complete,

  -- ---------- provenance ----------
  b.created_at                                                    AS Item_Created_At,
  b.updated_at                                                    AS Item_Updated_At,
  b.item_url                                                      AS Item_URL,
  b._ingested_at
FROM item_base b
LEFT JOIN `vmimporteddata.reporting.jobs` j ON j.Job_Number = b.Job_Ref
LEFT JOIN `vmimporteddata.reporting.jobs` u ON u.Job_Number = b.Upgraded_Job_Ref
LEFT JOIN q_agg q ON q.Item_Id = b.Item_Id
LEFT JOIN job_parent p ON p.JobNumber = b.Job_Ref
LEFT JOIN `vmimporteddata.models.monday_stage_summary` sh ON sh.Item_Id = b.Item_Id;
