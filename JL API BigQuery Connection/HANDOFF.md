# Handoff — Joblogic → BigQuery warehouse (2026-07-20)

## Context
Building an API-driven BigQuery warehouse from Joblogic to replace the old email-fed reports.
- **New warehouse: GCP project `vmimporteddata`, all datasets EU** (`raw`, `models`, `reporting`).
- **Old project `importdata-494110.JobLogic` (US)** = legacy email pipeline being retired. Only ever read as a one-time reference. Don't build there.
- Loader VM: `jl-loader` (zone europe-west2-a, project vmimporteddata). Durable loader at `/opt/jl-loader`; cron at `/etc/cron.d/jl-loader` (CRON_TZ Europe/London). Secrets in Secret Manager (jl-client-id/-secret/-tenant-id).
- Full project context + gotchas: memory file `~/.claude/projects/-Users-joesegal-Documents-Claude-Code/memory/jl-api-bq-warehouse.md`. Project folder: `~/Documents/Claude Code/JL API BigQuery Connection/`.

## AUTH GOTCHA (important)
gcloud/bq user OAuth token is expired ("Reauthentication failed", non-interactive). Workaround used all session:
`export CLOUDSDK_AUTH_ACCESS_TOKEN=$(gcloud auth application-default print-access-token)` before any `bq`/`gcloud`.
**Fix properly: run `gcloud auth login`.** IAP SSH is flaky (255 on long cmds) — keep SSH commands short; for long jobs use `setsid ... &` detached + poll.

## What was built this session
- **Notes:** `models.notes` (granular, 1 row/note) + `Job_Notes`/`Engineer_Notes` wired into `models.job_and_visit_details_enriched` (per-visit granularity). raw.notes=61,585, raw.visits=40,218.
- **`reporting.jobs`** (NEW `reporting` dataset, job grain, 34,714 rows) — clean jobs for the Looker dashboard: friendly names + Open_Closed (status-based: Completed/Invoiced/Costed/Cancelled=Closed), Is_Open, Age_Days, Response_Hours (DateJobAttended−DateLogged), Job_URL (`https://go.joblogic.com/Job/Detail/{Id}`), and notes (Job_Notes, Engineer_Notes, Last_Note/Date/By, counts).
- **`models.all_in_job`** (job grain, PARTIAL) — job fields + Visit_Notes populated; 5 money cols + 2 service cols are NULL placeholders pending the cost pass.
- **`models.avg_visits_per_job`** — port of the old report.
- **Quotes: job_type / job_category / date_rejected** now in `models.quote_tracking` (job_type 100% populated). Backfilled from `Quote/GetById` → `raw.quote_types`; code→name via static EU tables `raw.quote_jobtype_map` (D=Reactive,E=Project,M=Maintenance,R=Repair) + `raw.job_category_map` (58 T-codes). date_rejected via CDC table `raw.quote_status_events`.
- **Cron added:** quote_types incr daily 02:55, full Sun 05:00; quote status CDC daily 03:10.

## Reproducible SQL/scripts (in project folder)
`create_models.sql` (models layer, source of truth), `create_reporting.sql` (reporting.jobs), `create_quote_maps.sql` (static code maps), `load_quote_types.py` + `run_quote_types.sh` (quote type backfill), `quote_status_cdc.sql` + `run_quote_cdc.sh` (status CDC), `load_notes_full.py` (notes backfill, done).

## SWEDISH COMPANY (added 2026-07-21) — replicate the warehouse for the SE tenant
- SE is a separate Joblogic tenant on the **same host**. **TenantId `c61c1df0-a34a-49fd-a440-e8acf2bbc3ad`.**
- Tested UK client creds vs SE tenant => **403** (UK client is tenant-scoped). => SE needs its own API
  client (or the UK client authorised for both) + IP `8.228.52.239` whitelisted. **BLOCKED on Joblogic.**
- **Done (infra ready):** EU dataset `sweden_raw` (BQ forbids hyphens, so not "sweden-raw"); secrets
  `jl-se-tenant-id` (populated), `jl-se-client-id`/`jl-se-client-secret` (empty placeholders); VM wrappers
  `run_tier_se.sh` + `run_incremental_se.sh` (override BQ_DATASET=sweden_raw, pull jl-se-* secrets — loader.py
  needed no code change). SA already writes sweden_raw (project-level BQ roles).
- **Next (once creds land):** send `joblogic-sweden-api-request.md`; then add the 2 secret versions, smoke
  test `run_tier_se.sh "Customer/GetAll:customers"`, backfill all entities, add staggered SE cron, build
  `sweden_models`/`sweden_reporting`. Post-reply runbook is in `joblogic-sweden-api-request.md`.

