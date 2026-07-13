# Reply to Joblogic Support

Hi,

Thanks — happy to give full visibility. This is a **headless server-to-server** integration
(our server → your REST API), so there’s no UI to screen-record, but I’ve captured the exact
**request payloads and responses** for every relevant endpoint, plus a script you can run to
reproduce it yourselves. Attached:

1. **reproduction-report.(pdf/html)** — every call side by side with WORKS vs RETURNS-0 and the
   exact request body + response.
2. **reproduce.sh** — a small script you can run with our (or any) client credentials to reproduce
   the behaviour directly.

**Setup:** tenant `38a05a51-8e8d-4073-9fbb-9863fd935329`, all requests from our whitelisted IP
`8.228.52.239`, Bearer token from `https://identityservice.joblogic.com/connect/token`
(client_credentials, scope `JL.Api`).

**The issue in one line:** `POST /api/v1/Job/getall`, `POST /api/v1/Invoice/getall`, and
`POST /api/v1/Visit/GetAll` (without a JobId) return `{"TotalCount":0,"Items":[]}` for **every**
input we send — while the identical pattern returns data for other resources and the same records
are readable individually:

| Call | Body | Result |
|---|---|---|
| `Customer/GetAll` | TenantId, PageIndex 1, PageSize 5 | **TotalCount 43** ✅ |
| `Quote/GetAll` | TenantId, PageIndex 1, PageSize 5 | **TotalCount 3041** ✅ |
| `Job/getall` | TenantId, PageIndex 1, PageSize 5 | **0** ❌ |
| `Job/getall` | + StartDate/EndDate 2024-07-31→2026-07-04 | **0** ❌ |
| `Job/getall` | + SearchTerm "PROJ0001624" (a real job) | **0** ❌ |
| `Job/GetById?id=31855808` | — | **returns the full job** ✅ |
| `Visit/GetAll` | + JobId 31855808 | **TotalCount 3** ✅ |
| `Visit/GetAll` | no JobId | **0** ❌ |
| `Invoice/getall` | + StartDate/EndDate | **0** ❌ |

So the credentials/IP/token are clearly fine (other endpoints return data on them), and the data
exists (readable by id) — only the **list/search (`GetAll`) for Jobs, Visits and Invoices** returns
nothing.

**Could you please confirm / action:**
1. Does our API client need a **permission, role, or feature flag** enabled to use the `GetAll`
   list/search endpoints for **Jobs, Visits and Invoices**? If so, please enable it.
2. The exact **required request body** for `Job/getall` and `Invoice/getall`, and any **max
   date-window** rule (we’ve noted Timesheet caps at 7 days and PO uses a single `DateRaised`).
3. Whether there’s a supported way to **list all jobs / all visits** for the tenant, or if we must
   enumerate job IDs another way and call `GetById` per job.

Happy to jump on a quick screenshare if that’s easier.

Thanks,
Joe Segal — UP-FM
</content>
