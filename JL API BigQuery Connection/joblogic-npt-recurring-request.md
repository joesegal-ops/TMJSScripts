# Email draft — Joblogic Support: return recurring Non-Productive Time via the API

**To:** Joblogic Support
**Subject:** API — recurring Non-Productive Time missing from Visit/SearchPlanner for future dates

Hi,

We pull data into our own warehouse via the public API (tenant
`38a05a51-8e8d-4073-9fbb-9863fd935329`, from our whitelisted IP `8.228.52.239`).

Our allocator uses **Non-Productive Time on the Planner** to set which site each engineer is based
at, morning and afternoon. Most of these are **recurring** NPT entries. We read them through the API
to drive job allocation, and we need to see them **for the days ahead**, not just today.

What we're calling:
- `POST /api/v1/Visit/SearchPlanner` with `IncludeNonProductiveTime: true` (visits switched off),
  all engineer ids, a date range within one month.

What we see:
- **Today and past dates are complete**: they match the Planner exactly.
- **Future dates only return one-off NPT.** Occurrences generated from a recurring NPT series are
  missing until the day itself (the day before at the earliest, and even then not all of them). Example: on 16 Oct
  the Planner showed about 19 NPT entries for Mon 19 Oct, but the API returned 5, the same number
  as the one-off entries that day. Engineers on a recurring pattern (e.g. Daniel Nobes, id `3354536`,
  Aviation House / Aldwych House on Mondays) are the ones missing.
- There's no way to read the recurrence rule either: `/api/v1/NonProductiveTime` is POST/PUT/DELETE
  only. The `Recurrence` details (`RepeatEvery`, `Frequency`, `WeekDays`, start/end) come back only
  in the response to creating or updating an entry.

The Planner in the web app shows these future occurrences (as recurring/virtual items), so the
data is there. It just isn't reachable from the API.

**Could you please advise:**
1. Is there an existing endpoint or parameter that returns **future occurrences of recurring NPT**,
   or that lets us **read NPT entries with their recurrence settings**? If so, how should we call it?
2. If not, could this be raised as a **feature request**? Either of these would solve it for us:
   - `Visit/SearchPlanner` returns recurring NPT occurrences for future dates the same way the
     Planner does, ideally with a flag showing it's a recurring occurrence and its series id; or
   - a read endpoint, e.g. `GET`/`POST /api/v1/NonProductiveTime/GetAll` filtered by date range and
     engineer, returning the existing `NonProductiveTimeApiResponse` shape including `Recurrence`.

Happy to provide more examples from our tenant if that helps.

Thanks very much,
Joe Segal — UP-FM
