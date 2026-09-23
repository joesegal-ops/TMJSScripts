-- Monday.com friendly layer  (models.monday_*)
--
-- raw.monday_items is deliberately generic: one row per item, every board column carried in the
-- repeated `column_values` struct. That never breaks when someone adds a column in Monday --
-- but it is unpleasant to query. This file pivots it into per-board views with real column names
-- for Looker, plus one long-format view over every board.
--
-- Ingested by load_monday.py (run_monday_load.sh). Re-run this file after a board gains a column
-- you want surfaced; look the column id up in `raw.monday_columns`.
--
--   bq --project_id=vmimporteddata query --use_legacy_sql=false < create_monday_views.sql

-- ---------------------------------------------------------------- helpers

-- Display text of one column ("Complete", "2025-11-07", "12,500", "Joe Segal, Ann Lee").
CREATE OR REPLACE FUNCTION `vmimporteddata.models.monday_text`(
  cvs ARRAY<STRUCT<column_id STRING, title STRING, type STRING, text STRING, value STRING>>,
  col STRING
) AS ((SELECT cv.text FROM UNNEST(cvs) cv WHERE cv.column_id = col LIMIT 1));

-- Raw JSON of one column, as a string — for types whose `text` loses structure
-- (timeline from/to, dropdown ids, status index, board_relation linked ids).
CREATE OR REPLACE FUNCTION `vmimporteddata.models.monday_value`(
  cvs ARRAY<STRUCT<column_id STRING, title STRING, type STRING, text STRING, value STRING>>,
  col STRING
) AS ((SELECT cv.value FROM UNNEST(cvs) cv WHERE cv.column_id = col LIMIT 1));

-- Monday renders empty cells as '' rather than NULL; dates/numbers must go through SAFE_CAST.
CREATE OR REPLACE FUNCTION `vmimporteddata.models.monday_date`(
  cvs ARRAY<STRUCT<column_id STRING, title STRING, type STRING, text STRING, value STRING>>,
  col STRING
) AS (SAFE_CAST(NULLIF((SELECT cv.text FROM UNNEST(cvs) cv WHERE cv.column_id = col LIMIT 1), '') AS DATE));

CREATE OR REPLACE FUNCTION `vmimporteddata.models.monday_number`(
  cvs ARRAY<STRUCT<column_id STRING, title STRING, type STRING, text STRING, value STRING>>,
  col STRING
) AS (SAFE_CAST(NULLIF(REPLACE((SELECT cv.text FROM UNNEST(cvs) cv WHERE cv.column_id = col LIMIT 1), ',', ''), '') AS NUMERIC));

-- ---------------------------------------------------------------- long format (every board)

-- One row per item x column. The escape hatch: use this for boards with no dedicated view,
-- for ad-hoc lookups, and to discover what a column actually holds.
CREATE OR REPLACE VIEW `vmimporteddata.models.monday_item_values` AS
SELECT
  i.board_id, i.board_name, i.item_id, i.item_name,
  i.group_title, i.state, i.parent_item_id,
  i.created_at, i.updated_at,
  cv.column_id, cv.title AS column_title, cv.type AS column_type,
  cv.text, cv.value,
  FORMAT('https://up-fm.monday.com/boards/%s/pulses/%s', i.board_id, i.item_id) AS item_url,
  i._ingested_at
FROM `vmimporteddata.raw.monday_items` i, UNNEST(i.column_values) cv;

-- ---------------------------------------------------------------- Minor Projects - WW Active

