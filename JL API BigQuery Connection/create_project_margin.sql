-- reporting.project_margin — the cost and margin of sold work.
--
-- Grain: ONE ROW PER QUOTE. A quote is the unit of sold work here: it carries the sell AND (unlike
-- the job) the cost. Rebuild:
--   bq --project_id=vmimporteddata query --use_legacy_sql=false < create_project_margin.sql
--
-- WHY THE COST COMES FROM THE QUOTE. Measured 2026-09-29: of 2,899 upgraded quotes only 627
-- (21.6%) of the resulting jobs carry any cost in JobLogic. Costing happens at quote time and is
-- usually never repeated on the job, so raw.job_costs alone cannot produce a margin -- it would
-- cover a fifth of the work. raw.quote_costs (load_quote_costs.py) is the other half.
--
-- Three money columns, deliberately kept separate rather than collapsed into one "profit":
--   Quote_Cost_exVAT  what we planned to spend      (raw.quote_costs, line-level)
--   Job_Cost_exVAT    the job's own cost figure     (raw.job_costs on the upgraded job)
--   Invoiced_exVAT    what we actually billed       (raw.invoices on that job)
--
-- DO NOT ADD QUOTE COST AND JOB COST TOGETHER. Measured 2026-09-29 over the 623 jobs that carry a
-- cost of their own: 268 match the quote cost TO THE PENNY and 274 are within 1% -- median ratio
-- exactly 1.000. The job figure is a COPY of the quote cost (JobLogic carries the lines over on
-- upgrade), sometimes then edited: 275 end up lower (partial copy), only 74 higher (real extras).
-- Summing would therefore double-count roughly half of all costed jobs. Total_Cost_exVAT takes
-- GREATEST(quote, job) instead: the job supersedes when it is higher, the quote stands otherwise.
-- Quote_Margin is the priced margin; Realised_Margin uses invoiced revenue and total cost and is
-- only meaningful once a job has actually been invoiced.

