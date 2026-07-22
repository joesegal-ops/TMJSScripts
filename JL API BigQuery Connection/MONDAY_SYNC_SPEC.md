# JobLogic → Monday sync — build spec

Push the JobLogic **quote number** and **upgraded job number** onto the matching item in the
Monday board **Minor Projects – WW Active**, at each stage of the project lifecycle. Extends the
existing warehouse pipeline in this folder; reads `vmimporteddata.raw.*`, writes to Monday via
its GraphQL API. Runs on the same fixed-IP VM.

---

## 1. The lifecycle & the data chain (verified 2026-07-22)

```
JL reactive job raised ──(Google sheet import)──▶ Monday item created
        │                                          Original Job Ref. = PROJ0000625   ← ANCHOR
        ▼
JL quote raised against that job  (UP01820)  ─────▶ write Quote          = UP01820
        │  quote.ParentJobStringId = PROJ0000625
        ▼
Quote upgraded to a new job       (PROJ0000885) ──▶ write Upgraded Job Ref = PROJ0000885
           job.QuoteId = quote.Id (12137915)
```

Worked example confirmed end-to-end in live data:

| Entity | Key fields |
|---|---|
| Quote **UP01820** | `Id=12137915`, `QuoteNumber="UP01820"`, `ParentJobStringId="PROJ0000625"`, `IsUpgraded=true`, `QuoteStatusId=10` |
| Job **PROJ0000885** | `Id=30798926`, `JobNumber="PROJ0000885"`, web-detail `QuoteId=12137915` |

### Monday target (board `5084790211`, workspace BAU Projects) — all text columns
| Purpose | Column title | Column id |
|---|---|---|
| Anchor / match key (never write) | Original Job Ref. | `text_mkyrcb16` |
| Quote number | Quote | `text__1` |
| Upgraded job number | Upgraded Job Ref | `text_mm5gxah5` |

Match rule: **Monday `Original Job Ref.` == JL `quote.ParentJobStringId`**. That is the one stable
join key across both systems. (`Related Proj.`, `Client Ref.`, etc. are not used.)

---

## 2. What the warehouse already gives us

- `raw.quotes` (from official API `Quote/GetAll`) **has** `Id, QuoteNumber, ParentJobStringId,
  ParentJobAutoId, IsUpgraded, QuoteStatusId, QuoteStatusDescription, OrderNumber`.
  → **Quote → Monday is fully supported by existing data. No new ingestion.**
- `raw.quote_status_events` (from `quote_status_cdc.sql`, daily) logs every quote status change:
  `quote_id, quote_number, old_status, new_status, observed_at`.
  → **Upgrade detector already exists** — the trigger is `new_status='Upgraded'`.

## 3. The one gap: upgraded-quote → new job number

`raw.jobs` (from `Job/getall`) carries **no quote link** — no `QuoteId`, no parent-job id (only a
`HasParent` boolean). Neither list endpoint forward-references the job a quote became. The
job→quote link (`QuoteId`) exists in JobLogic's **web** `/Job/Detail/{id}` model, but that is
cookie/SSO-authed, not the OAuth API the VM uses.

**`OrderNumber` fallback rejected.** Of ~1,300 distinct order numbers on the 2,279 upgraded
quotes, only **919 map to exactly one job**; 209 map to none and many map to dozens (one to 177).
Not a reliable join.

### ▶ Build task 1 (decides everything below) — run ON THE VM (creds live in its environment)
Probe whether the **official** API exposes `QuoteId` (or any job↔quote link) on a **single-job**
endpoint. Candidates to try with a known upgraded job id (`30798926`) and a valid bearer token:
`GET Job/get?id=`, `Job/{id}`, `Job/getbyid?id=`, `Job/detail?id=`; also re-check whether
`Job/getall` returns a quote field under any flag. (apidocs.joblogic.com for the exact route.)

- **Outcome A — official API returns `QuoteId`:** the VM does everything. Add a small
  **job-enrichment** step (§4C-A). Preferred.
- **Outcome B — only the web model has it:** the VM cannot learn the link headlessly. The
  **TamperMonkey layer (§5) becomes required** for the upgraded-job step (it reads `QuoteId` from
  the job-detail page the operator is already on and posts it to the VM). Quote→Monday still runs
  fully on the VM regardless.

---

## 4. VM service (the backbone)

New module alongside `loader.py` / `load_jobs_incremental.py`, e.g. `sync_monday.py`, driven by the
existing tiered cron. Reuses the OAuth token helper and BigQuery client already in this repo.