CREATE OR REPLACE VIEW `vmimporteddata.models.monday_ww_active` AS
SELECT
  item_id,
  item_name                                                     AS Project,
  group_title                                                   AS Stage,
  state                                                         AS Item_State,
  `vmimporteddata.models.monday_text`(column_values, 'dropdown_Mjj5Knmc')   AS Site,
  `vmimporteddata.models.monday_text`(column_values, 'text_mkyrcb16')      AS Original_Job_Ref,
  `vmimporteddata.models.monday_text`(column_values, 'text_mm5gxah5')      AS Upgraded_Job_Ref,
  `vmimporteddata.models.monday_text`(column_values, 'text__1')            AS Quote,
  `vmimporteddata.models.monday_text`(column_values, 'text_mkxc7pxe')      AS Client_Ref,
  `vmimporteddata.models.monday_text`(column_values, 'text_mky86hyy')      AS PO_Number,
  `vmimporteddata.models.monday_text`(column_values, 'dropdown_mkmm6b5r')  AS Project_Type,
  `vmimporteddata.models.monday_text`(column_values, 'color_mky7yjmx')     AS Client,
  `vmimporteddata.models.monday_text`(column_values, 'status')             AS PM_Stat,
  `vmimporteddata.models.monday_text`(column_values, 'color_mkvy3avs')     AS Finance_Stat,
  `vmimporteddata.models.monday_text`(column_values, 'priority__1')        AS Priority,
  `vmimporteddata.models.monday_text`(column_values, 'person')             AS Lead_PM,
  `vmimporteddata.models.monday_text`(column_values, 'people__1')          AS Support_PM,
  `vmimporteddata.models.monday_text`(column_values, 'dropdown_mkxd1evr')  AS Contractor_Tech,
  `vmimporteddata.models.monday_date`(column_values, 'date4')              AS Due_Date,
  `vmimporteddata.models.monday_date`(column_values, 'date_mkmmk8jc')      AS Project_Request_Date,
  `vmimporteddata.models.monday_date`(column_values, 'date_mkmms34p')      AS Quoted_Date,
  `vmimporteddata.models.monday_date`(column_values, 'date_mkx89wm0')      AS Approved_Date,
  `vmimporteddata.models.monday_date`(column_values, 'date_mkx85tke')      AS Complete_Date,
  SAFE_CAST(JSON_VALUE(`vmimporteddata.models.monday_value`(column_values, 'timeline__1'), '$.from') AS DATE) AS Works_Start,
  SAFE_CAST(JSON_VALUE(`vmimporteddata.models.monday_value`(column_values, 'timeline__1'), '$.to')   AS DATE) AS Works_End,
  `vmimporteddata.models.monday_number`(column_values, 'numbers_mkmkrw8m') AS Cost_Est_exVAT,
  `vmimporteddata.models.monday_number`(column_values, 'numbers_mkmk43k6') AS Price_Est_exVAT,
  `vmimporteddata.models.monday_text`(column_values, 'long_text_mkxpzfx1') AS Notes_Private,
  created_at, updated_at,
  FORMAT('https://up-fm.monday.com/boards/%s/pulses/%s', board_id, item_id) AS item_url,
  _ingested_at
FROM `vmimporteddata.raw.monday_items`
WHERE board_id = '5084790211';

-- ---------------------------------------------------------------- Minor Projects - WW TRIAGE

CREATE OR REPLACE VIEW `vmimporteddata.models.monday_ww_triage` AS
SELECT
  item_id,
  item_name                                                     AS Project,
  group_title                                                   AS Stage,
  state                                                         AS Item_State,
  `vmimporteddata.models.monday_text`(column_values, 'dropdown_Mjj5Knmc')   AS Site,
  `vmimporteddata.models.monday_text`(column_values, 'text_mkyrq1aw')      AS Job_Ref,
  `vmimporteddata.models.monday_text`(column_values, 'text__1')            AS Quote,
  `vmimporteddata.models.monday_text`(column_values, 'text_mkxc7pxe')      AS Client_Ref,
  `vmimporteddata.models.monday_text`(column_values, 'text_mky86hyy')      AS PO_Number,
  `vmimporteddata.models.monday_text`(column_values, 'dropdown_mkmm6b5r')  AS Project_Type,
  `vmimporteddata.models.monday_text`(column_values, 'multiple_person_mkyrfy8c') AS WW_FOM,
  `vmimporteddata.models.monday_text`(column_values, 'color_mky7yjmx')     AS FOM_Conf_Proceed_To_Quote,
  `vmimporteddata.models.monday_text`(column_values, 'status')             AS PM_Stat,
  `vmimporteddata.models.monday_text`(column_values, 'priority__1')        AS Priority,
  `vmimporteddata.models.monday_text`(column_values, 'person')             AS Lead_PM,
  `vmimporteddata.models.monday_text`(column_values, 'people__1')          AS Support_PM,
  `vmimporteddata.models.monday_date`(column_values, 'date4')              AS Req_Due_Date,
  `vmimporteddata.models.monday_date`(column_values, 'date_mkmmk8jc')      AS Project_Inception,
  created_at, updated_at,
  FORMAT('https://up-fm.monday.com/boards/%s/pulses/%s', board_id, item_id) AS item_url,
  _ingested_at
FROM `vmimporteddata.raw.monday_items`
WHERE board_id = '5089125557';

-- ---------------------------------------------------------------- Minor Projects - Other Clients