CREATE OR REPLACE VIEW `vmimporteddata.reporting.project_margin` AS
WITH qc AS (
  SELECT * FROM `vmimporteddata.raw.quote_costs`
),
link AS (
  -- quote -> the job it was upgraded into (INFERRED -- the API exposes no quote<->job link, so
  -- this is heuristic; filter on Link_Confidence before trusting the delivery timings).
  SELECT quote_id, upgraded_job_number, completed_date,
         days_approval_to_completion, link_confidence
  FROM `vmimporteddata.reporting.quote_to_job_completion`
),
parent AS (
  -- the reactive job the quote was raised against, for time-to-quote
  SELECT Job_Number, Date_Logged FROM `vmimporteddata.reporting.jobs`
),
jc AS (
  -- only jobs that actually carry a cost of their own
  SELECT job_number, SUM(total_cost_exvat) AS job_cost, SUM(total_sell_exvat) AS job_sell
  FROM `vmimporteddata.raw.job_costs`
  WHERE total_cost_exvat > 0
  GROUP BY job_number
),
inv AS (
  SELECT JobNumber AS job_number,
         SUM(TotalExcludingVat) AS invoiced,
         COUNT(*)               AS n_invoices,
         MAX(DATE(DateRaised, "Europe/London")) AS last_invoice_date
  FROM `vmimporteddata.raw.invoices`
  WHERE JobNumber IS NOT NULL AND JobNumber != ''
  GROUP BY JobNumber
),
qt AS (
  SELECT quote_number, customer, site, job_type, job_category, owner
  FROM `vmimporteddata.models.quote_tracking`
)
SELECT
  -- ---------- identity ----------
  qc.quote_number                                        AS Quote_Number,
  qc.quote_status                                        AS Quote_Status,
  qc.is_upgraded                                         AS Is_Won,
  qt.customer                                            AS Customer,
  qt.site                                                AS Site,
  qt.job_type                                            AS Job_Type,
  qt.job_category                                        AS Job_Category,
  qt.owner                                               AS Quote_Owner,

  -- ---------- dates (pick your month basis in Looker) ----------
  DATE(qc.date_logged, "Europe/London")                     AS Quote_Date,
  DATE(qc.approved_datetime, "Europe/London")               AS Approved_Date,
  l.completed_date                                       AS Completed_Date,
  i.last_invoice_date                                    AS Last_Invoice_Date,

  -- ---------- cycle times ----------
  -- Time to quote, JobLogic's own clock: parent job raised -> quote raised. System-generated,
  -- so unlike Monday's PM-entered Request/Quoted pair it cannot be back-filled by hand.
  qc.parent_job_number                                   AS Parent_Job_Number,
  DATE_DIFF(DATE(qc.date_logged, "Europe/London"), DATE(pj.Date_Logged), DAY)
                                                         AS Days_Job_To_Quote,
  -- Approval -> delivery. Depends on the INFERRED quote->job link; check Link_Confidence.
  l.days_approval_to_completion                          AS Days_Approval_To_Completion,
  l.link_confidence                                      AS Link_Confidence,

  -- ---------- priced margin (every quote, won or not) ----------
  qc.total_sell_exvat                                    AS Quote_Sell_exVAT,
  qc.total_cost_exvat                                    AS Quote_Cost_exVAT,
  qc.total_sell_exvat - qc.total_cost_exvat              AS Quote_Margin_exVAT,
  SAFE_DIVIDE(qc.total_sell_exvat - qc.total_cost_exvat,
              qc.total_sell_exvat)                       AS Quote_Margin_Pct,

  -- ---------- what happened after it was won ----------
  l.upgraded_job_number                                  AS Job_Number,
  j.job_cost                                             AS Job_Cost_exVAT,
  j.job_cost IS NOT NULL                                 AS Job_Has_Own_Cost,
  -- the job cost is usually the quote cost copied over, so take the greater, never the sum
  GREATEST(qc.total_cost_exvat, IFNULL(j.job_cost, 0))   AS Total_Cost_exVAT,
  -- TRUE => the job figure is just the quote cost restated (within 1%), not new spend
  j.job_cost IS NOT NULL
    AND ABS(j.job_cost - qc.total_cost_exvat) <= 0.01 * GREATEST(qc.total_cost_exvat, 1)
                                                         AS Job_Cost_Duplicates_Quote,
  -- the genuinely NEW spend: only the part above what was quoted (74 quotes, ~12% of costed jobs)
  GREATEST(IFNULL(j.job_cost, 0) - qc.total_cost_exvat, 0)
                                                         AS Overspend_Above_Quote_exVAT,
  i.invoiced                                             AS Invoiced_exVAT,
  IFNULL(i.n_invoices, 0)                                AS N_Invoices,

  -- ---------- realised margin (only where actually invoiced) ----------
  IF(i.invoiced IS NOT NULL,
     i.invoiced - GREATEST(qc.total_cost_exvat, IFNULL(j.job_cost, 0)), NULL)
                                                         AS Realised_Margin_exVAT,
  IF(i.invoiced IS NOT NULL,
     SAFE_DIVIDE(i.invoiced - GREATEST(qc.total_cost_exvat, IFNULL(j.job_cost, 0)), i.invoiced),
     NULL)                                               AS Realised_Margin_Pct,
  -- "delivery cost more than we priced it", as a % of the quoted cost
  SAFE_DIVIDE(GREATEST(IFNULL(j.job_cost, 0) - qc.total_cost_exvat, 0),
              NULLIF(qc.total_cost_exvat, 0))            AS Overspend_Pct,

  -- ---------- cost mix ----------
  qc.cost_material, qc.cost_labour, qc.cost_subcontractor, qc.cost_travel,
  qc.cost_callout, qc.cost_expense, qc.cost_other, qc.cost_sor,
  qc.n_lines                                             AS Quote_Line_Count,
  qc.n_lines_no_cost                                     AS Lines_Missing_Cost,
  qc._ingested_at
FROM qc
LEFT JOIN link l ON l.quote_id   = qc.quote_id
LEFT JOIN parent pj ON pj.Job_Number = qc.parent_job_number
LEFT JOIN jc   j ON j.job_number = l.upgraded_job_number
LEFT JOIN inv  i ON i.job_number = l.upgraded_job_number
LEFT JOIN qt     ON qt.quote_number = qc.quote_number;
