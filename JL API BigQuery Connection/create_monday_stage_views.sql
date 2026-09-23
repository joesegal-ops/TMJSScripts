-- Monday time-in-stage, reconstructed from the activity log (raw.monday_activity).
--
--   models.monday_stage_history  1 row per item x stage spell (entered, left, days)
--   models.monday_stage_summary  1 row per item (days to first move, stage changes, current dwell)
--
-- Rebuild:  bq --project_id=vmimporteddata query --use_legacy_sql=false < create_monday_stage_views.sql
--
-- RETENTION HEALTH WARNING. Monday only serves ~10 months of activity, so for any item created
-- before this table started capturing, the moves we hold are not its whole life: we know which
-- stage it was in before the first move we saw, but not when it entered that stage, nor how many
-- moves happened earlier. Those rows carry Start_Is_Estimated / History_Is_Complete = FALSE.
-- FILTER ON THEM before quoting an average, or the oldest projects will look like they sat in one
-- stage since the day they were created.

CREATE OR REPLACE VIEW `vmimporteddata.models.monday_stage_history` AS
WITH moves AS (
  SELECT board_id, item_id, created_at AS moved_at, from_group_title, to_group_title
  FROM `vmimporteddata.raw.monday_activity`
  WHERE event = "move_pulse_from_group"
    AND item_id IS NOT NULL AND created_at IS NOT NULL
    AND IFNULL(is_undo, FALSE) = FALSE          -- an undone move never really happened
),
seq AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY moved_at) AS rn,
    LEAD(moved_at)  OVER (PARTITION BY item_id ORDER BY moved_at) AS next_moved_at
  FROM moves
),
items AS (
  SELECT board_id, board_name, item_id, item_name, group_title AS current_group,
         created_at AS item_created_at, state
  FROM `vmimporteddata.raw.monday_items`
),
-- Oldest activity we hold per board = the retention floor. Anything older is unobservable.
floors AS (
  SELECT board_id, MIN(created_at) AS retention_floor
  FROM `vmimporteddata.raw.monday_activity`
  GROUP BY board_id
),
spell_rows AS (
  -- the stage the item sat in BEFORE its first recorded move
  SELECT s.board_id, s.item_id, 0 AS spell_no, s.from_group_title AS stage,
         i.item_created_at AS entered_at, s.moved_at AS left_at
  FROM seq s
  LEFT JOIN items i ON i.item_id = s.item_id
  WHERE s.rn = 1

  UNION ALL
  -- every stage entered by an observed move
  SELECT s.board_id, s.item_id, s.rn, s.to_group_title, s.moved_at, s.next_moved_at
  FROM seq s

  UNION ALL
  -- items that have never moved: one open spell in their current group
  SELECT i.board_id, i.item_id, 0, i.current_group, i.item_created_at, NULL
  FROM items i
  WHERE NOT EXISTS (SELECT 1 FROM moves m WHERE m.item_id = i.item_id)
)
SELECT
  IFNULL(i.board_name, r.board_id)                              AS Board,
  r.item_id                                                     AS Item_Id,
  i.item_name                                                   AS Item,
  r.spell_no                                                    AS Spell_No,
  r.stage                                                       AS Stage,
  r.entered_at                                                  AS Entered_At,
  r.left_at                                                     AS Left_At,
  r.left_at IS NULL                                             AS Is_Current_Stage,
  ROUND(TIMESTAMP_DIFF(IFNULL(r.left_at, CURRENT_TIMESTAMP()), r.entered_at, HOUR) / 24.0, 2)
                                                                AS Days_In_Stage,
  -- TRUE => entered_at is the item's creation date but the item predates our activity history,
  -- so earlier moves may have gone unrecorded and this dwell time is an UPPER BOUND.
  r.spell_no = 0 AND i.item_created_at < f.retention_floor      AS Start_Is_Estimated,
  i.item_created_at                                             AS Item_Created_At,
  i.state                                                       AS Item_State,
  FORMAT("https://up-fm.monday.com/boards/%s/pulses/%s", r.board_id, r.item_id) AS Item_URL
FROM spell_rows r
LEFT JOIN items  i ON i.item_id  = r.item_id
LEFT JOIN floors f ON f.board_id = r.board_id;


CREATE OR REPLACE VIEW `vmimporteddata.models.monday_stage_summary` AS
WITH moves AS (
  SELECT board_id, item_id, created_at AS moved_at, to_group_title
  FROM `vmimporteddata.raw.monday_activity`
  WHERE event = "move_pulse_from_group"
    AND item_id IS NOT NULL AND created_at IS NOT NULL
    AND IFNULL(is_undo, FALSE) = FALSE
),
floors AS (
  SELECT board_id, MIN(created_at) AS retention_floor
  FROM `vmimporteddata.raw.monday_activity`
  GROUP BY board_id
),
agg AS (
  SELECT item_id,
         COUNT(*)        AS Stage_Changes,
         MIN(moved_at)   AS First_Move_At,
         MAX(moved_at)   AS Last_Move_At
  FROM moves GROUP BY item_id
)
SELECT
  i.board_name                                                  AS Board,
  i.item_id                                                     AS Item_Id,
  i.item_name                                                   AS Item,
  i.group_title                                                 AS Current_Stage,
  i.created_at                                                  AS Item_Created_At,
  IFNULL(a.Stage_Changes, 0)                                    AS Stage_Changes,
  a.First_Move_At,
  a.Last_Move_At,
  -- The headline: how long an item sat before anyone advanced it.
  -- Only meaningful when the item's whole life is inside our activity history.
  IF(i.created_at >= f.retention_floor,
     ROUND(TIMESTAMP_DIFF(a.First_Move_At, i.created_at, HOUR) / 24.0, 2), NULL)
                                                                AS Days_To_First_Move,
  ROUND(TIMESTAMP_DIFF(CURRENT_TIMESTAMP(),
                       IFNULL(a.Last_Move_At, i.created_at), HOUR) / 24.0, 2)
                                                                AS Days_In_Current_Stage,
  IFNULL(a.Last_Move_At, i.created_at)                          AS Current_Stage_Entered_At,
  -- FALSE => the item predates our activity history; Stage_Changes and Days_To_First_Move
  -- are incomplete for it. Filter on this before averaging.
  i.created_at >= f.retention_floor                             AS History_Is_Complete,
  f.retention_floor                                             AS Board_History_Starts,
  i.state                                                       AS Item_State,
  FORMAT("https://up-fm.monday.com/boards/%s/pulses/%s", i.board_id, i.item_id) AS Item_URL
FROM `vmimporteddata.raw.monday_items` i
LEFT JOIN agg    a ON a.item_id  = i.item_id
LEFT JOIN floors f ON f.board_id = i.board_id;
