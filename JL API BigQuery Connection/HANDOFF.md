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
