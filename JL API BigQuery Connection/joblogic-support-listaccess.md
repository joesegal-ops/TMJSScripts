# Joblogic Support request — enable list/search API access for Jobs, Visits, Invoices

Hi,

Our API integration (tenant + client_id already set up, requests from whitelisted IP
**8.228.52.239**) is working for most resources, but the **list/search** endpoints for a few
key resources return **0 results**, even though the data exists and is readable individually.

**Confirmed working** (return data): `Customer/GetAll`, `Site/GetAll`, `Quote/GetAll`,
`Asset/GetAll`, `Supplier/GetAll`, `Subcontractor/GetAll`, `Part/GetAll`, `Staff/GetAll`,
`Expense/GetAll`, `FormsLogbook/getall`, `purchaseorder/getall` (with `DateRaised`).

**Problem** — these return `{"Items":[],"TotalCount":0}` for every input we try:
- `POST /api/v1/Job/getall`
- `POST /api/v1/Invoice/getall`
- `POST /api/v1/Visit/GetAll` (returns 0 unless a specific `JobId` is supplied)

Crucially, **individual access works**: `GET /api/v1/Job/GetById?id=31855808` returns the full
job (PROJ0001624), and `POST /api/v1/Visit/GetAll` with that `JobId` returns its 2 visits. So the
credentials can read jobs — only the **bulk list/search** returns nothing.

We have tried on `Job/getall`: no filter; `StartDate`/`EndDate` across every window size
(1 day to 2 years, including windows that contain a known job's `DateLogged` of 2026-06-02);
`SearchTerm` set to the exact job number `PROJ0001624`; `StatusIds`; `CustomerId`; `SiteId`;
`IncludeInactive`. All return 0.

**Questions:**
1. Does our API client need a specific **permission/role** or **feature flag** enabled to use the
   list/search (`GetAll`) endpoints for **Jobs, Visits and Invoices**? If so, please enable it.
2. For `Job/getall`, what is the **exact required request body** and is there a **maximum date
   window**? (For `Timesheet/GetAll` the window is capped at 7 days; for `purchaseorder/getall`
   `DateRaised` is a single required date — we'd like the equivalent rules for Jobs/Invoices.)
3. Is there a way to **list all jobs** (or all visits) for a tenant, or must we enumerate job IDs
   another way and call `GetById` per job?

Thanks,
Joe Segal — UP-FM
</content>