### 4A. Quote number → Monday  *(ready now)*
Every run (hourly tier, after the quote refresh):
```sql
-- candidates = upgraded-or-any quotes whose parent job maps to a Monday item
SELECT q.QuoteNumber, q.ParentJobStringId AS original_job_ref
FROM raw.quotes q
WHERE q.ParentJobStringId IS NOT NULL AND q.ParentJobStringId != ''
  AND q.DateLogged >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)  -- window; widen for backfill
```
Match `ParentJobStringId` against **either** the Original Job Ref **or** the Upgraded Job Ref
column (`text_mkyrcb16` / `text_mm5gxah5`). Historically the single job-ref column held whatever
users typed — often the *upgraded* job number — so the item is indexed by both refs.
**Write policy (decided): fill blanks only.** Write the quote number(s) only where the Quote cell
is empty. Non-empty cells whose quote *set* differs (formatting ignored, zero-padding tolerant)
are **not changed** — instead logged to a mismatch CSV (`MONDAY_REPORT_PATH`, default
`/tmp/monday_quote_report.csv`) with `missing_in_monday` / `extra_in_monday` for human review.
**Multiple quotes on one job → comma-separated**, ordered by QuoteNumber (e.g. `UP01820, UP01831`).
Dry-run first (default); `MONDAY_SYNC_APPLY=1` to write.

### 4B. Upgrade detection  *(ready now)*
```sql
SELECT e.quote_number, q.ParentJobStringId AS original_job_ref, q.Id AS quote_id
FROM raw.quote_status_events e
JOIN raw.quotes q ON q.Id = e.quote_id
WHERE e.new_status = 'Upgraded'
  AND e.observed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 DAY)
```

### 4C. Upgraded job number → Monday — **PATH B confirmed (2026-07-22)**
Build task 1 result: the official OAuth API does **not** expose the job↔quote link in either
direction. Probed exhaustively (all run from the VM's whitelisted IP):
- `Job/getall` (every include flag) → only `HasParent`, `QuotedValue`; no quote link.
- `Job/getbyid?id=<num>&tenantId=<GUID>` → 200, 28 fields, **no `QuoteId`**; `UP01820`/`12137915`
  absent; include flags change nothing.
- `Quote/getbyid?id=<num>&tenantId=<GUID>` → has `ParentJobStringId` (original job) but nothing
  pointing to the upgraded job (`PROJ0000885`/`30798926` absent).

➡️ **`~Path A (raw.jobs QuoteId enrichment) is dead~`** — the source data isn't in the API. The
`QuoteId` link lives ONLY in the web `/Job/Detail/{id}` model (cookie/SSO-authed).

**Path B — TamperMonkey supplies the link.** On quote-upgrade (or job-detail view), the userscript
reads `QuoteId` from the web job-detail model, resolves the quote's `ParentJobStringId` (via
`/api/Quote/QuoteSearchJson`), and POSTs `{jobNumber, quoteNumber, parentJobStringId}` to a small
**VM ingest endpoint**, which writes `jobNumber` → **Upgraded Job Ref** on the item matched by
`parentJobStringId`. (VM never learns this link on its own, so there is no pure-server reconciler;
robustness = TM installed wherever upgrades happen, optionally a periodic browser-based sweep.)

Note the working official detail route for future use: `GET {Entity}/getbyid?id=<numeric>&tenantId=<tenant GUID>`
(GET only; POST → 405; omitting `tenantId` → 400 "Invalid Tenant").

**Implementation (built 2026-07-22):** the web `GET /Quote/Detail/{quoteId}` model carries the whole
chain — `OriginalJobNumber` (original job → match key), `UpgradedIntoJobNumber` (the upgraded job →
write value), `QuoteNumber`. Files:
- `monday-upgrade-relay.gs` — Apps Script web app. Holds MONDAY_TOKEN + SHARED_SECRET in Script
  Properties. POST `{secret, jobNumber, parentJobStringId, quoteNumber}` → finds ALL board items
  whose Original OR Upgraded col equals the original **or** upgraded job# → fill-blank writes across
  Original/Upgraded/Quote, reports (never overwrites) real differences.
