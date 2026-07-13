# Email to Joblogic Support — request: API access to job & engineer notes

**To:** Joblogic Support
**Subject:** API — how to retrieve Job Notes / Engineer Notes (or feature request for a notes endpoint)

Hi,

We're integrating with the Joblogic public API (tenant `38a05a51-8e8d-4073-9fbb-9863fd935329`,
requests from our whitelisted IP `8.228.52.239`) to replicate several of our reports into our own
data warehouse. This is working well for jobs, visits, quotes, invoices, POs, etc.

The one thing we can't retrieve via the API is **notes**. Specifically we need the equivalent of the
**Job Notes** and **Engineer/Visit Notes** that appear in our "Job Report (Including Notes)" report.

What we've tried:
- `POST /api/v1/Job/getall` with `IncludeNotes: true` — the response does not include note content.
- `GET /api/v1/Job/GetById` — the `Notes` field comes back empty for us.
- We can't find any dedicated notes list/search endpoint in the documentation
  (https://api.joblogic.com/swagger/ui/index.html).

**Could you please advise:**
1. Is there an existing API endpoint or request parameter that returns **job notes** and
   **engineer/visit notes** (the text, author, timestamp, and whether internal/private)? If so, how
   should we call it?
2. If not, could this be raised as a **feature request**? Ideally a way to pull notes in bulk —
   e.g. a `Notes/GetAll` search filtered by a date range (like the other GetAll endpoints), or notes
   included in the `Job/getall` / `Visit/GetAll` responses when `IncludeNotes: true` is set.
3. Any per-visit note fields available via `Visit/GetAll` would also help, as some notes are recorded
   at the visit level.

For context, the report we're trying to reproduce from the API contains, per job:
`Job_Number`, `Job_Notes`, `Engineer_Notes` (plus the standard job fields we already get).

Thanks very much,
Joe Segal — UP-FM
</content>
