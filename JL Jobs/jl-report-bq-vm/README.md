# Joblogic API → BigQuery (hourly, fixed-IP VM)

Goal: refresh `importdata-494110.JobLogic.Job_and_Visit_Details` **hourly** instead of
once a day. Today the data arrives as a daily *Scheduled Export* email that a Google Apps
Script loads into BigQuery. The Joblogic scheduler can't go sub-daily and the "Export .csv"
button needs an interactive logged-in session, so the only robust headless path is the
**Joblogic public API** — which requires requests to come from a **whitelisted fixed IP**.

This folder provisions a tiny always-on VM with a reserved static external IP, runs the
API→BigQuery loader on an hourly cron, and (Phase 2) reshapes the API output back into the
exact column schema your existing views depend on.

```
Cloud Scheduler? No.  ──►  e2-micro VM (static external IP)  ──hourly cron──► loader.py
                                  │                                              │
                                  │ outbound calls leave from the static IP  ◄── whitelist this with Joblogic
                                  │   ├─ OAuth token (client_credentials, scope JL.Api)
                                  │   ├─ paginated GET against the JL API
                                  │   └─ transform → load into BigQuery (dataset is US multi-region)
```

## Why a VM, not the Cloud Run + NAT template (`../jl-bq-pipeline`)

For one **hourly** batch, the Cloud Run template's always-on **Cloud NAT (~£25–30/mo)** plus
a **VPC connector (2× e2-micro, always on)** is ~£40–50/mo and several extra moving parts.
A single `e2-micro` VM gives a real static external IP directly, runs the same Python, is far
easier to debug, and costs **~£8–12/mo** (VM ~£5–7 + reserved IP ~£2–3 when attached). The
whitelisted IP is the same idea either way. Keep `jl-bq-pipeline` as the fallback only if you
later need many-times-per-hour or serverless scale.

## Two phases (the whitelist gates everything)

### Phase 1 — provision + get the IP (do this first)
1. Run `phase1-provision.sh` (review the `EDIT THESE` block first). It enables the Compute +
   Secret Manager APIs, reserves a static IP, creates a least-privilege service account
   (BigQuery write only), and creates the VM. **It prints the static IP.**
2. Send `joblogic-whitelist-request.md` (with that IP filled in) to Joblogic Support.
3. SSH to the VM and run `vm-setup.sh` to install the loader + cron, then drop your API
   credentials into `/opt/jl-loader/secrets.env` (root-only, never in chat/git).
4. **Nothing will pull yet** — the API rejects the VM until Joblogic whitelists the IP.

### Phase 2 — make the API output match the report (after whitelist)
The public API returns *entities* (jobs, visits) as nested JSON with ISO dates — **not**
Joblogic's canned report. Your downstream views are coupled to the report's exact CSV columns:

```
Customer, Site, Area, ID, Job_Description, Job_Status, Order_Number, Task_Type_ID, Task_Type,
Date_Logged (dd/mm/yyyy), Target_Completion_Date (dd/mm/yyyy), Date_Complete (dd/mm/yyyy),
Engineer, Engineer_Active ('Yes'/'No'), VisitDateTime (dd/mm/yyyy HH:MM),
VisitEndDateTime (dd/mm/yyyy HH:MM), Visit_Status, Revisit_Reason, Site_id
```

`Job_and_Visit_Details_clean` re-parses those strings; `Job_and_Visit_Details_enriched`
joins on `ID`. So the loader must emit **these exact columns in this exact format**, or the
views break. Phase 2 steps:

1. Loader writes to a **staging** table first (`Job_and_Visit_Details_api_staging`,
   `LOADER_TARGET=staging`) so nothing live is touched.
2. With me, inspect a real API response, map fields → the report columns, format dates as
   `dd/mm/yyyy`, map booleans to `Yes/No`.
3. Validate staging vs a known-good daily export: row count within tolerance, spot-check a
   handful of `ID`s, confirm `..._clean` parses with no nulls where the CSV had values.
4. Flip `LOADER_TARGET=prod` (writes `Job_and_Visit_Details`, `WRITE_TRUNCATE`) and enable
   the hourly cron. Your Apps Script + daily email can stay as a backstop or be retired.

**Risk to keep in mind:** if the API can't reproduce a report column 1:1 (e.g. a JL-computed
label), the fallback is to auto-export the real CSV from an always-on logged-in browser
(Tampermonkey) and feed your existing Apps Script. We only fall back if Phase 2 mapping proves
lossy.

## Files
- `phase1-provision.sh` — one-time GCP provisioning; prints the IP to whitelist.
- `vm-setup.sh` — runs **on the VM**: installs deps, the loader, and the hourly cron.
- `loader.py` — API → transform → BigQuery. Reads config from `/opt/jl-loader/secrets.env`.
- `joblogic-whitelist-request.md` — email draft for Joblogic Support.

## Cost / region notes
- Dataset `JobLogic` is **US multi-region**. BigQuery loads work from any VM region (the load
  targets the dataset's location), so VM region only affects latency — `us-central1` is fine.
- e2-micro in some US regions is partly free-tier eligible; budget ~£8–12/mo all-in.
- Tear down anytime: delete the VM, release the static IP, disable the cron. Fully reversible.
</content>
</invoke>