- `joblogic-monday-upgrade.user.js` — TamperMonkey on `/Job/Detail/*` + `/Quote/Detail/*`. Resolves
  quoteId (URL, or job model's `QuoteId`), fetches `/Quote/Detail/{quoteId}`, and if upgraded POSTs
  the three fields to the relay (GM_xmlhttpRequest, de-duped via GM storage). Fill in RELAY_URL +
  SHARED_SECRET per install. NB a job's own `ParentJobStringId` is NOT the original job — only the
  quote's `OriginalJobNumber` is, so resolution always goes via the quote.

### 4D. Monday write (GraphQL) + idempotency
- Find item by anchor (avoids storing Monday item ids): `items_page_by_column_values` on board
  `5084790211`, column `text_mkyrcb16`, value = original job ref. Cache board→items for the run.
- Write with `change_multiple_column_values` (or MCP `change_item_column_values`):
```graphql
mutation ($item: ID!, $vals: JSON!) {
  change_multiple_column_values(board_id: 5084790211, item_id: $item, column_values: $vals) {
    id
  }
}
```
`vals = {"text__1": "UP01820"}` or `{"text_mm5gxah5": "PROJ0000885"}`.
- **Idempotency without a new table:** read the current column value first; write only if it
  differs from the desired value. Never overwrite `text_mkyrcb16`. This makes every run a safe
  no-op once caught up — no state store required.
- Rate limits: Monday API is complexity-budgeted; batch reads, write only diffs, back off on 429.

### 4E. Scheduling
Fold into the existing tier cron (`run_tier.sh` / `jl-loader.cron`):
- **Quote→Monday (4A)** + **upgrade→Monday (4C)**: hourly, right after the quote refresh and
  `quote_status_cdc`.
- One-off **backfill** run with a wide date window to populate existing open items.

---

## 5. TamperMonkey layer (instant updates)
Optional if Outcome A; **required for the upgrade step if Outcome B**. Userscript on
`go.joblogic.com` that, on quote-save and quote-upgrade, reads the fields via the web endpoints
already mapped and POSTs to a small VM ingest endpoint (or straight to Monday):
- Quote search: `POST /api/Quote/QuoteSearchJson` (multipart form; `SelectedTab=4`=All;
  `__RequestVerificationToken` header) → row has `QuoteNumber, ParentJobStringId, IsUpgraded`.
- Job search: `POST /api/Job/SearchJsonData` → `Jobs[]`.
- Job detail: `GET /Job/Detail/{id}` → model has `QuoteId` (the job→quote link).
Reliability note: a userscript only fires for operators who have it installed and are in the
browser — so it is an **accelerator on top of** the VM backbone, never the sole path (except the
narrow Outcome-B upgrade-link case, which the hourly VM run should still reconcile).

---

## 6. Decisions & open items
- ❌ **Add `QuoteId` to `raw.jobs`** — dropped. Official API has no job↔quote link to populate it
  (build task 1, §4C). No schema change needed after all.
- ✅ **Multiple quotes per original job** — comma-separated in the Quote column.
- ✅ **Monday API token** — stored in Secret Manager as `monday-token`
  (project `vmimporteddata`). Runner fetches at runtime like the JL creds:
  `MONDAY_TOKEN=$(gcloud secrets versions access latest --secret=monday-token --project=vmimporteddata)`.
  ⏳ Needs a per-secret IAM binding granting `jl-loader@vmimporteddata.iam.gserviceaccount.com`
  `roles/secretmanager.secretAccessor` (SA has only BigQuery roles at project level).
- ✅ **Backfill** — deferred until after the VM + TamperMonkey pieces are live.
- ✅ **Build task 1** — done. Path B confirmed (§4C): official API lacks the link; TamperMonkey required for the upgrade step.
- ⏳ **VM ingest endpoint** — now required (Path B): small authenticated HTTPS endpoint the TM
  script POSTs to; does the Monday write with the server-side `monday-token`.

## Build order
1. **VM `sync_monday.py` — quote→Monday** (§4A). Ships value immediately; no new infra. Hourly after quote refresh.
2. **VM ingest endpoint + Monday writer** (§4C/4D) — shared write path for both steps.
3. **TamperMonkey script** — on quote-upgrade, capture `{jobNumber, quoteNumber, parentJobStringId}` → POST to endpoint → Upgraded Job Ref. (Also can push quote# instantly.)
4. **Backfill** existing open items.

## 7. Reference (files in this folder)
`loader.py` (nightly full, `<Entity>/GetAll`), `load_jobs_incremental.py` (hourly jobs upsert),
`load_incremental.py` (entity map incl. `Quote/GetAll:quotes`), `quote_status_cdc.sql`
(builds `quote_status_events`), `run_tier.sh` / `jl-loader.cron` (schedule). API:
`https://api.joblogic.com/api/v1`, OAuth client-credentials (`scope=JL.Api`), 50/page, ~0.65s pace.
