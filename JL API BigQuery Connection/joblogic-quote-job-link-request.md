# Email draft — Joblogic Support: expose the quote ↔ job link via the API

**To:** Joblogic Support
**Subject:** API — retrieving a job's parent quote (or a quote's upgraded job)

Hi,

We pull data into our own warehouse via the public API (tenant
`38a05a51-8e8d-4073-9fbb-9863fd935329`, from our whitelisted IP `8.228.52.239`). That's working
well across jobs, quotes, visits, invoices and POs.

The one link we can't retrieve is **between a quote and the job it was upgraded into** — in either
direction. We need it to report on how long approved quoted work takes to complete.

What we've tried:
- `POST /api/v1/Job/getall` (with every `Include*` flag set) — returns `HasParent` and
  `QuotedValue`, but no quote id.
- `GET /api/v1/Job/GetById` — no parent-quote field.
- `GET /api/v1/Quote/GetById` and `POST /api/v1/Quote/GetAll` — return `ParentJobStringId` (the
  *original* job the quote was raised against) but nothing pointing to the job the quote became.

The data clearly exists in the product: the web UI's `/Quote/Detail/{id}` model carries
`UpgradedIntoJobNumber` / `UpgradedIntoJobId`, and `/Job/Detail/{id}` carries `QuoteId`. Those
pages are cookie/SSO-authenticated, so our server-side integration can't use them.

**Could you please advise:**
1. Is there any existing API endpoint or request parameter that returns a job's **parent quote id**,
   or a quote's **upgraded job id/number**? If so, how should we call it?
2. If not, could this be raised as a **feature request** — ideally `QuoteId` on the `Job/getall` /
   `Job/GetById` responses, and/or `UpgradedIntoJobId` on the `Quote` responses, mirroring the
   fields the web UI already exposes?

Happy to provide a worked example from our tenant if that helps (quote `UP01820` was upgraded into
job `PROJ0000885`).

Thanks very much,
Joe Segal — UP-FM
