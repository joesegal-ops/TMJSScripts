-- reporting.internal_metrics — internal KPI pack, by MONTH and by ISO WEEK (Mon-Sun). (2026-10-12; SLA/volume/all-quote/uninvoiced added 2026-10-16)
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
-- Category: HVAC = job category "Heating and Cooling (HVAC)" (2026-10-13). Jobs, PPMs, invoices and costs use the
--   JOB's category; quotes and project metrics use the QUOTE's own category (models.quote_tracking.job_category).
--   Overlaps the Customer and Area cuts like they overlap each other — never add it to them.
-- Neko Sweden = the separate SE tenant (sweden_* datasets) + any "Neko Health AB" record on the UK tenant.
-- Its money is SEK (see Currency); the SE tenant has no invoices/costs loaded, so those columns are NULL there.
--
-- PPM COMPLIANCE (jobs numbered PM..., i.e. generated from a PPM contract; Cancelled excluded)
--   Due date  = the job's DateLogged (JL creates each PPM job on its scheduled date; AppointmentDate agrees).
--   Due       = PPMs falling due in the period, up to today for the current period.
--   On_Time   = of those, completed AT ANY TIME up to now (DateComplete set, or status Completed/Invoiced/Costed).
--               Changed 2026-10-13 from "completed by the end of the period they fell due in" to match the Looker
--               compliance tile (WeWork Statutory Sept 2026: 250/259 = 96.5%, was 234/259 = 90.3%). Consequence:
--               a past month's figure keeps rising as late PPMs get closed. Column names kept so the Operations
--               Metrics sheet formulas (which map *_Compliance_Pct -> *_PPM_On_Time / *_PPM_Due) don't break.
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
-- PROJECTS (2026-10-13; UK quotes whose job_type in models.quote_tracking is "Project"; SE quotes carry no type)
--   Time_To_Quote_*        (redefined 2026-10-20) days from the MONDAY ITEM being created (system created_at) to the
--                          item's FIRST JobLogic quote being raised, by quote date. One row per item on the WW Active
--                          and Other Clients boards that has a quote (reporting.projects.Quote_Numbers = quotes linked
--                          via the item's job ref OR typed on the board). Quote raised before the item = 0 days.
--                          WW TRIAGE is left out (intake board; its quoted items duplicate WW Active). Customer, site
--                          area and category come from that first quote. Not limited to quotes typed "Project".
--   Approval_To_Delivery_* days from quote approval to completion of the job it was upgraded into, by COMPLETION date.
--                          The quote->job link is inferred (reporting.quote_to_job_completion): "low" confidence links
--                          and negative durations (work finished before formal approval) are dropped.
--   *_Total / *_Count give the average (*_Avg = Total / Count, so it can be re-averaged across segments); *_Median
--   is per row only — it cannot be combined across segments.
--   Project_Sell / _Cost   WON project quotes by APPROVAL date (reporting.project_margin): sell = quote value ex VAT,
--                          cost = Total_Cost_exVAT = GREATEST(quote cost, upgraded job's own cost) — never the sum.
--   Project_Margin_Pct     (Sell - Cost) / Sell (0-1). GROSS margin on sold work, NOT net profit: JobLogic holds no
--                          overheads. Priced margin, so it is known at approval — not dependent on invoicing.
--   Quote_Conversion_Pct   of project quotes raised in the period (not cancelled), the share Won (status Approved/
--                          Upgraded). Like PPM compliance, a month's figure rises as its outstanding quotes are decided.
--
-- ALL QUOTES (2026-10-16; UK, every quote type — the PROJECTS block above is Project-typed only)
--   All_Time_To_Quote_*    days from the parent job being logged (models.quote_tracking.parent_job_logged) to the
--                          quote being raised, by quote date. Quotes with no parent job (~20%) and negative gaps
--                          dropped. Use this for HVAC: most HVAC quotes are typed Reactive, not Project.
--   All_Quote_Conversion_* every non-cancelled quote raised in the period; Won = status Approved/Upgraded or upgraded.
--
-- REACTIVE SLA (2026-10-16; UK only, from models.sla_analysis: Job_Type "Reactive", by logged date)
--   SLA_Jobs = reactive jobs with a priority target that have been attended, or are still unattended and already
--   past target. Jobs closed with no completed visit, and open jobs still inside target, are left out.
--   SLA_Met = attended within target (pause statuses excluded, business hours for non-emergency priorities).
--   SLA_Attendance_Pct = Met / Jobs (0-1). Rises/falls as a recent period's open jobs get attended.
--
-- VOLUME (2026-10-16; tickets = same scope as BACKLOG below)
--   Tickets_Logged by logged date; Tickets_Completed by completion date (status Completed/Invoiced/Costed, not
--   Cancelled); Backlog_Open = every open ticket at As_Of (snapshot, includes the aged buckets).
--
-- COMPLETED NOT INVOICED (2026-10-16; snapshot at As_Of; UK tickets only — PPMs are billed by contract and
--   Projects by quote value, so neither is here). Tickets completed on/before As_Of still owed at As_Of:
--   (A) chargeable cost lines (models.cost_line_items) not invoiced by As_Of (flagged invoiced but undated =
--       invoiced); (B) quote-billed tickets (empty cost tab) whose QuotedValue exceeds the standard invoices raised
--       against the job number by As_Of. Grouped invoices carry no JobNumber (raw.customer_grouped_invoice_lines
--       isn't loaded), so a (B) job now in status Invoiced with no job-number invoice is treated as billed — in
--       past snapshots too, which slightly understates history. Uninvoiced_Value = amount owed ex VAT.
--   Differs from models.job_uninvoiced_costs, whose branch B counts grouped-invoiced jobs as still owed.
--   Project_Uninvoiced_* (2026-10-16): the same snapshot for UK PROJECT jobs, kept separate from the ticket figure.
--   Finished = status Completed/Invoiced/Costed/"Reqs. Invoice", dated DateComplete (fallback UpdatedAt). Bill value =
--   job QuotedValue, or its cost-line sell when there is no quoted value; jobs with neither (~1,800 original request
--   jobs whose work moved to the upgraded job) are skipped. Owed = value - standard invoices raised against the job
--   number by As_Of. Projects are NOT billed on grouped invoices, so — unlike the ticket figure — a job in status
--   Invoiced with no job-number invoice still counts as owed (worth chasing: it's a status/billing mismatch).
--
-- PHOTOS (2026-10-21; UK tickets only — same scope as FIRST TIME FIX; SE has no notes loaded). A photo = an image file
--   (jpg/jpeg/png/heic/heif/bmp/gif/webp/tif) in the Attachments of a note (raw.notes, deduped on note UniqueId).
--   Engineers attach them to VISIT notes; job-level note images count towards the job too. Videos are not photos.
--   Photo_Jobs / Photo_Jobs_With_Photo / Photo_Pct: completed tickets with >= 1 completed visit (by completion date);
--     With_Photo = at least one photo anywhere on the job.
--   Photos_Per_Visit_Total / _Count / _Avg: completed visits on tickets (by visit END date) and the photos on each
--     visit's own notes; _Avg = Total / Count (visits with 0 photos count as 0).
--
-- TOTAL SELL (2026-10-22; UK, ex VAT) = value of work DELIVERED in the period, invoiced or not:
--   Sell_Tickets   completed tickets (BACKLOG scope) by completion date: chargeable cost-line sell, or QuotedValue when
--                  the job has no cost lines (same valuation as Uninvoiced_*).
--   Sell_Projects  finished Project jobs (Completed/Invoiced/Costed/"Reqs. Invoice") by completion date: QuotedValue,
--                  else cost-line sell (same valuation as Project_Uninvoiced_*). Original request jobs with no value = 0.
--   Sell_PPM       PPM contract invoices (PPMContractId set) by invoice date — PPMs are billed on the contract
--                  schedule, so the invoice IS the sell. PPM job cost lines are not added (would double count).
--   Total_Sell     = the three together. Differs from Invoiced_* (billing date, incl. invoices for work done earlier).
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
    (5, "Area", "East"), (6, "Area", "West"), (7, "Area", "ROUK"), (8, "Area", "10 York Road"),
    (9, "Category", "HVAC")])
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
         (SELECT COUNTIF(v.StatusDescription = "Complete") FROM UNNEST(j.VisitsStatus) v) AS complete_visits,
         j.CategoryDescription AS job_category, j.QuotedValue
  FROM `vmimporteddata.models.job_statutory_category_v2` j
  LEFT JOIN site_area sa ON sa.SiteId = j.SiteId
  UNION ALL
  SELECT "SE", j.Id, j.JobNumber, j.CustomerName, j.TypeDescription, j.HasParent,
         j.JobStatusDescription, j.Statutory_Category, CAST(NULL AS STRING),
         DATE(j.DateLogged), j.DateComplete, j.UpdatedAt,
         (SELECT COUNTIF(v.StatusDescription = "Complete") FROM UNNEST(j.VisitsStatus) v),
         j.CategoryDescription, CAST(NULL AS FLOAT64)
  FROM `vmimporteddata.sweden_models.job_statutory_category` j
),
project_quotes AS (  -- UK quotes typed "Project", with their site's area and parent job's logged date
  SELECT q.Id AS quote_id, q.QuoteNumber AS quote_number, q.CustomerName, sa.Area,
         DATE(q.DateLogged, "Europe/London") AS quote_date,
         DATE(pj.DateLogged, "Europe/London") AS parent_logged_date,
         (qt.status IN ("Approved", "Upgraded") OR IFNULL(qt.is_upgraded, FALSE)) AS is_won,
         qt.job_category
  FROM (SELECT * FROM `vmimporteddata.raw.quotes`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1) q
  JOIN `vmimporteddata.models.quote_tracking` qt ON qt.quote_id = q.Id
  LEFT JOIN site_area sa ON sa.SiteId = q.SiteId
  LEFT JOIN `vmimporteddata.raw.jobs` pj ON pj.Id = q.ParentJobAutoId
  WHERE qt.job_type = "Project" AND NOT IFNULL(q.IsCancelled, FALSE)
),
all_quotes AS (  -- every non-cancelled UK quote, one row per quote
  SELECT qt.quote_id, qt.customer AS CustomerName, sa.Area, qt.date_logged AS quote_date, qt.parent_job_logged,
         (qt.status IN ("Approved", "Upgraded") OR IFNULL(qt.is_upgraded, FALSE)) AS is_won, qt.job_category
  FROM (SELECT * FROM `vmimporteddata.models.quote_tracking`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY quote_id ORDER BY _ingested_at DESC) = 1) qt
  LEFT JOIN (SELECT Id, SiteId FROM `vmimporteddata.raw.quotes`
             QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1) q ON q.Id = qt.quote_id
  LEFT JOIN site_area sa ON sa.SiteId = q.SiteId
  WHERE NOT IFNULL(qt.is_cancelled, FALSE)
),
photo_files AS (  -- one row per image attached to a (deduped) note
  SELECT n._EntityType AS entity_type, n._JobId AS job_id, n._VisitId AS visit_id
  FROM (SELECT * FROM `vmimporteddata.raw.notes`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY UniqueId ORDER BY _ingested_at DESC) = 1) n,
       UNNEST(n.Attachments) a
  WHERE REGEXP_CONTAINS(LOWER(a.FileName), r"\.(jpe?g|png|heic|heif|bmp|gif|webp|tiff?)$")
),
photo_jobs AS (SELECT job_id, COUNT(*) AS photos FROM photo_files GROUP BY job_id),
photo_visits AS (SELECT visit_id, COUNT(*) AS photos FROM photo_files
                 WHERE entity_type = "Visit" AND visit_id IS NOT NULL GROUP BY visit_id),
