# Email draft — Joblogic Support: whitelist our API IP

**To:** Joblogic Support
**Subject:** API access — please whitelist our static outbound IP

Hi,

We have API credentials (client_credentials / `JL.Api` scope) for our account and want to
start pulling data via the public API. All requests will originate from a single fixed IP:

> **Static outbound IP: `8.228.52.239`**  (Google Cloud, London / europe-west2)

Please whitelist this IP for our API access so token + data requests are allowed.

Could you also confirm:
1. The **production** token endpoint and API base URL for our live tenant (the docs show the
   UAT hosts `uatidentityserver.joblogic.com` / `uat.joblogic.com`).
2. Our **TenantId**, and confirmation these credentials are for our **live** tenant (not UAT).
3. Do the search endpoints support a **`modifiedSince` / date filter** so we can pull only
   records changed since our last run (incremental)? If so, the field name and format.
4. **Webhooks** — which entities emit create/update events, and how do we register a receiver
   endpoint? (We're interested in near-real-time for jobs + visits.)
5. Can our **rate limit** be raised above the default 100 requests/min, at least temporarily,
   for an initial historical backfill?
6. Are there endpoints for **job status-change history** and **completed forms**? (We currently
   get these as reports and want to know if the API exposes them.)

Thanks,
Joe Segal — UP-FM
</content>
