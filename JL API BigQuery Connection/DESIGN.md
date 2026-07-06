# New-project API → BigQuery warehouse — design

Decision (this chat): build the **whole report suite** as an API-driven warehouse in a
**new GCP project**, using a **raw → model** (ELT) layout, and **run it in parallel** with the
existing daily-email pipeline (which stays untouched until you choose to cut over).

---

## Confirmed facts from the official API docs (apidocs.joblogic.com)

| Thing | Value | Impact on us |
|---|---|---|
| Auth | OAuth2 `client_credentials`, `scope=JL.Api`, Bearer token | loader already does this |
| Token endpoint | UAT: `https://uatidentityserver.joblogic.com/connect/token` — **prod host to confirm** (likely `identityserver.joblogic.com`) | set per environment |
| **TenantId** | **Required on every request** (`BaseApiRequest.TenantId`) | you need client_id **+** client_secret **+ tenant_id** |
| **Page size** | **max 50** (`PageSize` 5–50, `PageIndex` from 1); response has `TotalCount` | many requests to page big entities |
| **Rate limit** | **100 requests/min** per client (varies, 429 on breach, use backoff) | **the binding constraint — see below** |
| IP whitelist | Mandatory; only whitelisted IPs accepted | the fixed-IP VM is required |
| Datetimes | **UTC** for all request/response | model layer converts to Europe/London |
| Search params (base) | `SearchTerm`, `TagIds`, `IncludeInactive`, `PageIndex`, `PageSize` | **no `modifiedSince` visible** — incremental support unconfirmed |
| Entities seen | Job, Visit, Customer, Contact, Site, Asset, Supplier, Quote, Purchase Order (+ lines), Part | covers most of the suite |
| Webhooks | Exist ("our Webhook & API") | possible push path for near-real-time |
| Environments | UAT (`uat.joblogic.com`) and production — **separate creds/whitelist** | confirm your creds are for the **live** tenant |

---

## The cadence problem (important — changes "every 15 min")

You asked for **every 15 min or more frequent, whole suite**. With **max 50 rows/page** and
**100 req/min**, full snapshots don't fit:

- `Job_and_Visit_Details` alone is ~42.8k job×visit rows; the underlying jobs are ~tens of
  thousands. At 50/page that's hundreds of requests **per entity**, before visits, customers,
  sites, quotes, POs, costs… Summed, a full-suite snapshot is **thousands of requests** —
  minutes of wall-clock and it breaches 100/min if run hard.
- Running that **every 15 minutes** is not physically possible under the rate limit.

So true 15-min freshness for the whole suite needs one of:

1. **Webhooks (best for near-real-time).** Joblogic pushes create/update events to an HTTPS
   endpoint we host; we upsert into BigQuery. Sidesteps polling + rate limits entirely.
   Needs an **inbound** receiver (Cloud Run / Cloud Function) — different infra from the
   outbound-IP VM. Confirm which entities emit webhooks.
2. **Incremental polling** — pull only what changed since last run. Only viable **if** search
   endpoints accept a date/modified filter (not visible in the base request — **ask JL**). If
   yes, deltas are tiny and 15-min is easy.
3. **Tiered polling (realistic default).** Match cadence to how fast data actually changes:
   - **Fast (jobs, visits)** — every 15–30 min (feasible if volumes/deltas allow, ideally incremental).
   - **Reference (customers, sites, assets, suppliers, contacts)** — once daily; barely changes.
   - **Financial (quotes, POs, invoices, cost lines)** — hourly.
   This keeps every table fresh *enough* without ever breaching the limit.

**Recommendation:** design for **tiered polling now**, and pursue **webhooks** for jobs/visits
if you truly need sub-15-min. Confirm incremental + webhook support with JL (in the email).

---

## Architecture

