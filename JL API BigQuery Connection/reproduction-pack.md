# Joblogic API — reproduction pack (list/search returns 0 for Jobs/Visits/Invoices)

**Tenant:** `38a05a51-8e8d-4073-9fbb-9863fd935329`
**Source IP (whitelisted):** `8.228.52.239`
**Auth:** `POST https://identityservice.joblogic.com/connect/token` (grant_type=client_credentials,
scope=JL.Api) → 200 OK, Bearer token. All calls below send `Authorization: Bearer <token>` and
`Content-Type: application/json`. Captured live on 2026-07-04.

**Summary of the issue:** `Job/getall`, `Invoice/getall`, and `Visit/GetAll` (without a JobId)
return `TotalCount: 0` for **every** input we try — yet the *same* entities are fully readable
individually (`Job/GetById`, `Visit/GetAll` **with** a JobId), and the identical list pattern works
for other resources (`Customer/GetAll` = 43, `Quote/GetAll` = 3041). This points to list/search
(`GetAll`) access not being enabled for Jobs/Visits/Invoices on our API client.

---

## ✅ CONTROL — Customer list works
```
POST https://api.joblogic.com/api/v1/Customer/GetAll
{ "TenantId": "38a05a51-8e8d-4073-9fbb-9863fd935329", "PageIndex": 1, "PageSize": 5 }
```
```json
{ "TotalCount": 43, "PageIndex": 1, "Items_count": 5,
  "first_item_sample": { "Id": 6059289, "Name": "Arebyte Gallery", "Active": true, "Postcode": "E14 0LG" } }
```

## ✅ CONTROL — Quote list works
```
POST https://api.joblogic.com/api/v1/Quote/GetAll
{ "TenantId": "38a05a51-8e8d-4073-9fbb-9863fd935329", "PageIndex": 1, "PageSize": 5 }
```
```json
{ "TotalCount": 3041, "PageIndex": 1, "Items_count": 5,
  "first_item_sample": { "Id": 12337426, "QuoteNumber": "UP03209", "CustomerName": "WeWork Ltd" } }
```

## ❌ ISSUE — Job list, no filter → 0
```
POST https://api.joblogic.com/api/v1/Job/getall
{ "TenantId": "38a05a51-8e8d-4073-9fbb-9863fd935329", "PageIndex": 1, "PageSize": 5 }
```
```json
{ "TotalCount": 0, "PageIndex": 1, "Items_count": 0 }
```

## ❌ ISSUE — Job list, full date window (covers a known job's DateLogged 2026-06-02) → 0
```
POST https://api.joblogic.com/api/v1/Job/getall
{ "TenantId": "...", "PageIndex": 1, "PageSize": 5,
  "StartDate": "2024-07-31T00:00:00Z", "EndDate": "2026-07-04T23:59:59Z" }
```
```json
{ "TotalCount": 0, "PageIndex": 1, "Items_count": 0 }
```

## ❌ ISSUE — Job list, SearchTerm = exact known job number → 0
```
POST https://api.joblogic.com/api/v1/Job/getall
{ "TenantId": "...", "PageIndex": 1, "PageSize": 5, "SearchTerm": "PROJ0001624" }
```
```json
{ "TotalCount": 0, "PageIndex": 1, "Items_count": 0 }
```

## ✅ PROOF — the SAME job IS readable by id
```
GET https://api.joblogic.com/api/v1/Job/GetById?id=31855808&tenantId=38a05a51-8e8d-4073-9fbb-9863fd935329
```
```json
{ "IntId": 31855808, "JobNumber": "PROJ0001624", "Status": "Allocated",
  "JobType": "Project", "DateLogged": "2026-06-02T14:03:00", "DateComplete": "2026-06-07T12:24:00" }
```

## ✅ PROOF — that job's visits ARE readable (Visit/GetAll WITH JobId)
```
POST https://api.joblogic.com/api/v1/Visit/GetAll
{ "TenantId": "...", "PageIndex": 1, "PageSize": 5, "JobId": "31855808" }
```
```json
{ "TotalCount": 3, "Items_count": 3,
  "first_item_sample": { "Id": 29539587, "JobNumber": "PROJ0001624", "EngineerStringId": "E000069" } }
```

## ❌ ISSUE — Visit list without a JobId → 0
```
POST https://api.joblogic.com/api/v1/Visit/GetAll
{ "TenantId": "...", "PageIndex": 1, "PageSize": 5 }
```
```json
{ "TotalCount": 0, "PageIndex": 1, "Items_count": 0 }
```

## ❌ ISSUE — Invoice list, full date window → 0
```
POST https://api.joblogic.com/api/v1/Invoice/getall
{ "TenantId": "...", "PageIndex": 1, "PageSize": 5,
  "StartDate": "2024-07-31T00:00:00Z", "EndDate": "2026-07-04T23:59:59Z" }
```
```json
{ "TotalCount": 0, "PageIndex": 1, "Items_count": 0 }
```

---

### What we've ruled out on `Job/getall`
No filter; `StartDate`/`EndDate` at every window size (1 day → 2 years, incl. windows containing a
known job); `SearchTerm` = exact job number; `StatusIds` (comma-string); `CustomerId`; `SiteId`;
`IncludeInactive`. All return `TotalCount: 0`. `PageSize` is valid (5–50). The token is valid and
requests originate from the whitelisted IP (other endpoints return data on the same token).

### Questions for Joblogic
1. Does our API client need a **permission/role/feature** enabled to use the `GetAll` (list/search)
   endpoints for **Jobs, Visits, Invoices**? If so, please enable it.
2. What is the exact **required request body** for `Job/getall` and `Invoice/getall` (and any
   **max date-window** rule, like Timesheet's 7-day cap / PO's single `DateRaised`)?
3. Is there a supported way to **list all jobs / all visits** for the tenant, or must we enumerate
   job IDs another way and call `GetById` per job?
</content>
