-- reporting.internal_metrics — internal KPI pack, by MONTH and by ISO WEEK (Mon-Sun). (2026-10-12)
-- Rebuild:
--   bq --project_id=vmimporteddata query --use_legacy_sql=false < create_internal_metrics.sql
--
-- Grain: ONE ROW PER Period_Type x Period_Start x Segment. Filter on Period_Type ("Month"/"Week") in Looker.
-- Periods start Aug 2025: JobLogic data begins then (a few stray PPM/quote rows predate it), so earlier
-- periods were all zeros. Backlog builds up from there: no ticket can be 60+ days old before Oct 2025.
-- Segments are two INDEPENDENT cuts of the same data, so never sum across Segment_Type:
--   Customer: Neko UK | Neko Sweden | WeWork | All Other Customers   (customer "Test" excluded everywhere)
--   Area:     East (East London) | West (West London) | ROUK (Rest of UK) | 10 York Road
--             (Area "10 York Road" is the single site "10 York Road LON20".) Area is set on WeWork sites only,
--             so the four areas add up to WeWork, not to the whole business. Quotes/invoices carry no area of
--             their own: it comes from the site (every site maps to exactly one area in raw.jobs).
-- Neko Sweden = the separate SE tenant (sweden_* datasets) + any "Neko Health AB" record on the UK tenant.
-- Its money is SEK (see Currency); the SE tenant has no invoices/costs loaded, so those columns are NULL there.
--
-- PPM COMPLIANCE (jobs numbered PM..., i.e. generated from a PPM contract; Cancelled excluded)
--   Due date  = the job's DateLogged (JL creates each PPM job on its scheduled date; AppointmentDate agrees).
--   Due       = PPMs falling due in the period, up to today for the current period.
--   On_Time   = of those, completed (DateComplete) by the END OF THE PERIOD they fell due in. So weekly
--               compliance is stricter than monthly: a PPM due Mon 3rd done Tue 11th is late for the week
--               but on time for the month. Completed-status jobs with no DateComplete fall back to UpdatedAt.
--   Category  = Statutory_Category from models.job_statutory_category_v2 (job tag, contract tag "StatutoryPPM",
--               or description), sweden_models.job_statutory_category for SE (job tags only).
--   *_Compliance_Pct = On_Time / Due (0-1; format as % in Looker). NULL when nothing was due.
--
-- MONEY (ex VAT, attributed to the period of the event's own date)
--   Quoted_Value        quotes raised in the period (DateLogged), cancelled quotes excluded.
--   Invoiced_From_Quotes invoices (DateRaised) on jobs that came from a quote: the upgraded job in
--                       reporting.quote_to_job_completion, or any job with HasParent = TRUE.
--   Invoiced_Other      every other invoice (reactive, PPM, ...). Invoiced_From_Quotes + Invoiced_Other = all invoices.
--   Other_Costs         job cost lines (models.cost_line_items, by date_incurred) on jobs that did NOT come from
--                       a quote. Quote-job costs are left out so they are not double-counted with the quote
--                       (see TRAP in project_margin). ~2% of cost lines have no date_incurred and are dropped.
--
-- FIRST TIME FIX (by completion date): tickets (same scope as BACKLOG below) completed in the period with at
-- least one completed visit; Fixed = done in exactly ONE completed visit. Jobs closed with no completed visit
-- (remote fixes, admin closures, ~6%) are left out of both. First_Time_Fix_Pct = Fixed / Jobs (0-1).
--
-- BACKLOG (snapshot, NOT a flow): open "tickets" at the period's As_Of date (period end, or today for the current
-- period) older than 30 / 60 / 100 days since logged. Tickets = every job except PPM (PM...) and Project jobs.
-- Open at As_Of = logged on/before As_Of and not closed by then. Closed = status Completed/Invoiced/Costed/
-- Cancelled, dated by DateComplete (fallback UpdatedAt — the API has no cancel date, so a cancelled job's
-- history is approximate). A job that was closed then reopened counts as open for its whole life.
-- The buckets are cumulative: Backlog_30_Plus includes the 60+ and 100+ jobs.