```
                 fixed-IP VM (outbound whitelisted)          [+ optional] webhook receiver (inbound)
                        │  tiered cron (15m / hourly / daily)        Cloud Run/Function, upserts
                        ▼                                                   │
   new project e.g. `up-joblogic`                                          ▼
   ├─ dataset `raw`     one table per entity, loaded as-is (nested JSON, UTC)
   │     raw.jobs, raw.visits, raw.customers, raw.contacts, raw.sites, raw.assets,
   │     raw.suppliers, raw.quotes, raw.purchase_orders, raw.po_lines, raw.parts, raw.invoices, …
   │        + _ingested_at, _tenant_id columns for lineage / MERGE
   └─ dataset `models`  your SQL — native DATE/DATETIME/BOOL, joins, business logic
         models.job_and_visit_details, models.all_jobs_report, models.pending_costs,
         models.quote_tracking, models.subcontractor_allocation, models.cost_line_items, …
         (each can also expose a compat view matching the OLD column names for easy repointing)
```

- **raw** = dumb + robust: land the API payload verbatim (+ `_ingested_at`, `_tenant_id`).
  `WRITE_TRUNCATE` for full pulls, or `MERGE` on id for incremental/webhook upserts.
- **models** = all cleanup/joins in version-controlled SQL. This is where the current
  `_clean`/`_enriched` logic is redone properly (dates already real dates — no `dd/mm/yyyy`).
- **parallel run**: old `importdata-494110.JobLogic.*` keeps flowing from the daily email.
  Nothing there changes until you decide to point dashboards at the new project.

---

## Mapping: current report tables → API entities → model tables

| Current table (importdata-494110.JobLogic) | Source API entities | New model table |
|---|---|---|
| `Job_and_Visit_Details` | Job + Visit (+ engineer) | `models.job_and_visit_details` |
| `All_Jobs_Report` | Job + Site + Customer + quote/invoice totals | `models.all_jobs_report` |
| `All_in_Job` | Job + cost/quote totals | `models.all_in_job` |
| `Job_Report_Inc_Notes` | Job + notes | `models.job_report_inc_notes` |
| `Pending_Costs` | Job + cost lines + invoice | `models.pending_costs` |
| `Quote_Tracking_and_Analysis` | Quote | `models.quote_tracking` |
| `Subcontractor_Job_Allocation` | Job + Supplier + Visit | `models.subcontractor_allocation` |
| `UP_All_Cost_Line_Items` | Cost lines / PO lines / parts / labour | `models.cost_line_items` |
| `Completed_Visits_per_day_by_engineer` | Visit (aggregate) | `models.completed_visits_by_engineer` |
| `Forms_Logbook` | Forms / completed forms | `models.forms_logbook` — **endpoint TBC** |
| `Job_Status_Audit` | status-change history | **RISK: may have no API endpoint** — webhook or keep on email |

**Coverage risks to confirm in Phase 2:** `Job_Status_Audit` (audit history) and `Forms_Logbook`
may not be exposed as REST entities. If not, those two stay on the email pipeline (that's the
whole point of running in parallel), or come via webhooks.

---

## Open questions for Joblogic Support (in the whitelist email)
1. Production **token endpoint + API base URL** for our live tenant (we have UAT hosts).
2. Our **TenantId**, and confirmation our creds are for the **live** (not UAT) tenant.
3. Do search endpoints support a **`modifiedSince` / date filter** for incremental pulls?
4. **Webhooks**: which entities emit create/update events, and how to register our endpoint?
5. Can our **rate limit** be raised above 100/min for a full historical backfill?
6. Endpoints (or lack thereof) for **job status history** and **completed forms**.

## Phasing (updated)
- **Phase 1** — new project + fixed-IP VM + reserved IP + least-priv SA + Secret Manager;
  send whitelist email (with the 6 questions). Nothing pulls until whitelisted.
- **Phase 2** — with live access: confirm endpoints/params, build `raw.*` ingestion
  (config-driven, one entity per table, respect 50/page + 100/min with backoff), backfill,
  then build `models.*` (+ optional old-name compat views). Validate against a known-good
  daily export. Decide cadence tiers / webhooks. Keep the email pipeline running throughout.
</content>