ticket_visits AS (  -- completed visits on UK tickets, with the visit end date (local)
  SELECT j.Id AS job_id, v.VisitId AS visit_id, DATE(v.EndDate) AS visit_date
  FROM `vmimporteddata.models.job_statutory_category_v2` j, UNNEST(j.VisitsStatus) v
  WHERE v.StatusDescription = "Complete" AND v.EndDate IS NOT NULL
    AND NOT STARTS_WITH(j.JobNumber, "PM") AND IFNULL(j.TypeDescription, "") != "Project"
),
job_sell AS (  -- UK job valuation for TOTAL SELL: chargeable cost-line sell, else quoted value
  SELECT j.job_id,
         IF(IFNULL(jc.n_lines, 0) > 0, IFNULL(cl.sell, 0), IFNULL(j.QuotedValue, 0)) AS ticket_value,
         IF(IFNULL(j.QuotedValue, 0) > 0, j.QuotedValue, IFNULL(cl.sell, 0))         AS project_value
  FROM jobs j
  LEFT JOIN (SELECT job_id, n_lines FROM `vmimporteddata.raw.job_costs`
             QUALIFY ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY _ingested_at DESC) = 1) jc
    ON jc.job_id = j.job_id
  LEFT JOIN (SELECT job_id, SUM(sell_excl_vat) AS sell FROM `vmimporteddata.models.cost_line_items`
             WHERE IFNULL(is_chargeable, TRUE) GROUP BY job_id) cl
    ON cl.job_id = j.job_id
  WHERE j.tenant = "UK"
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
         CAST(NULL AS DATE) AS closed_date, CAST(NULL AS FLOAT64) AS amount, job_category
  FROM jobs
  WHERE STARTS_WITH(JobNumber, "PM") AND status != "Cancelled"

  UNION ALL  -- backlog tickets: one row per non-PPM, non-Project job, dated by logged date
  SELECT tenant, CustomerName, Area, "ticket", logged_date, NULL, NULL,
         IF(status IN ("Completed", "Invoiced", "Costed", "Cancelled"),
            DATE(COALESCE(DateComplete, UpdatedAt)), NULL), NULL, job_category
  FROM jobs
  WHERE NOT STARTS_WITH(JobNumber, "PM") AND IFNULL(TypeDescription, "") != "Project"

  UNION ALL  -- first time fix: completed tickets with >= 1 completed visit, dated by completion; amount = 1 if fixed in one
  SELECT tenant, CustomerName, Area, "ftf", DATE(COALESCE(DateComplete, UpdatedAt)), NULL, NULL, NULL,
         IF(complete_visits = 1, 1, 0), job_category
  FROM jobs
  WHERE NOT STARTS_WITH(JobNumber, "PM") AND IFNULL(TypeDescription, "") != "Project"
    AND status IN ("Completed", "Invoiced", "Costed") AND complete_visits >= 1

  UNION ALL  -- quotes raised (UK)
  SELECT "UK", q.CustomerName, sa.Area, "quote", DATE(q.DateLogged, "Europe/London"), NULL, NULL, NULL,
         q.QuoteValueExcludingVat, qt.job_category
  FROM (SELECT * FROM `vmimporteddata.raw.quotes`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1) q
  LEFT JOIN site_area sa ON sa.SiteId = q.SiteId
  LEFT JOIN `vmimporteddata.models.quote_tracking` qt ON qt.quote_id = q.Id
  WHERE NOT IFNULL(q.IsCancelled, FALSE)

  UNION ALL  -- quotes raised (SE, SEK)
  SELECT "SE", q.CustomerName, NULL, "quote", DATE(q.DateLogged, "Europe/Stockholm"), NULL, NULL, NULL,
         q.QuoteValueExcludingVat, CAST(NULL AS STRING)
  FROM (SELECT * FROM `vmimporteddata.sweden_raw.quotes`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1) q
  WHERE NOT IFNULL(q.IsCancelled, FALSE)

  UNION ALL  -- projects: time to quote (Monday item created -> its first JL quote raised; quote first = 0), by quote date
  SELECT "UK", CustomerName, Area, "ttq", quote_date, NULL, NULL, NULL,
         GREATEST(DATE_DIFF(quote_date, item_created, DAY), 0), job_category
  FROM (
    SELECT q.CustomerName, sa.Area, qt.job_category, DATE(m.Item_Created_At) AS item_created,
           DATE(q.DateLogged, "Europe/London") AS quote_date
    FROM `vmimporteddata.reporting.projects` m
    CROSS JOIN UNNEST(SPLIT(m.Quote_Numbers, ",")) AS qn
    JOIN (SELECT * FROM `vmimporteddata.raw.quotes`
          QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1) q
      ON q.QuoteNumber = TRIM(qn)
    LEFT JOIN `vmimporteddata.models.quote_tracking` qt ON qt.quote_id = q.Id
    LEFT JOIN site_area sa ON sa.SiteId = q.SiteId
    WHERE m.Board IN ("WW Active", "Other Clients") AND m.Item_Created_At IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY m.Board, m.Item_Id ORDER BY q.DateLogged, q.Id) = 1
  )

  UNION ALL  -- projects: conversion (amount = 1 if won), by quote date
  SELECT "UK", CustomerName, Area, "conv", quote_date, NULL, NULL, NULL, IF(is_won, 1, 0), job_category
  FROM project_quotes

  UNION ALL  -- projects: quote approval -> upgraded job completed, by completion date
  SELECT "UK", pq.CustomerName, pq.Area, "deliv", d.completed_date, NULL, NULL, NULL,
         d.days_approval_to_completion, pq.job_category
  FROM `vmimporteddata.reporting.quote_to_job_completion` d
  JOIN project_quotes pq ON pq.quote_id = d.quote_id
  WHERE d.is_complete AND d.days_approval_to_completion >= 0 AND d.link_confidence != "low"

  UNION ALL  -- projects: margin on won project quotes, by approval date (two rows per quote: sell, cost)
  SELECT "UK", pq.CustomerName, pq.Area, kind, m.Approved_Date, NULL, NULL, NULL,
         IF(kind = "pm_sell", m.Quote_Sell_exVAT, m.Total_Cost_exVAT), pq.job_category
  FROM `vmimporteddata.reporting.project_margin` m
  JOIN project_quotes pq ON pq.quote_number = m.Quote_Number
  CROSS JOIN UNNEST(["pm_sell", "pm_cost"]) AS kind
  WHERE m.Is_Won AND m.Approved_Date IS NOT NULL

  UNION ALL  -- all quote types: time to quote, by quote date
  SELECT "UK", CustomerName, Area, "ttq_all", quote_date, NULL, NULL, NULL,
         DATE_DIFF(quote_date, parent_job_logged, DAY), job_category
  FROM all_quotes
  WHERE parent_job_logged IS NOT NULL AND quote_date >= parent_job_logged

  UNION ALL  -- all quote types: conversion (amount = 1 if won), by quote date
  SELECT "UK", CustomerName, Area, "conv_all", quote_date, NULL, NULL, NULL, IF(is_won, 1, 0), job_category
  FROM all_quotes

  UNION ALL  -- reactive SLA attendance (amount = 1 if met), by logged date
  SELECT "UK", j.CustomerName, j.Area, "sla", DATE(s.Date_Logged), NULL, NULL, NULL,
         IF(s.First_Visit IS NOT NULL AND s.SLA_Breached = "Within SLA", 1, 0), j.job_category
  FROM `vmimporteddata.models.sla_analysis` s
  JOIN jobs j ON j.tenant = "UK" AND j.JobNumber = s.ID
  WHERE s.SLA_Target_Hours IS NOT NULL
    AND (s.First_Visit IS NOT NULL OR (s.DateComplete IS NULL AND s.SLA_Breached = "Breached"))

  UNION ALL  -- tickets completed, by completion date
  SELECT tenant, CustomerName, Area, "done", DATE(COALESCE(DateComplete, UpdatedAt)), NULL, NULL, NULL, NULL,
         job_category
  FROM jobs
  WHERE NOT STARTS_WITH(JobNumber, "PM") AND IFNULL(TypeDescription, "") != "Project"
    AND status IN ("Completed", "Invoiced", "Costed")

  UNION ALL  -- photos: completed UK tickets with >= 1 completed visit; amount = 1 if any photo on the job
  SELECT j.tenant, j.CustomerName, j.Area, "photo_job", DATE(COALESCE(j.DateComplete, j.UpdatedAt)), NULL, NULL, NULL,
         IF(pj.job_id IS NOT NULL, 1, 0), j.job_category
  FROM jobs j
  LEFT JOIN photo_jobs pj ON pj.job_id = j.job_id
  WHERE j.tenant = "UK" AND NOT STARTS_WITH(j.JobNumber, "PM") AND IFNULL(j.TypeDescription, "") != "Project"
    AND j.status IN ("Completed", "Invoiced", "Costed") AND j.complete_visits >= 1

  UNION ALL  -- photos per visit: completed ticket visits by visit end date; amount = photos on that visit
  SELECT j.tenant, j.CustomerName, j.Area, "photo_visit", tv.visit_date, NULL, NULL, NULL,
         IFNULL(pv.photos, 0), j.job_category
  FROM ticket_visits tv
  JOIN jobs j ON j.tenant = "UK" AND j.job_id = tv.job_id
  LEFT JOIN photo_visits pv ON pv.visit_id = tv.visit_id

  UNION ALL  -- invoices (UK only — no SE invoice table), split by whether the job came from a quote
  SELECT "UK", i.CustomerName, COALESCE(j.Area, sa.Area),
         IF(qj.JobNumber IS NOT NULL, "inv_quote", "inv_other"),
         DATE(i.DateRaised, "Europe/London"), NULL, NULL, NULL, i.TotalExcludingVat, j.job_category
  FROM (SELECT * FROM `vmimporteddata.raw.invoices`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1) i
  LEFT JOIN jobs j ON j.tenant = "UK" AND j.job_id = i.JobId
  LEFT JOIN site_area sa ON sa.SiteId = i.SiteId
  LEFT JOIN quote_jobs qj ON qj.JobNumber = i.JobNumber
  WHERE NOT IFNULL(i.IsDraft, FALSE)

  UNION ALL  -- total sell: completed tickets (by completion date) and finished Project jobs
  SELECT j.tenant, j.CustomerName, j.Area,
         IF(j.TypeDescription = "Project", "sell_project", "sell_ticket"),
         DATE(COALESCE(j.DateComplete, j.UpdatedAt)), NULL, NULL, NULL,
         IF(j.TypeDescription = "Project", js.project_value, js.ticket_value), j.job_category
  FROM jobs j
  JOIN job_sell js ON js.job_id = j.job_id
  WHERE j.tenant = "UK" AND NOT STARTS_WITH(j.JobNumber, "PM")
    AND (j.status IN ("Completed", "Invoiced", "Costed")
         OR (j.TypeDescription = "Project" AND j.status = "Reqs. Invoice"))

  UNION ALL  -- total sell: PPM contract invoices, by invoice date
  SELECT "UK", i.CustomerName, sa.Area, "sell_ppm", DATE(i.DateRaised, "Europe/London"), NULL, NULL, NULL,
         i.TotalExcludingVat, CAST(NULL AS STRING)
  FROM (SELECT * FROM `vmimporteddata.raw.invoices`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1) i
  LEFT JOIN site_area sa ON sa.SiteId = i.SiteId
  WHERE i.PPMContractId IS NOT NULL AND NOT IFNULL(i.IsDraft, FALSE)

  UNION ALL  -- other costs: cost lines on jobs that did not come from a quote (UK only)
  SELECT "UK", j.CustomerName, j.Area, "cost_other", DATE(c.date_incurred), NULL, NULL, NULL, c.cost_excl_vat, j.job_category
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
                       WHEN "10 York Road" THEN "10 York Road" END),
    STRUCT("Category", IF(f.job_category = "Heating and Cooling (HVAC)", "HVAC", NULL))
  ]) s
  WHERE s.Segment IS NOT NULL
    AND IFNULL(f.CustomerName, "") != "Test"
),
flow AS (
  SELECT p.Period_Type, p.Period_Start, f.Segment_Type, f.Segment,
    COUNTIF(f.kind = "ppm" AND f.category = "Statutory")                                AS Statutory_PPM_Due,
    COUNTIF(f.kind = "ppm" AND f.category = "Statutory" AND f.done_date IS NOT NULL) AS Statutory_PPM_On_Time,
    COUNTIF(f.kind = "ppm" AND f.category = "Critical")                                 AS Critical_PPM_Due,
    COUNTIF(f.kind = "ppm" AND f.category = "Critical" AND f.done_date IS NOT NULL)  AS Critical_PPM_On_Time,
    COUNTIF(f.kind = "ppm" AND f.category = "Non-Statutory")                                AS Non_Statutory_PPM_Due,
    COUNTIF(f.kind = "ppm" AND f.category = "Non-Statutory" AND f.done_date IS NOT NULL) AS Non_Statutory_PPM_On_Time,
    COUNTIF(f.kind = "photo_job")                   AS Photo_Jobs,
    SUM(IF(f.kind = "photo_job", f.amount, NULL))   AS Photo_Jobs_With_Photo,
    SUM(IF(f.kind = "photo_visit", f.amount, NULL)) AS Photos_Per_Visit_Total,
    COUNTIF(f.kind = "photo_visit")                 AS Photos_Per_Visit_Count,
    SUM(IF(f.kind = "sell_ticket", f.amount, NULL))  AS Sell_Tickets,
    SUM(IF(f.kind = "sell_project", f.amount, NULL)) AS Sell_Projects,
    SUM(IF(f.kind = "sell_ppm", f.amount, NULL))     AS Sell_PPM,
    COUNTIF(f.kind = "ftf")                         AS First_Time_Fix_Jobs,
    SUM(IF(f.kind = "ftf", f.amount, NULL))         AS First_Time_Fix_Fixed,
    SUM(IF(f.kind = "ttq", f.amount, NULL))         AS Time_To_Quote_Total,
    COUNTIF(f.kind = "ttq")                         AS Time_To_Quote_Count,
    APPROX_QUANTILES(IF(f.kind = "ttq", f.amount, NULL), 2)[OFFSET(1)]   AS Time_To_Quote_Median,
    SUM(IF(f.kind = "deliv", f.amount, NULL))       AS Approval_To_Delivery_Total,
    COUNTIF(f.kind = "deliv")                       AS Approval_To_Delivery_Count,
    APPROX_QUANTILES(IF(f.kind = "deliv", f.amount, NULL), 2)[OFFSET(1)] AS Approval_To_Delivery_Median,
    SUM(IF(f.kind = "pm_sell", f.amount, NULL))     AS Project_Sell,
    SUM(IF(f.kind = "pm_cost", f.amount, NULL))     AS Project_Cost,
    SUM(IF(f.kind = "ttq_all", f.amount, NULL))     AS All_Time_To_Quote_Total,
    COUNTIF(f.kind = "ttq_all")                     AS All_Time_To_Quote_Count,
    APPROX_QUANTILES(IF(f.kind = "ttq_all", f.amount, NULL), 2)[OFFSET(1)] AS All_Time_To_Quote_Median,
    COUNTIF(f.kind = "conv_all")                    AS All_Quote_Conversion_Quotes,
    SUM(IF(f.kind = "conv_all", f.amount, NULL))    AS All_Quote_Conversion_Won,
    COUNTIF(f.kind = "sla")                         AS SLA_Jobs,
    SUM(IF(f.kind = "sla", f.amount, NULL))         AS SLA_Met,
    COUNTIF(f.kind = "ticket")                      AS Tickets_Logged,
    COUNTIF(f.kind = "done")                        AS Tickets_Completed,
    COUNTIF(f.kind = "conv")                        AS Quote_Conversion_Quotes,
    SUM(IF(f.kind = "conv", f.amount, NULL))        AS Quote_Conversion_Won,
    COUNTIF(f.kind = "quote")                       AS Quotes_Raised,
    SUM(IF(f.kind = "quote",      f.amount, NULL))  AS Quoted_Value,
    SUM(IF(f.kind = "inv_quote",  f.amount, NULL))  AS Invoiced_From_Quotes,
    SUM(IF(f.kind = "inv_other",  f.amount, NULL))  AS Invoiced_Other,
    SUM(IF(f.kind = "cost_other", f.amount, NULL))  AS Other_Costs
  FROM seg_facts f
  JOIN p ON f.fact_date BETWEEN p.Period_Start AND p.As_Of
  GROUP BY 1, 2, 3, 4
),
backlog AS (
  SELECT p.Period_Type, p.Period_Start, f.Segment_Type, f.Segment,
    COUNTIF(DATE_DIFF(p.As_Of, f.fact_date, DAY) > 30)  AS Backlog_30_Plus,
    COUNTIF(DATE_DIFF(p.As_Of, f.fact_date, DAY) > 60)  AS Backlog_60_Plus,
    COUNTIF(DATE_DIFF(p.As_Of, f.fact_date, DAY) > 100) AS Backlog_100_Plus,
    COUNT(*)                                            AS Backlog_Open
  FROM seg_facts f
  JOIN p ON f.fact_date <= p.As_Of AND (f.closed_date IS NULL OR f.closed_date > p.As_Of)
  WHERE f.kind = "ticket"
  GROUP BY 1, 2, 3, 4
),
done_tickets AS (  -- completed UK tickets
  SELECT j.*, DATE(COALESCE(j.DateComplete, j.UpdatedAt)) AS completed_date
  FROM jobs j
  WHERE j.tenant = "UK" AND NOT STARTS_WITH(j.JobNumber, "PM") AND IFNULL(j.TypeDescription, "") != "Project"
    AND j.status IN ("Completed", "Invoiced", "Costed")
),
uninv_lines AS (  -- (A) chargeable cost lines on completed tickets, with when (if ever) each was invoiced
  SELECT d.CustomerName, d.Area, d.job_category, d.job_id, d.completed_date,
         COALESCE(c.invoiced_date, IF(c.has_been_invoiced, DATE "1900-01-01", NULL)) AS invoiced_date,
         c.sell_excl_vat
  FROM `vmimporteddata.models.cost_line_items` c
  JOIN done_tickets d ON d.job_id = c.job_id
  WHERE IFNULL(c.is_chargeable, TRUE) AND IFNULL(c.sell_excl_vat, 0) != 0
),
qb_jobs AS (  -- (B) quote-billed completed tickets: empty cost tab, value in QuotedValue
  SELECT d.CustomerName, d.Area, d.job_category, d.job_id, d.JobNumber, d.completed_date, d.QuotedValue,
         d.status = "Invoiced" AS status_invoiced
  FROM done_tickets d
  LEFT JOIN `vmimporteddata.raw.job_costs` jc ON jc.job_id = d.job_id
  WHERE COALESCE(jc.n_lines, 0) = 0 AND d.QuotedValue > 0
),
done_projects AS (  -- finished UK Project jobs with a value to bill
  SELECT j.CustomerName, j.Area, j.job_category, j.job_id, j.JobNumber,
         DATE(COALESCE(j.DateComplete, j.UpdatedAt)) AS completed_date,
         IF(IFNULL(j.QuotedValue, 0) > 0, j.QuotedValue, jc.total_sell_exvat) AS bill_value
  FROM jobs j
  LEFT JOIN (SELECT job_id, total_sell_exvat FROM `vmimporteddata.raw.job_costs`
             QUALIFY ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY _ingested_at DESC) = 1) jc
    ON jc.job_id = j.job_id
  WHERE j.tenant = "UK" AND j.TypeDescription = "Project"
    AND j.status IN ("Completed", "Invoiced", "Costed", "Reqs. Invoice")
    AND IF(IFNULL(j.QuotedValue, 0) > 0, j.QuotedValue, jc.total_sell_exvat) > 0
),
qb_inv AS (  -- standard (non-draft) invoices against those jobs; grouped invoices carry no JobNumber
  SELECT JobNumber, DATE(DateRaised, "Europe/London") AS inv_date, TotalExcludingVat
  FROM (SELECT * FROM `vmimporteddata.raw.invoices`
        QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY _ingested_at DESC) = 1)
  WHERE JobNumber IS NOT NULL AND NOT IFNULL(IsDraft, FALSE)
),
uninv_snap AS (  -- one row per period x job still owed at As_Of, with the amount owed
  SELECT p.Period_Type, p.Period_Start, u.CustomerName, u.Area, u.job_category, u.job_id, SUM(u.sell_excl_vat) AS owed,
         "ticket" AS bucket
  FROM uninv_lines u
  JOIN p ON u.completed_date <= p.As_Of AND (u.invoiced_date IS NULL OR u.invoiced_date > p.As_Of)
  GROUP BY 1, 2, 3, 4, 5, 6
  UNION ALL
  SELECT p.Period_Type, p.Period_Start, q.CustomerName, q.Area, q.job_category, q.job_id,
         ANY_VALUE(q.QuotedValue) - IFNULL(SUM(IF(i.inv_date <= p.As_Of, i.TotalExcludingVat, 0)), 0), "ticket"
  FROM qb_jobs q
  JOIN p ON q.completed_date <= p.As_Of
  LEFT JOIN qb_inv i ON i.JobNumber = q.JobNumber
  -- status Invoiced with no job-number invoice = billed on a grouped invoice (date unknown): treat as billed
  WHERE NOT (q.status_invoiced AND NOT EXISTS (SELECT 1 FROM qb_inv x WHERE x.JobNumber = q.JobNumber))
  GROUP BY 1, 2, 3, 4, 5, 6
  HAVING ANY_VALUE(q.QuotedValue) - IFNULL(SUM(IF(i.inv_date <= p.As_Of, i.TotalExcludingVat, 0)), 0) > 0.01
  UNION ALL  -- finished Project jobs not fully invoiced against their own job number by As_Of
  SELECT p.Period_Type, p.Period_Start, d.CustomerName, d.Area, d.job_category, d.job_id,
         ANY_VALUE(d.bill_value) - IFNULL(SUM(IF(i.inv_date <= p.As_Of, i.TotalExcludingVat, 0)), 0), "project"
  FROM done_projects d
  JOIN p ON d.completed_date <= p.As_Of
  LEFT JOIN qb_inv i ON i.JobNumber = d.JobNumber
  GROUP BY 1, 2, 3, 4, 5, 6
  HAVING ANY_VALUE(d.bill_value) - IFNULL(SUM(IF(i.inv_date <= p.As_Of, i.TotalExcludingVat, 0)), 0) > 0.01
),
uninvoiced AS (
  SELECT u.Period_Type, u.Period_Start, s.Segment_Type, s.Segment,
    COUNT(DISTINCT IF(u.bucket = "ticket", u.job_id, NULL))  AS Uninvoiced_Jobs,
    SUM(IF(u.bucket = "ticket", u.owed, NULL))               AS Uninvoiced_Value,
    COUNT(DISTINCT IF(u.bucket = "project", u.job_id, NULL)) AS Project_Uninvoiced_Jobs,
    SUM(IF(u.bucket = "project", u.owed, NULL))              AS Project_Uninvoiced_Value
  FROM uninv_snap u
  CROSS JOIN UNNEST([
    STRUCT("Customer" AS Segment_Type,
           CASE WHEN STARTS_WITH(u.CustomerName, "Neko Health AB") THEN "Neko Sweden"
                WHEN u.CustomerName = "Neko Health UK Limited" THEN "Neko UK"
                WHEN u.CustomerName = "WeWork Ltd"             THEN "WeWork"
                ELSE "All Other Customers" END AS Segment),
    STRUCT("Area",
           CASE u.Area WHEN "East London"  THEN "East"
                       WHEN "West London"  THEN "West"
                       WHEN "Rest of UK"   THEN "ROUK"
                       WHEN "10 York Road" THEN "10 York Road" END),
    STRUCT("Category", IF(u.job_category = "Heating and Cooling (HVAC)", "HVAC", NULL))
  ]) s
  WHERE s.Segment IS NOT NULL AND IFNULL(u.CustomerName, "") != "Test"
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
  -- photos (UK tickets)
  IF(s.Segment = "Neko Sweden", NULL, IFNULL(f.Photo_Jobs, 0))                                AS Photo_Jobs,
  IF(s.Segment = "Neko Sweden", NULL, CAST(IFNULL(f.Photo_Jobs_With_Photo, 0) AS INT64))      AS Photo_Jobs_With_Photo,
  SAFE_DIVIDE(f.Photo_Jobs_With_Photo, f.Photo_Jobs)                                          AS Photo_Pct,
  IF(s.Segment = "Neko Sweden", NULL, CAST(IFNULL(f.Photos_Per_Visit_Total, 0) AS INT64))     AS Photos_Per_Visit_Total,
  IF(s.Segment = "Neko Sweden", NULL, IFNULL(f.Photos_Per_Visit_Count, 0))                    AS Photos_Per_Visit_Count,
  ROUND(SAFE_DIVIDE(f.Photos_Per_Visit_Total, f.Photos_Per_Visit_Count), 2)                   AS Photos_Per_Visit_Avg,
  -- first time fix
  IFNULL(f.First_Time_Fix_Jobs, 0)                      AS First_Time_Fix_Jobs,
  CAST(IFNULL(f.First_Time_Fix_Fixed, 0) AS INT64)      AS First_Time_Fix_Fixed,
  SAFE_DIVIDE(f.First_Time_Fix_Fixed, f.First_Time_Fix_Jobs)        AS First_Time_Fix_Pct,
  -- projects (UK project quotes)
  IFNULL(f.Time_To_Quote_Total, 0)                      AS Time_To_Quote_Total,
  IFNULL(f.Time_To_Quote_Count, 0)                      AS Time_To_Quote_Count,
  ROUND(SAFE_DIVIDE(f.Time_To_Quote_Total, f.Time_To_Quote_Count), 1)               AS Time_To_Quote_Avg,
  f.Time_To_Quote_Median                                AS Time_To_Quote_Median,
  IFNULL(f.Approval_To_Delivery_Total, 0)               AS Approval_To_Delivery_Total,
  IFNULL(f.Approval_To_Delivery_Count, 0)               AS Approval_To_Delivery_Count,
  ROUND(SAFE_DIVIDE(f.Approval_To_Delivery_Total, f.Approval_To_Delivery_Count), 1) AS Approval_To_Delivery_Avg,
  f.Approval_To_Delivery_Median                         AS Approval_To_Delivery_Median,
  -- all quote types (UK)
  IFNULL(f.All_Time_To_Quote_Total, 0)                  AS All_Time_To_Quote_Total,
  IFNULL(f.All_Time_To_Quote_Count, 0)                  AS All_Time_To_Quote_Count,
  ROUND(SAFE_DIVIDE(f.All_Time_To_Quote_Total, f.All_Time_To_Quote_Count), 1)       AS All_Time_To_Quote_Avg,
  f.All_Time_To_Quote_Median                            AS All_Time_To_Quote_Median,
  IFNULL(f.All_Quote_Conversion_Quotes, 0)              AS All_Quote_Conversion_Quotes,
  CAST(IFNULL(f.All_Quote_Conversion_Won, 0) AS INT64)  AS All_Quote_Conversion_Won,
  SAFE_DIVIDE(f.All_Quote_Conversion_Won, f.All_Quote_Conversion_Quotes)            AS All_Quote_Conversion_Pct,
  -- reactive SLA attendance (UK)
  IFNULL(f.SLA_Jobs, 0)                                 AS SLA_Jobs,
  CAST(IFNULL(f.SLA_Met, 0) AS INT64)                   AS SLA_Met,
  SAFE_DIVIDE(f.SLA_Met, f.SLA_Jobs)                    AS SLA_Attendance_Pct,
  -- ticket volume
  IFNULL(f.Tickets_Logged, 0)                           AS Tickets_Logged,
  IFNULL(f.Tickets_Completed, 0)                        AS Tickets_Completed,
  -- projects (cont.)
  IFNULL(f.Quote_Conversion_Quotes, 0)                  AS Quote_Conversion_Quotes,
  CAST(IFNULL(f.Quote_Conversion_Won, 0) AS INT64)      AS Quote_Conversion_Won,
  SAFE_DIVIDE(f.Quote_Conversion_Won, f.Quote_Conversion_Quotes)                    AS Quote_Conversion_Pct,
  ROUND(IFNULL(f.Project_Sell, 0), 2)                   AS Project_Sell,
  ROUND(IFNULL(f.Project_Cost, 0), 2)                   AS Project_Cost,
  SAFE_DIVIDE(f.Project_Sell - f.Project_Cost, f.Project_Sell)                      AS Project_Margin_Pct,
  -- total sell: work delivered in the period, invoiced or not (UK, ex VAT)
  IF(s.Segment = "Neko Sweden", NULL, ROUND(IFNULL(f.Sell_Tickets, 0), 2))  AS Sell_Tickets,
  IF(s.Segment = "Neko Sweden", NULL, ROUND(IFNULL(f.Sell_Projects, 0), 2)) AS Sell_Projects,
  IF(s.Segment = "Neko Sweden", NULL, ROUND(IFNULL(f.Sell_PPM, 0), 2))      AS Sell_PPM,
  IF(s.Segment = "Neko Sweden", NULL,
     ROUND(IFNULL(f.Sell_Tickets, 0) + IFNULL(f.Sell_Projects, 0) + IFNULL(f.Sell_PPM, 0), 2)) AS Total_Sell,
  -- money (ex VAT, in Currency)
  IFNULL(f.Quotes_Raised, 0)                            AS Quotes_Raised,
  ROUND(IFNULL(f.Quoted_Value, 0), 2)                   AS Quoted_Value,
  IF(s.Segment = "Neko Sweden", NULL, ROUND(IFNULL(f.Invoiced_From_Quotes, 0), 2)) AS Invoiced_From_Quotes,
  IF(s.Segment = "Neko Sweden", NULL, ROUND(IFNULL(f.Invoiced_Other, 0), 2))       AS Invoiced_Other,
  IF(s.Segment = "Neko Sweden", NULL, ROUND(IFNULL(f.Other_Costs, 0), 2))          AS Other_Costs,
  -- backlog snapshot at As_Of
  IFNULL(b.Backlog_30_Plus, 0)                          AS Backlog_30_Plus,
  IFNULL(b.Backlog_60_Plus, 0)                          AS Backlog_60_Plus,
  IFNULL(b.Backlog_100_Plus, 0)                         AS Backlog_100_Plus,
  IFNULL(b.Backlog_Open, 0)                             AS Backlog_Open,
  -- completed not invoiced, snapshot at As_Of (UK tickets, cost-line sell ex VAT)
  IF(s.Segment = "Neko Sweden", NULL, IFNULL(u.Uninvoiced_Jobs, 0))             AS Uninvoiced_Jobs,
  IF(s.Segment = "Neko Sweden", NULL, ROUND(IFNULL(u.Uninvoiced_Value, 0), 2))  AS Uninvoiced_Value,
  -- finished Project jobs not yet invoiced, snapshot at As_Of (UK)
  IF(s.Segment = "Neko Sweden", NULL, IFNULL(u.Project_Uninvoiced_Jobs, 0))            AS Project_Uninvoiced_Jobs,
  IF(s.Segment = "Neko Sweden", NULL, ROUND(IFNULL(u.Project_Uninvoiced_Value, 0), 2)) AS Project_Uninvoiced_Value
FROM p
CROSS JOIN segments s
LEFT JOIN flow f    USING (Period_Type, Period_Start, Segment_Type, Segment)
LEFT JOIN backlog b USING (Period_Type, Period_Start, Segment_Type, Segment)
LEFT JOIN uninvoiced u USING (Period_Type, Period_Start, Segment_Type, Segment);