## Quote job_type outage — fixed 2026-09-22
`raw.quotes.JobType` is **always null** (the `Quote/GetAll` LIST endpoint doesn't return it) — read
`models.quote_tracking.job_type` instead. That had been null for 721 quotes (18.6%) since 2026-07-20:

- `load_quote_types.py` wrote to a fixed `/tmp/quote_types.jsonl`. The VM has `fs.protected_regular=2`,
  which blocks re-opening a file in sticky `/tmp` owned by another user **including as root** — so the
  manual 20 Jul backfill (run as `joe_segal_up_fm_com`) poisoned every later root cron run with EACCES.
  Seven nightly crashes, all silent. Now uses a private `tempfile.mkstemp` path.
- The cron lines were then lost entirely on 2026-07-28 when `/etc/cron.d/jl-loader` was redeployed from
  this repo's `jl-loader.cron`, which never contained them. Restored (incr 02:55 daily, full 07:00 Sun,
  CDC 03:10 daily). **`jl-loader.cron` is the deploy source — always `diff` it against the live VM file
  before installing.** It had also drifted the other way: the repo copy was missing the whole SE block.
- Backfilled 721 quotes; `job_type` is 100% populated again. CDC reseeded (829 rows) — 9 quotes that were
  rejected during the gap carry an approximate `date_rejected` of 2026-09-22.
- **Failure mail:** every cron job now runs via `jl-run.sh <label> <cmd>`, which keeps the full transcript
  in `loader.log` and re-emits a 40-line tail on stderr when a job exits non-zero, so cron mails
  `MAILTO=joe.segal@up-fm.com` **only on failure**. Transport is `msmtp` -> `smtp-relay.gmail.com:587`
  (`/etc/msmtprc`, no credentials — authenticates by source IP).
  **Mail is PARKED** (Joe, 2026-09-22): the relay rejects with `421-4.7.0` until `8.228.52.239` is
  allowlisted in Workspace admin (Apps > Google Workspace > Gmail > Routing > SMTP relay service).
  Nothing else is needed — msmtp and `MAILTO` are configured and mail starts flowing the moment that
  IP is allowlisted. **Until then, failures are caught by the log marker, not by mail:**
  `grep "jl-loader FAILED" /opt/jl-loader/loader.log` — the wrapper writes a timestamped banner there
  on every non-zero exit.

## Monday.com -> BigQuery ingest — built 2026-09-22
Until now every Monday integration in this folder was **one-way (JL -> Monday)**. This is the
reverse leg: Monday board data landing in the warehouse so projects can be reported alongside JL.

- **`load_monday.py`** (+ `run_monday_load.sh`) — GraphQL -> `raw`, full WRITE_TRUNCATE snapshot per
  run, same contract as `loader.py`. Reads the `monday-token` secret (the `jl-loader` SA already
  has `secretAccessor` on it). ~4,809 items in ~2 min.
- **Generic by design.** `raw.monday_items` is 1 row/item with every board column in a repeated
  `column_values` STRUCT<column_id, title, type, text, value>, so **adding a column in Monday never
  breaks the load**. `text` = Monday's display rendering, `value` = raw JSON as a string.
  Plus `raw.monday_boards` (14 rows, incl. groups[]) and `raw.monday_columns` (186 rows).
- **`create_monday_views.sql`** does the per-board pivot into `models`: `monday_ww_active` (2,812),
  `monday_ww_triage` (573), `monday_other_clients` (502), `monday_members_logos` (636), plus
  `monday_item_values` — the long-format escape hatch over *every* board (106k item x column rows).
  Four SQL UDFs (`models.monday_text/_value/_date/_number`) keep the views readable; the date/number
  ones handle Monday returning `''` rather than NULL for empty cells.
- **Boards loaded:** the Projects Team set — WW Active, WW TRIAGE, Other Clients, NEKO,
  Members' logos, Pending WW Jobs, LOGOs-WW + their 7 subitem boards. Subitem boards are ordinary
  boards to the API; their rows carry `parent_item_id`. Override with `MONDAY_BOARDS=...`.
- **Cron:** `50 */3 * * *` (flock'd), 5 min after the existing quote->Monday sync so the snapshot
  includes that run's writes. Verified live on the VM: all 14 boards ok, every board matching its
  own `items_count` exactly.

### Gotchas found
- **Page size 100, not 500.** Monday bills query *complexity*, not requests: a page costs
  ~N x (columns on the board). `sync_monday.py` gets away with 500 because it reads 3 columns;
  these boards have up to 26.
- **A partial sweep must not load.** WRITE_TRUNCATE on a snapshot that's missing a board would
  silently delete that board's rows, so the loader aborts the `monday_items` load (exit 1 -> cron
  failure mail) if *any* board errored. Metadata loads independently.
