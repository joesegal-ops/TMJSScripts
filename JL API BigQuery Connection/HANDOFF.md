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

## Open TODOs / next steps
0. **JobCost cost pass — PARKED** by Joe ("don't need it for now"). Reverse-engineered formulas saved in the
   memory file if resumed (JobCost endpoint uses job UniqueId GUID; TotalQuoteSell=jobs.QuotedValue is free;
   PO adjustment + Service cols are constants 0/false in legacy; only the ~34k JobCost backfill is real work).
1. **`all_in_job` FULL pass** — backfill the JobCost endpoint (confirm swagger shape first: `GET /api/v1/Quote/GetCosts` exists; find the JobCost equivalent) to fill TotalJobCost/TotalJobSell; quote cost/sell via UNNEST(quotes.Lines); PurchaseOrderAdjustment via UNNEST(purchase_orders.Lines). Also pending_costs + cost_line_items models.
2. **Quote category** ~1,025 quotes have null category (genuine API gap — no category set on the quote), not a mapping miss.
3. **date_rejected** — the 105 already-rejected quotes are seeded at approx = 2026-07-20; only rejections from now on are exact.
4. **Looker** — make Job_Number a link via calculated field `HYPERLINK(Job_URL, Job_Number)`.
5. Job type map has only D/E/M/R; a future "Out of Hours" quote would show its raw code until added to `raw.quote_jobtype_map`.
6. This session ran as the (now-disabled) scheduled task `build-jl-note-models`, so it isn't in the normal sidebar — hence this handoff.

## Key API facts
- List endpoints are thin; detail endpoints are rich (notes, quote type, costs all needed per-entity detail calls).
- Priority/SLA: PriorityResponseTime/CompletionTime = MINUTES; TargetAttendanceDate = DateLogged + ResponseTime; P1–P4 carry 0 (no numeric target); **HasMetPriority is unreliable** — compute response time yourself.
- Quote→job link: `quotes.ParentJobAutoId = jobs.Id` (2090/3165 linked). Quote job type is INDEPENDENT of the parent job's type.
