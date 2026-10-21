-- Cost Tracker: BigQuery port of the LET/HSTACK formula in "WW - Cost Tracker - Working File"
-- ('All Jobs' tab), for ALL customers -- filter on Customer when you pull it.
-- One row per job with TotalJobSell > 0 that isn't Cancelled. Columns follow the 'All Jobs' tab order.
--
-- Site / category names: mapped via JobLogic.WW_Site_Mapping and JobLogic.WW_Category_Mapping
-- (static copies of the Sheet's Mapping tab). Unmapped sites keep the Joblogic name; JL_Site has the original.
--
-- Left to the Sheet:
--   * LastInvoiceDate cut-off (INPUTS!B1). The formula's "To Invoice" was:
--       IF(Invoice_Date > LastInvoiceDate, Latest_Invoice_Amount (or Sell_Price if none), Outstanding)
--     Outstanding (= Sell_Price - Invoiced_Amount) and both inputs are columns here.
--
-- Differences from the formula (deliberate):
--   * Latest_Invoice_Amount = value on the most recent invoice. The formula took the FIRST
--     Pending Costs row for the job, which is only the latest by luck of sort order.
--   * Requested_by falls back to the Salesforce Member Name from Salesforce.support_requests_clean
--     (was the SFExport tab).
CREATE OR REPLACE VIEW `importdata-494110.JobLogic.Cost_Tracker`
OPTIONS (description = 'Per-job cost tracker (port of the WW Cost Tracker LET formula), all customers. Filter on Customer.')
AS
WITH jobs AS (
  SELECT *
  FROM `importdata-494110.JobLogic.All_in_Job_clean`
  WHERE TotalJobSell > 0
    AND IFNULL(Job_Status, '') != 'Cancelled'
),
-- Pending Costs can hold several rows per job (one per invoice): roll up to one row per job.
pc AS (
  SELECT
    Job_Number,
    MAX(InvoiceDate)                                                   AS Latest_Invoice_Date,
    SUM(Invoice_Value)                                                 AS Invoiced_Amount,
    ARRAY_AGG(Invoice_Value IGNORE NULLS ORDER BY InvoiceDate DESC LIMIT 1)[SAFE_OFFSET(0)] AS Latest_Invoice_Amount,
    STRING_AGG(
      IF(REGEXP_CONTAINS(Invoice_Number, r'^\d+$'), LPAD(Invoice_Number, 6, '0'), NULLIF(Invoice_Number, '')),
      '; ' ORDER BY InvoiceDate) AS Vendor_Invoice_Number,
    -- Single-value fields: take them from one row (all rows of a job share them)
    ANY_VALUE(Job_Reference)        AS Job_Reference,
    ANY_VALUE(Order_Number)         AS PC_Order_Number,
    ANY_VALUE(First_Engineer)       AS First_Engineer,
    ANY_VALUE(Job_Ref_1)            AS Job_Ref_1,
    ANY_VALUE(Parent_Quote_Contact) AS Parent_Quote_Contact
  FROM `importdata-494110.JobLogic.Pending_Costs_clean`
  GROUP BY Job_Number
),
base AS (
  SELECT
    j.*,
    pc.* EXCEPT (Job_Number),
    -- Salesforce ticket: 8-digit number starting 11, from Job_Reference else Order_Number
    COALESCE(REGEXP_EXTRACT(pc.Job_Reference, r'11\d{6}'),
             REGEXP_EXTRACT(pc.PC_Order_Number, r'11\d{6}')) AS SF_Ticket
  FROM jobs j
  LEFT JOIN pc ON pc.Job_Number = j.ID
)
SELECT
  b.ID                                                             AS JOB_NUMBER,
  b.Customer                                                       AS Customer,
  DATE(b.Latest_Invoice_Date)                                      AS Invoice_Date,
  COALESCE(ms.WW_Site, b.Site)                                     AS Site,
  b.Site                                                           AS JL_Site,
  COALESCE(NULLIF(b.Job_Ref_1, ''), sf.Member_Name)                AS Requested_by,
  b.Parent_Quote_Contact                                           AS Parent_Quote,
  COALESCE(mc.WW_Category, 'Other')                                AS Category,
  b.Job_Category                                                   AS Job_Category,
  b.TotalJobSell - IFNULL(b.Invoiced_Amount, 0)                    AS Outstanding_Amount,
  b.TotalJobSell                                                   AS Sell_Price,
  IFNULL(b.Invoiced_Amount, 0)                                     AS Invoiced_Amount,
  b.Latest_Invoice_Amount                                          AS Latest_Invoice_Amount,
  'GBP'                                                            AS Currency,
  b.SF_Ticket                                                      AS Salesforce_Ticket,
  -- As the Sheet: multi-line -> first line TRIM()med (squashes double spaces); single line -> as is. Quotes removed.
  REPLACE(IF(STRPOS(b.Description, '\n') > 0,
             REGEXP_REPLACE(TRIM(SPLIT(b.Description, '\n')[SAFE_OFFSET(0)]), r' {2,}', ' '),
             b.Description), '"', '')                             AS Description,
  CASE
    WHEN b.Open_Closed_Job = 'OPEN' THEN 'OPEN'
    WHEN b.DateComplete IS NULL THEN ''
    ELSE FORMAT_DATE('%d - %b - %Y', CAST(b.DateComplete AS DATE))
  END                                                              AS Completion_date,
  CONCAT(b.Job_Type, IF(b.First_Engineer IS NULL, '', CONCAT(': ', b.First_Engineer))) AS Comments,
  -- Case-insensitive, like the Sheet's LEFT(...)="REQ"
  IF(STARTS_WITH(UPPER(b.Order_Number), 'REQ'), b.Order_Number, '') AS REQ_Number,
  IF(STARTS_WITH(UPPER(b.Order_Number), 'PO'),  b.Order_Number, '') AS PO_Number,
  IFNULL(b.Vendor_Invoice_Number, '')                              AS Vendor_Invoice_Number,
  b.Job_Type                                                       AS Job_Type,
  b.Open_Closed_Job                                                AS Status,
  b.Latest_Invoice_Date                                            AS Invoice_DateTime,
  b.Date_Logged                                                    AS Date_Logged
FROM base b
LEFT JOIN `importdata-494110.JobLogic.WW_Site_Mapping` ms ON ms.UP_Site = b.Site
LEFT JOIN `importdata-494110.JobLogic.WW_Category_Mapping` mc ON mc.UP_Category = b.Job_Category
LEFT JOIN (
  SELECT Support_Request_Number, ANY_VALUE(Member_Name) AS Member_Name
  FROM `importdata-494110.Salesforce.support_requests_clean`
  GROUP BY Support_Request_Number
) sf ON sf.Support_Request_Number = SAFE_CAST(b.SF_Ticket AS INT64);

-- 'All Jobs' layout: exactly the A:X columns the WW Cost Tracker's 'All Jobs' tab had (incl. the
-- blank spacer columns G, H, R, U), so 'SORTED All Jobs' and everything downstream works unchanged.
-- Extra columns after X: Date_Logged (for 'Grouped Invoice List'!Y) and Customer (to filter on).
-- To_Invoice applies the LastInvoiceDate rule (sum of invoices after the cut-off), so the cut-off is a parameter. Connected Sheets:
--   SELECT * FROM `importdata-494110.JobLogic.Cost_Tracker_All_Jobs`(PARSE_DATE('%Y-%m-%d', @LastInvoiceDate))
--   WHERE Customer = 'WeWork Ltd' ORDER BY JOB_NUMBER
-- with @LastInvoiceDate bound to a cell holding =TEXT(LastInvoiceDate,"yyyy-mm-dd").
CREATE OR REPLACE TABLE FUNCTION `importdata-494110.JobLogic.Cost_Tracker_All_Jobs`(last_invoice_date DATE)
OPTIONS (description = "WW Cost Tracker 'All Jobs' tab layout (A:X) for all customers; arg = Date of Last Invoice")
AS (
SELECT
  JOB_NUMBER,
  Invoice_DateTime                                                 AS Invoice_Date,
  Site,
  IFNULL(Requested_by, '')                                         AS Requested_by,
  IFNULL(Parent_Quote, '')                                         AS Parent_Quote,
  Category                                                         AS Approved_by,
  ''                                                               AS Category_Type_of_Cost,
  ''                                                               AS Location,
  -- Invoiced after the cut-off -> total billed (invoices + credits) after the cut-off;
  -- otherwise the outstanding balance. (The old Sheet used the first Pending Costs row instead.)
  IF(Invoice_DateTime > DATETIME(last_invoice_date),
     IFNULL(ac.Invoiced_After_Cutoff, Sell_Price),
     Outstanding_Amount)                                           AS To_Invoice,
  Sell_Price,
  Invoiced_Amount,
  Latest_Invoice_Amount,
  Currency,
  IFNULL(Salesforce_Ticket, '')                                    AS Salesforce_Ticket,
  Description,
  Completion_date,
  Comments,
  ''                                                               AS Special_Cost,
  REQ_Number,
  PO_Number,
  ''                                                               AS SINV_Number,
  Vendor_Invoice_Number,
  Job_Type,
  Status,
  Date_Logged,
  Customer
FROM `importdata-494110.JobLogic.Cost_Tracker` ct
LEFT JOIN (
  SELECT Job_Number AS AC_Job, SUM(Invoice_Value) AS Invoiced_After_Cutoff
  FROM `importdata-494110.JobLogic.Pending_Costs_clean`
  WHERE InvoiceDate > DATETIME(last_invoice_date)
  GROUP BY Job_Number
) ac ON ac.AC_Job = ct.JOB_NUMBER
);
