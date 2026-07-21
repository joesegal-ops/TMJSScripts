# Email draft — Joblogic Support: API access for our Swedish company

**To:** Joblogic Support
**Subject:** API credentials + IP whitelist for our Swedish company (second tenant)

Hi,

We already pull data via the public API for our UK company (client_credentials / `JL.Api`
scope, requests from the fixed IP below, working well). We now want to do the same for our
**Swedish company**, which is a separate tenant on the same Joblogic instance.

> **Swedish TenantId:** `c61c1df0-a34a-49fd-a440-e8acf2bbc3ad`
> **Static outbound IP (unchanged):** `8.228.52.239` (Google Cloud, London / europe-west2)

We tested our existing UK API client against the Swedish TenantId and it returns **HTTP 403**,
so the UK client is scoped to the UK tenant only. Please could you:

1. **Issue an API client** (`client_id` + `client_secret`, `JL.Api` scope, `client_credentials`
   grant) authorised for the Swedish tenant `c61c1df0-a34a-49fd-a440-e8acf2bbc3ad`.
   — Or, if simpler, **authorise our existing UK client** for this second tenant so one set of
   credentials can access both. Either is fine; please tell us which you've done.
2. **Whitelist the same IP `8.228.52.239`** for that client (all our requests originate there).
3. Confirm the Swedish tenant uses the **same hosts** we already use
   (`https://identityservice.joblogic.com/connect/token`, `https://api.joblogic.com`).
4. Confirm the **rate limit** (we pace under 100 req/min) applies per-client or per-tenant — i.e.
   whether running both companies shares one 100/min budget or gets one each.

Thanks,
Joe Segal — UP-FM

---

## Once Joblogic replies (internal runbook)

**If they issue a new client_id/secret:**
```bash
# add the SE creds to Secret Manager (secrets already exist, empty)
printf 'THE_NEW_CLIENT_ID'     | gcloud secrets versions add jl-se-client-id     --project=vmimporteddata --data-file=-
printf 'THE_NEW_CLIENT_SECRET' | gcloud secrets versions add jl-se-client-secret --project=vmimporteddata --data-file=-
```

**If they instead authorise the existing UK client for both tenants:** point the SE wrappers at
the UK client secrets — edit `run_tier_se.sh` / `run_incremental_se.sh` on the VM to read
`jl-client-id` / `jl-client-secret` (keep `jl-se-tenant-id`). No new secret values needed.

**Then verify + backfill** (from the VM):
```bash
# smoke test: should return Swedish customers, not 403
/opt/jl-loader/run_tier_se.sh "Customer/GetAll:customers"
bq --location=EU query --use_legacy_sql=false 'SELECT COUNT(*) FROM `vmimporteddata.sweden_raw.customers`'

# full backfill (mirror of the UK tiers) — run detached, ~pace 92/min
/opt/jl-loader/run_tier_se.sh "Customer/GetAll:customers,Site/GetAll:sites,Staff/GetAll:staff,Supplier/GetAll:suppliers,Subcontractor/GetAll:subcontractors,Asset/GetAll:assets,Part/GetAll:parts,Expense/GetAll:expenses"
/opt/jl-loader/run_tier_se.sh "Job/getall:jobs"
/opt/jl-loader/run_tier_se.sh "Quote/GetAll:quotes,FormsLogbook/getall:forms_logbook"
/opt/jl-loader/run_tier_se.sh "purchaseorder/getall:purchase_orders,SubcontractorPurchaseOrder/GetAll:subcontractor_purchase_orders"
/opt/jl-loader/run_tier_se.sh "Timesheet/GetAll:timesheets"
/opt/jl-loader/run_incremental_se.sh invoices backfill
```
Then add SE cron lines to `/etc/cron.d/jl-loader` (mirror the UK lines, swap `run_tier.sh` →
`run_tier_se.sh`, `run_incremental.sh` → `run_incremental_se.sh`; stagger the minutes so the two
companies don't hit the 100/min limit simultaneously), and build `sweden_models` / `sweden_reporting`.
```