- `items_page` returns only non-archived, non-deleted items. Archived work is simply absent.
- Monday account slug is `up-fm`; item URL = `https://up-fm.monday.com/boards/{board_id}/pulses/{item_id}`
  (built into every view as `item_url`).

### Join quality to JobLogic (WW Active, measured)
`Original_Job_Ref` -> `raw.jobs.JobNumber`: **1,478 / 1,565 (94%)**. `Upgraded_Job_Ref`: **389 / 390**.
`Quote` -> `raw.quotes.QuoteNumber`: 1,571 / 2,445 exact — the rest are multi-quote or free-text
cells (`sync_monday.py`'s `canon()` / `extract_quotes()` already handle that shape; reuse it).

**Not built (deliberate):** item updates/comments. (`reporting.projects` — the joined view — was
built straight after; see the next section.)

## `reporting.projects` — Monday items x JL jobs/quotes — built 2026-09-22
One row per Monday item across the three project boards (WW Active 2,812 / WW TRIAGE 573 /
Other Clients 502), with a `Board` column. The projects counterpart to `reporting.jobs`.
Source: `create_reporting_projects.sql`. Joins JL job (via job ref), JL upgraded job, and quotes.

**Quote linking is two-way on purpose.** (a) JL-authoritative: `raw.quotes.ParentJobStringId` =
the item's job ref. (b) Monday-typed: UP-numbers parsed out of the Quote cell (zero-padding
tolerant, same rule as `sync_monday.py`'s `canon()`). The union is the quote set; the disagreement
is exposed as `Quotes_Missing_From_Monday` (142 on WW Active — JL raised a quote nobody logged on
the board), `Quotes_Only_On_Monday`, and `Quotes_Not_Found_In_JL` (5 — genuine typos).

### Two independent "time to quote" measures — they disagree, and that is informative
| | source | n (WW Active) | median | avg | p90 |
|---|---|---|---|---|---|
| `Days_Request_To_Quoted` | Monday `Quoted` - `Project Request` | 2,114 | **1 d** | 8.1 | 24 |
| `JL_Days_Job_To_First_Quote` | JL job `Date_Logged` -> quote `date_logged` | 478 | **8 d** | 19.3 | - |

The Monday pair is PM-entered and covers 75% of the board, but **47% of it is same-day** (992 of
2,114) and 34 rows are negative — consistent with PMs filling both dates at once when logging an
item retrospectively. The JL pair is system-generated and unfalsifiable but only covers items with
a genuine parent-job link. `Quoted_Date_Vs_JL_Quote_Days` puts the two side by side per item.
Treat the Monday measure as "PM's recorded turnaround" and the JL one as "elapsed calendar time".

### TRAP: "Original Job Ref" often holds the UPGRADED job (749 items on WW Active)
`raw.jobs.HasParent` = TRUE means the job was created *from* a quote. When the board's Original Job
Ref cell holds one of those, the quote predates the job and any job->quote duration goes **negative**
(618 of 620 negatives in the first cut of this view). The spec warned about this — historically the
single job-ref column held whatever users typed. Fixes now baked in:
- durations use **only path-(a) quotes** (`First_Linked_Quote_Date`), never a quote reached via the
  Monday cell, whose parent is usually a different job;
- `Job_Ref_Is_Child_Job` exposes the mislabelled cells;
- the reconciliation counters are **NULL, not 0**, when the item has no resolvable JL job — otherwise
  "only on Monday" just counts every quote on every unlinked item (494 of them).

### NOTE: `CRON_TZ=Europe/London` is not actually taking effect (observed 2026-09-22)
The schedule runs on **UTC**, not London. Evidence: the `35 */3` purchaseorder line fired at
06:35, 09:35, 12:35 and 15:35 **UTC**; under CRON_TZ those would be 05:35/08:35/11:35/14:35 UTC
(BST = UTC+1). The SE `50 5` and `0 6` lines match UTC too. So in summer every job runs an hour
earlier in UK local time than this file reads, and the `7-19 * * 1-5` business-hours windows are
really 08:00-20:00 UK. Pre-existing and harmless, but the header line of this handoff (and the
cron file) claim otherwise. Don't "fix" it without deciding — it shifts every job by an hour.

Also in the log: `jl-loader FAILED: deploytest (exit 7) -- cmd: sh -c exit 7` at 2026-09-22T14:54Z
is a deliberate test of the failure-mail wrapper, not a real failure.

### Group-move history (time-in-stage) — BUILT 2026-09-23
`load_monday_activity.py` / `run_monday_activity.sh` -> **`raw.monday_activity`**, pivoted by
`create_monday_stage_views.sql` into `models.monday_stage_history` (1 row per item x stage spell)
and `models.monday_stage_summary` (1 row per item). Cron `55 */3`.

- **APPEND + MERGE on `event_id`, never a truncate-snapshot.** Monday serves only ~10 months of
  activity, so this table is the *only* copy of anything older — it must accumulate. Partitioned on
  `created_at`, clustered board/event/item.
- **Backfilled 2026-09-23: 91,255 events, 6,919 group moves.** WW Active 57,090 (4,457 moves),
  TRIAGE 16,532, Other Clients 7,233, Members' logos 5,476 (1,343 moves), Pending WW Jobs 4,229.
- Stores **all** event types, not just moves — we have to page through them anyway (the API has no
  event-type filter), and `update_column_value` rows answer "when did PM Stat change / when was the
  Quoted date really filled in" for free.
- Incremental mode re-pulls a **12h window every 3h**. Deliberately over-wide: re-fetching an event
  is free (the MERGE dedupes — verified, 84 fetched -> 1 new on the VM), missing one loses a stage
  transition permanently.
- Backfill windows are monthly with paging inside, so it is restartable and never deep-pages.

### Reading the stage numbers — the retention caveat is load-bearing
Activity starts ~2025-11-10 on WW Active, but the board holds items from 2024-11-20. For an item
created before that floor we know *which* stage it sat in before its first observed move, but not
when it entered, nor how many moves came earlier. Two flags carry this:
- `monday_stage_summary.History_Is_Complete` — FALSE for items predating the floor. **Filter on it
  before averaging**, or old projects look like they sat in one stage since creation.
- `monday_stage_history.Start_Is_Estimated` — that spell's dwell time is an UPPER BOUND.

Days-to-first-move, complete-history items only:
| board | items w/ full history | median | avg | p90 |
|---|---|---|---|---|
| WW Active | 1,770 / 2,813 | **4.8 d** | 13.2 | 39.3 |
| Members' logos | 636 / 636 | 4.1 d | 5.4 | 7.0 |
| WW TRIAGE | 552 / 573 | 4.0 d | 9.8 | 29.0 |
| Other Clients | 165 / 502 | 5.2 d | 28.8 | 90.0 |

`reporting.projects` now also carries `Days_To_First_Move`, `Stage_Changes`,
`Days_In_Current_Stage`, `Current_Stage_Entered_At`, `Stage_History_Complete`.
Undone moves (`is_undo`) are excluded from both views — the board's automations do generate them.

## Open TODOs / next steps
0. **JobCost cost pass — PARKED** by Joe ("don't need it for now"). Reverse-engineered formulas saved in the
   memory file if resumed (JobCost endpoint uses job UniqueId GUID; TotalQuoteSell=jobs.QuotedValue is free;
   PO adjustment + Service cols are constants 0/false in legacy; only the ~34k JobCost backfill is real work).
1. **`all_in_job` FULL pass** — backfill the JobCost endpoint (confirm swagger shape first: `GET /api/v1/Quote/GetCosts` exists; find the JobCost equivalent) to fill TotalJobCost/TotalJobSell; quote cost/sell via UNNEST(quotes.Lines); PurchaseOrderAdjustment via UNNEST(purchase_orders.Lines). Also pending_costs + cost_line_items models.
2. **Quote category** ~1,025 quotes have null category (genuine API gap — no category set on the quote), not a mapping miss.
3. **date_rejected** — the 105 already-rejected quotes are seeded at approx = 2026-07-20; only rejections from now on are exact.
4. **Looker** — make Job_Number a link via calculated field `HYPERLINK(Job_URL, Job_Number)`.
5. ~~Job type map has only D/E/M/R~~ **DONE 2026-09-22:** `J` = **Out of Hours** (confirmed by Joe) added
   to `raw.quote_jobtype_map`, so all 5 codes (D/E/M/R/J) resolve to names and no quote shows a raw code.
   Any future new type will surface the same way — as a bare letter in `models.quote_tracking.job_type`.
6. This session ran as the (now-disabled) scheduled task `build-jl-note-models`, so it isn't in the normal sidebar — hence this handoff.

## Key API facts
- List endpoints are thin; detail endpoints are rich (notes, quote type, costs all needed per-entity detail calls).
- Priority/SLA: PriorityResponseTime/CompletionTime = MINUTES; TargetAttendanceDate = DateLogged + ResponseTime; P1–P4 carry 0 (no numeric target); **HasMetPriority is unreliable** — compute response time yourself.
- Quote→job link: `quotes.ParentJobAutoId = jobs.Id` (2090/3165 linked). Quote job type is INDEPENDENT of the parent job's type.