CREATE OR REPLACE VIEW `vmimporteddata.reporting.internal_metrics` AS
WITH periods AS (
  SELECT "Month" AS Period_Type, m AS Period_Start, LAST_DAY(m, MONTH) AS Period_End
  FROM UNNEST(GENERATE_DATE_ARRAY(DATE "2025-08-01", CURRENT_DATE("Europe/London"), INTERVAL 1 MONTH)) m
  UNION ALL
  SELECT "Week", w, DATE_ADD(w, INTERVAL 6 DAY)
  FROM UNNEST(GENERATE_DATE_ARRAY(DATE_TRUNC(DATE "2025-08-01", ISOWEEK),
                                  CURRENT_DATE("Europe/London"), INTERVAL 1 WEEK)) w
),
p AS (
  SELECT *, LEAST(Period_End, CURRENT_DATE("Europe/London")) AS As_Of FROM periods
),
segments AS (
  SELECT * FROM UNNEST([
    STRUCT(1 AS Segment_Order, "Customer" AS Segment_Type, "Neko UK" AS Segment),
    (2, "Customer", "Neko Sweden"), (3, "Customer", "WeWork"), (4, "Customer", "All Other Customers"),
    (5, "Area", "East"), (6, "Area", "West"), (7, "Area", "ROUK"), (8, "Area", "10 York Road")])
),
site_area AS (
  SELECT SiteId, ANY_VALUE(Area) AS Area
  FROM `vmimporteddata.raw.jobs`
  WHERE Area IS NOT NULL
  GROUP BY SiteId
),
-- Both tenants, one shape. The source views already output local DATETIMEs, so DATE() needs no zone.
jobs AS (
  SELECT "UK" AS tenant, j.Id AS job_id, j.JobNumber, j.CustomerName, j.TypeDescription, j.HasParent,
         j.JobStatusDescription AS status, j.Statutory_Category, COALESCE(j.Area, sa.Area) AS Area,
         DATE(j.DateLogged) AS logged_date, j.DateComplete, j.UpdatedAt,
         (SELECT COUNTIF(v.StatusDescription = "Complete") FROM UNNEST(j.VisitsStatus) v) AS complete_visits
  FROM `vmimporteddata.models.job_statutory_category_v2` j
  LEFT JOIN site_area sa ON sa.SiteId = j.SiteId
  UNION ALL
  SELECT "SE", j.Id, j.JobNumber, j.CustomerName, j.TypeDescription, j.HasParent,
         j.JobStatusDescription, j.Statutory_Category, CAST(NULL AS STRING),
         DATE(j.DateLogged), j.DateComplete, j.UpdatedAt,
         (SELECT COUNTIF(v.StatusDescription = "Complete") FROM UNNEST(j.VisitsStatus) v)
  FROM `vmimporteddata.sweden_models.job_statutory_category` j
),
quote_jobs AS (  -- UK jobs that came from a quote
  SELECT upgraded_job_number AS JobNumber FROM `vmimporteddata.reporting.quote_to_job_completion`
  UNION DISTINCT
  SELECT JobNumber FROM `vmimporteddata.raw.jobs` WHERE HasParent
),
facts AS (
  -- PPM compliance: one row per PPM job, dated by due date
  SELECT tenant, CustomerName, Area, "ppm" AS kind, logged_date AS fact_date, Statutory_Category AS category,
         DATE(COALESCE(DateComplete,
                       IF(status IN ("Completed", "Invoiced", "Costed"), UpdatedAt, NULL))) AS done_date,
         CAST(NULL AS DATE) AS closed_date, CAST(NULL AS FLOAT64) AS amount
  FROM jobs
  WHERE STARTS_WITH(JobNumber, "PM") AND status != "Cancelled"

  UNION ALL  -- backlog tickets: one row per non-PPM, non-Project job, dated by logged date
  SELECT tenant, CustomerName, Area, "ticket", logged_date, NULL, NULL,
         IF(status IN ("Completed", "Invoiced", "Costed", "Cancelled"),
            DATE(COALESCE(DateComplete, UpdatedAt)), NULL), NULL
  FROM jobs
  WHERE NOT STARTS_WITH(JobNumber, "PM") AND IFNULL(TypeDescription, "") != "Project"

  UNION ALL  -- first time fix: completed tickets with >= 1 completed visit, dated by completion; amount = 1 if fixed in one
  SELECT tenant, CustomerName, Area, "ftf", DATE(COALESCE(DateComplete, UpdatedAt)), NULL, NULL, NULL,
         IF(complete_visits = 1, 1, 0)
  FROM jobs
  WHERE NOT STARTS_WITH(JobNumber, "PM") AND IFNULL(TypeDescription, "") != "Project"
    AND status IN ("Completed", "Invoiced", "Costed") AND complete_visits >= 1

  UNION ALL  -- quotes raised (UK)
  SELECT "UK", q.CustomerName, sa.Area, "quote", DATE(q.DateLogged, "Europe/London"), NULL, NULL, NULL,
         q.QuoteValueExcludingVat
  FROM (SELECT * FROM `vmimporteddata.raw.quotes`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1) q
  LEFT JOIN site_area sa ON sa.SiteId = q.SiteId
  WHERE NOT IFNULL(q.IsCancelled, FALSE)

  UNION ALL  -- quotes raised (SE, SEK)
  SELECT "SE", q.CustomerName, NULL, "quote", DATE(q.DateLogged, "Europe/Stockholm"), NULL, NULL, NULL,
         q.QuoteValueExcludingVat
  FROM (SELECT * FROM `vmimporteddata.sweden_raw.quotes`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1) q
  WHERE NOT IFNULL(q.IsCancelled, FALSE)

  UNION ALL  -- invoices (UK only — no SE invoice table), split by whether the job came from a quote
  SELECT "UK", i.CustomerName, COALESCE(j.Area, sa.Area),
         IF(qj.JobNumber IS NOT NULL, "inv_quote", "inv_other"),
         DATE(i.DateRaised, "Europe/London"), NULL, NULL, NULL, i.TotalExcludingVat
  FROM (SELECT * FROM `vmimporteddata.raw.invoices`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1) i
  LEFT JOIN jobs j ON j.tenant = "UK" AND j.job_id = i.JobId
  LEFT JOIN site_area sa ON sa.SiteId = i.SiteId
  LEFT JOIN quote_jobs qj ON qj.JobNumber = i.JobNumber
  WHERE NOT IFNULL(i.IsDraft, FALSE)

  UNION ALL  -- other costs: cost lines on jobs that did not come from a quote (UK only)
  SELECT "UK", j.CustomerName, j.Area, "cost_other", DATE(c.date_incurred), NULL, NULL, NULL, c.cost_excl_vat
  FROM `vmimporteddata.models.cost_line_items` c
  JOIN jobs j ON j.tenant = "UK" AND j.job_id = c.job_id
  WHERE c.date_incurred IS NOT NULL
    AND c.job_number NOT IN (SELECT JobNumber FROM quote_jobs WHERE JobNumber IS NOT NULL)
),
seg_facts AS (
  SELECT f.*, s.Segment_Type, s.Segment
  FROM facts f
  CROSS JOIN UNNEST([
    STRUCT("Customer" AS Segment_Type,
           CASE WHEN f.tenant = "SE" OR STARTS_WITH(f.CustomerName, "Neko Health AB") THEN "Neko Sweden"
                WHEN f.CustomerName = "Neko Health UK Limited" THEN "Neko UK"
                WHEN f.CustomerName = "WeWork Ltd"             THEN "WeWork"
                ELSE "All Other Customers" END AS Segment),
    STRUCT("Area",
           CASE f.Area WHEN "East London"  THEN "East"
                       WHEN "West London"  THEN "West"
                       WHEN "Rest of UK"   THEN "ROUK"
                       WHEN "10 York Road" THEN "10 York Road" END)
  ]) s
  WHERE s.Segment IS NOT NULL
    AND IFNULL(f.CustomerName, "") != "Test"
),
flow AS (
  SELECT p.Period_Type, p.Period_Start, f.Segment_Type, f.Segment,
    COUNTIF(f.kind = "ppm" AND f.category = "Statutory")                                AS Statutory_PPM_Due,
    COUNTIF(f.kind = "ppm" AND f.category = "Statutory" AND f.done_date <= p.Period_End) AS Statutory_PPM_On_Time,
    COUNTIF(f.kind = "ppm" AND f.category = "Critical")                                 AS Critical_PPM_Due,
    COUNTIF(f.kind = "ppm" AND f.category = "Critical" AND f.done_date <= p.Period_End)  AS Critical_PPM_On_Time,
    COUNTIF(f.kind = "ppm" AND f.category = "Non-Statutory")                                AS Non_Statutory_PPM_Due,
    COUNTIF(f.kind = "ppm" AND f.category = "Non-Statutory" AND f.done_date <= p.Period_End) AS Non_Statutory_PPM_On_Time,
    COUNTIF(f.kind = "ftf")                         AS First_Time_Fix_Jobs,
    SUM(IF(f.kind = "ftf", f.amount, NULL))         AS First_Time_Fix_Fixed,
    COUNTIF(f.kind = "quote")                       AS Quotes_Raised,
    SUM(IF(f.kind = "quote",      f.amount, NULL))  AS Quoted_Value,
    SUM(IF(f.kind = "inv_quote",  f.amount, NULL))  AS Invoiced_From_Quotes,
    SUM(IF(f.kind = "inv_other",  f.amount, NULL))  AS Invoiced_Other,
    SUM(IF(f.kind = "cost_other", f.amount, NULL))  AS Other_Costs
  FROM seg_facts f
  JOIN p ON f.fact_date BETWEEN p.Period_Start AND p.As_Of
  WHERE f.kind != "ticket"
  GROUP BY 1, 2, 3, 4
),
backlog AS (
  SELECT p.Period_Type, p.Period_Start, f.Segment_Type, f.Segment,
    COUNTIF(DATE_DIFF(p.As_Of, f.fact_date, DAY) > 30)  AS Backlog_30_Plus,
    COUNTIF(DATE_DIFF(p.As_Of, f.fact_date, DAY) > 60)  AS Backlog_60_Plus,
    COUNTIF(DATE_DIFF(p.As_Of, f.fact_date, DAY) > 100) AS Backlog_100_Plus
  FROM seg_facts f
  JOIN p ON f.fact_date <= p.As_Of AND (f.closed_date IS NULL OR f.closed_date > p.As_Of)
  WHERE f.kind = "ticket"
  GROUP BY 1, 2, 3, 4
)
SELECT
  p.Period_Type, p.Period_Start, p.Period_End,
  -- text match key for the Sheets KPI grid: "September 2026" (months) / "Week of 05/10/2026" (weeks)
  IF(p.Period_Type = "Month", FORMAT_DATE("%B %Y", p.Period_Start),
     CONCAT("Week of ", FORMAT_DATE("%d/%m/%Y", p.Period_Start))) AS Period_Label,
  p.As_Of,
  p.Period_End > CURRENT_DATE("Europe/London")          AS Is_Current_Period,
  s.Segment_Order, s.Segment_Type, s.Segment,
  IF(s.Segment = "Neko Sweden", "SEK", "GBP")           AS Currency,
  -- PPM compliance
  IFNULL(f.Statutory_PPM_Due, 0)                        AS Statutory_PPM_Due,
  IFNULL(f.Statutory_PPM_On_Time, 0)                    AS Statutory_PPM_On_Time,
  SAFE_DIVIDE(f.Statutory_PPM_On_Time, f.Statutory_PPM_Due)         AS Statutory_Compliance_Pct,
  IFNULL(f.Critical_PPM_Due, 0)                         AS Critical_PPM_Due,
  IFNULL(f.Critical_PPM_On_Time, 0)                     AS Critical_PPM_On_Time,
  SAFE_DIVIDE(f.Critical_PPM_On_Time, f.Critical_PPM_Due)           AS Critical_Compliance_Pct,
  IFNULL(f.Non_Statutory_PPM_Due, 0)                    AS Non_Statutory_PPM_Due,
  IFNULL(f.Non_Statutory_PPM_On_Time, 0)                AS Non_Statutory_PPM_On_Time,
  SAFE_DIVIDE(f.Non_Statutory_PPM_On_Time, f.Non_Statutory_PPM_Due) AS Non_Statutory_Compliance_Pct,
  -- first time fix
  IFNULL(f.First_Time_Fix_Jobs, 0)                      AS First_Time_Fix_Jobs,
  CAST(IFNULL(f.First_Time_Fix_Fixed, 0) AS INT64)      AS First_Time_Fix_Fixed,
  SAFE_DIVIDE(f.First_Time_Fix_Fixed, f.First_Time_Fix_Jobs)        AS First_Time_Fix_Pct,
  -- money (ex VAT, in Currency)
  IFNULL(f.Quotes_Raised, 0)                            AS Quotes_Raised,
  ROUND(IFNULL(f.Quoted_Value, 0), 2)                   AS Quoted_Value,
  IF(s.Segment = "Neko Sweden", NULL, ROUND(IFNULL(f.Invoiced_From_Quotes, 0), 2)) AS Invoiced_From_Quotes,
  IF(s.Segment = "Neko Sweden", NULL, ROUND(IFNULL(f.Invoiced_Other, 0), 2))       AS Invoiced_Other,
  IF(s.Segment = "Neko Sweden", NULL, ROUND(IFNULL(f.Other_Costs, 0), 2))          AS Other_Costs,
  -- backlog snapshot at As_Of
  IFNULL(b.Backlog_30_Plus, 0)                          AS Backlog_30_Plus,
  IFNULL(b.Backlog_60_Plus, 0)                          AS Backlog_60_Plus,
  IFNULL(b.Backlog_100_Plus, 0)                         AS Backlog_100_Plus
FROM p
CROSS JOIN segments s
LEFT JOIN flow f    USING (Period_Type, Period_Start, Segment_Type, Segment)
LEFT JOIN backlog b USING (Period_Type, Period_Start, Segment_Type, Segment);