CREATE OR REPLACE VIEW `vmimporteddata.models.monday_other_clients` AS
SELECT
  item_id,
  item_name                                                     AS Project,
  group_title                                                   AS Stage,
  state                                                         AS Item_State,
  `vmimporteddata.models.monday_text`(column_values, 'dropdown_Mjj5Knmc')   AS Site,
  `vmimporteddata.models.monday_text`(column_values, 'text_mm40s0eh')      AS Job_Ref,
  `vmimporteddata.models.monday_text`(column_values, 'text__1')            AS Quote_Ref,
  `vmimporteddata.models.monday_text`(column_values, 'text_mkxc7pxe')      AS Client_Ref,
  `vmimporteddata.models.monday_text`(column_values, 'dropdown__1')        AS Client,
  `vmimporteddata.models.monday_text`(column_values, 'dropdown_mkmm6b5r')  AS Project_Type,
  `vmimporteddata.models.monday_text`(column_values, 'status')             AS PM_Stat,
  `vmimporteddata.models.monday_text`(column_values, 'color_mkvy3avs')     AS Finance_Stat,
  `vmimporteddata.models.monday_text`(column_values, 'priority__1')        AS Priority,
  `vmimporteddata.models.monday_text`(column_values, 'person')             AS Lead,
  `vmimporteddata.models.monday_text`(column_values, 'people__1')          AS Support,
  `vmimporteddata.models.monday_text`(column_values, 'dropdown_mkxd1evr')  AS Tech_Contractor,
  `vmimporteddata.models.monday_date`(column_values, 'date4')              AS Due_Date,
  `vmimporteddata.models.monday_date`(column_values, 'date_mkmmk8jc')      AS Project_Inception,
  `vmimporteddata.models.monday_date`(column_values, 'date_mkmms34p')      AS Quoted_Date,
  `vmimporteddata.models.monday_date`(column_values, 'date_mkx89wm0')      AS Approved_Date,
  `vmimporteddata.models.monday_date`(column_values, 'date_mkx85tke')      AS Complete_Date,
  SAFE_CAST(JSON_VALUE(`vmimporteddata.models.monday_value`(column_values, 'timeline__1'), '$.from') AS DATE) AS Works_Start,
  SAFE_CAST(JSON_VALUE(`vmimporteddata.models.monday_value`(column_values, 'timeline__1'), '$.to')   AS DATE) AS Works_End,
  `vmimporteddata.models.monday_number`(column_values, 'numbers_mkmkrw8m') AS Cost_Est_exVAT,
  `vmimporteddata.models.monday_number`(column_values, 'numbers_mkmk43k6') AS Price_Est_exVAT,
  created_at, updated_at,
  FORMAT('https://up-fm.monday.com/boards/%s/pulses/%s', board_id, item_id) AS item_url,
  _ingested_at
FROM `vmimporteddata.raw.monday_items`
WHERE board_id = '1728757109';

-- ---------------------------------------------------------------- Members' logos Wework

CREATE OR REPLACE VIEW `vmimporteddata.models.monday_members_logos` AS
SELECT
  item_id,
  item_name                                                     AS Request,
  group_title                                                   AS Stage,
  state                                                         AS Item_State,
  `vmimporteddata.models.monday_text`(column_values, 'dropdown_mkxtdfay')  AS Site,
  `vmimporteddata.models.monday_text`(column_values, 'short_texttgw2o656') AS Office_Number,
  `vmimporteddata.models.monday_text`(column_values, 'short_text1yjshdf2') AS Member_Name,
  `vmimporteddata.models.monday_text`(column_values, 'short_textwfvun3si') AS Community_Member_Name,
  `vmimporteddata.models.monday_text`(column_values, 'text_mkz5518j')      AS UP_Ref_Number,
  `vmimporteddata.models.monday_text`(column_values, 'text_mm15kkjr')      AS PO_Number,
  `vmimporteddata.models.monday_text`(column_values, 'color_mkxpqdhg')     AS Status,
  `vmimporteddata.models.monday_text`(column_values, 'color_mm0ahj9a')     AS Financial_Status,
  `vmimporteddata.models.monday_text`(column_values, 'single_select2dyoprb') AS WeWork_Of_Member_Paid,
  `vmimporteddata.models.monday_number`(column_values, 'numbers5sb2pe8')   AS Quantity_Required,
  `vmimporteddata.models.monday_number`(column_values, 'numberrnlyfzxd')   AS SF_Ticket_Number,
  `vmimporteddata.models.monday_text`(column_values, 'emailujhi0qha')      AS Contact_Email,
  `vmimporteddata.models.monday_text`(column_values, 'long_textgsrwymmp')  AS Additional_Information,
  `vmimporteddata.models.monday_text`(column_values, 'pulse_log_mky16syk') AS Date_Logged_Text,
  created_at, updated_at,
  FORMAT('https://up-fm.monday.com/boards/%s/pulses/%s', board_id, item_id) AS item_url,
  _ingested_at
FROM `vmimporteddata.raw.monday_items`
WHERE board_id = '5085864777';
