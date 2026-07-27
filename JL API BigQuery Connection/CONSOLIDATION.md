# JobLogic ⇄ Monday — one integration (design)

Goal: replace the scattered JobLogic↔Monday pieces with **one integration** that keeps each Monday
"Minor Projects – WW" item and its JobLogic job in sync — links, status, and key fields — with
**last-write-wins** conflict resolution, a VM backbone for coverage, and a hidden TamperMonkey layer
for instant updates + accurate edit timestamps.

Board: `5084790211` (workspace BAU Projects). Warehouse: `vmimporteddata` (see
[[jl-api-bq-warehouse]]). This supersedes the split described in MONDAY_SYNC_SPEC.md.

---

## 1. Current state (accurate as of 2026-07-23)

**Live / automatic**
- **Warehouse loader** (`/opt/jl-loader`, VM cron): JobLogic API → BigQuery, jobs every 15 min +
  nightly full, plus quotes/invoices/POs/reference. The data backbone. *Fully automatic.*
- **TamperMonkey scripts (browser-triggered, per user):**
  - pushes **quote / job / PO numbers** onto Monday items;
  - **invoicing script** — raises invoices in JobLogic and marks the Monday item **Invoiced**.

**Installed but idle (manual, no cron)**
- `sync_monday.py` (quote# → Monday, fill-blanks). On the VM, **not scheduled**.
- Upgrade userscript + Apps Script relay (writes Original/Upgraded/Quote) — fires only for whoever
  has it installed.

**Built, not deployed**
- `create_monday_items.py` — item creator (replaces the Google-Sheet import), dry-run + live-tested,
  `GetById` enrichment. No cron; `/tmp` copy only.

**Fragmentation to remove:** two Monday write paths (VM Python w/ `monday-token`; Apps Script relay
w/ its own token), overlapping board-index/dedup/match/policy logic, no single on/off, and a
TM invoice step that will be redundant once status syncs.

---

## 2. Target system

Every Monday item is the hub, linked to its JobLogic records and kept in step:

- **Links (JL → Monday, set once, never clobbered):** Original Job Ref, Quote number(s),
  Upgraded Job Ref.
- **Status (two-way, last-write-wins):** JL job status ⇄ Monday PM Stat. (+ Finance Stat.), per the
  mapping in §4.
- **Key fields (two-way, last-write-wins):** per §3.
- **Remove** the invoicing TM script's "mark Invoiced on Monday" step — status sync sets it
  automatically (JL `Invoiced` → PM Stat `Complete` + Finance Stat `Invoiced`).
- **TamperMonkey accelerator** sitting hidden on users' browsers — see §6. It is not just speed: it
  is how we capture the *exact time a user changed something in JobLogic* (the warehouse only sees
  it at poll time), which last-write-wins needs.

---

## 3. Field mapping

| JobLogic field (API) | Monday column (id) | Direction | Notes |
|---|---|---|---|
| `Description` | **Name** + item **update/details** | JL → Monday (see decision D1) | Name = first line; full text in the item body |
| `OrderNumber` + `ReferenceNumber` (scan **both**) | **PO Number** (`text_mky86hyy`) | two-way, LWW | extraction rule ↓: first `(PO\|REQ)-?\d+` token |
| `OrderNumber` + `ReferenceNumber` (scan **both**) | **Client Ref.** (`text_mkxc7pxe`) | two-way, LWW | extraction rule ↓: standalone 8–9 digit SF id |
| Quote number(s) | **Quote** (`text__1`) | JL → Monday | comma-sep; fill-blank |
| Upgraded job number | **Upgraded Job Ref** (`text_mm5gxah5`) | JL → Monday | link |
| Original job number (`JobNumber`) | **Original Job Ref.** (`text_mkyrcb16`) | JL → Monday | anchor / dedup key, never overwrite |
| `JobOwner` / `OwnerUserId` | **Lead PM** (`person`) | two-way, LWW (see decision D2) | conflicts with the "assign creator as Lead PM" automation |
| Job status | **PM Stat.** (`status`) + **Finance Stat.** | two-way, LWW | §4 |

Writing owner back to JL = `PUT /api/v1/Job` with `AdditionalDetail.OwnerUserId` (int); status back =
`PUT /api/v1/Job/updatestatus`. Both confirmed. Owner int resolved via `Staff/GetAll`/`Engineer/GetAll`.

---

## 4. Status mapping (from mapping_jl_to_monday.xlsx)

**JL → Monday**
| JL status (id) | Monday PM Stat. | Finance Stat. |
|---|---|---|
| New Job (5) | Assigned | |
| Allocated (7) / Attended (1) / Parts To Fit (6) / Awaiting Parts (9) | Project In Progress | |
| Costed (2) | *(no change)* | |
| Reqs. Invoice (8) | *(no change)* | To Invoice |
| Invoiced (4) | Complete | Invoiced |
| Completed (11) | Complete | |
| Cancelled (10) | Lost/Not Progressed | |

**Monday → JL** (only these push back; everything else N)
| Monday PM Stat. | JL status (id) |
|---|---|
| Snagging | New Job (**5** — *missing in sheet, confirm*) |
| Complete | Completed (11) |
| Lost/Not Progressed | Cancelled (10) |
| Approved | *JL-only — never pushed from Monday* |

**Many-to-one note:** four JL statuses collapse to "Project In Progress". The reverse mapping for
"Project In Progress" is N, so no ambiguity — but the engine must compare on the *mapped* value so a
JL move Allocated→Attended (both → Project In Progress) does **not** churn Monday.

---

## 5. The last-write-wins engine

For each synced pair we need: current value both sides, the **time the user last changed it** on each
side, and protection against our own writes looping back.

**Timestamp sources**
- **Monday:** column `changed_at` / item `updated_at` + Activity Log → precise, per-column, with author.
- **JobLogic (solved via the Audit trail, verified 2026-07-23):** JobLogic keeps an authoritative
  per-field audit — Job > History > Audit — giving exact time + user + *which field changed*. Two-step:
  - **List** (web, cookie + `__RequestVerificationToken`): `POST go.joblogic.com/api/Audit/Search`
    `{...,"orderBy":2,"SearchEntity":{"AuditType":10,"HostEntityId":"<jobIntId>"}}` → rows
    `{id, ActionDes, OperationTime, EntryUser}`. Enumeration is **web-only** (no Job SearchAudit in the
    OAuth API), so this is done from the browser session — **the TamperMonkey layer is the enumerator**.
  - **Field detail** (OAuth, VM): `GET api/v1/Audit?id=<auditId>&tenantId=` →
    `{Detail:{<field>:<newValue>}, OperationTime (ISO UTC), UserName}`.
  So per (job, field) we get an authoritative "changed to V at UTC T by U". This beats capturing
  client-side events (covers changes by *anyone*, not just users running the script) — **the TM layer
  is integral: it enumerates the audit; the VM enriches + reconciles.** A poll-time value-diff CDC
  remains the cheap fallback when the audit hasn't been read yet (coarse ~15-min/nightly timing).

**State store:** BigQuery table `monday_sync_state` (one row per item×field): `last_value`,
`last_source` (jl|monday|sync), `last_change_at`, `last_synced_at`. Low volume (project jobs).

**Each cycle, per field:**
1. Read JL value+time and Monday value+time.
2. If equal → record, done.
3. If differ → later `*_change_at` wins; write the loser side; record `last_source=sync` + the value.
4. **Echo suppression:** a write we make bumps that side's `updated_at`; because we stored the value we
   wrote, next cycle sees value==last_synced and treats it as *not* a new user edit. Never treat a
   sync-origin change as a user edit.
5. **Ties / unknown JL time (poll-only, no TM):** default winner = **JobLogic** (system of record), or
   hold + flag — see decision D4.

---

## 6. Architecture — one brain, two triggers

Constraint: JL API is IP-whitelisted to the VM's static IP (all JL calls egress from the VM) and the
VM is locked down (IAP-only, no inbound) — so the VM can't receive browser webhooks directly.

- **One shared package on the VM** (`jl_monday/`): single Monday client (**one token**), board
  index/dedup, site + user matchers, JL client (`getall`/`GetById`/`updatestatus`/`PUT Job`), field
  mappers, status maps, LWW engine, state store. **Every Monday write goes through here and only here.**
- **Backbone = VM cron pollers** using it: create items, sync links, sync status, sync fields — one
  staggered cron group, one report, one enable flag.
- **Accelerator = TamperMonkey → queue (retire the Apps Script relay).** The userscript, hidden on
  users' browsers, emits events (status/field changed, with the exact edit timestamp) to a **queue the
  VM pulls** (Pub/Sub topic, or a thin shared-secret Cloud Function that writes a BQ `monday_events`
  table). A short-interval VM drainer runs them through the same shared package. No inbound to the VM,
  no Monday token in the browser.
- **Retire:** Apps Script relay; the invoice script's Monday-marking step; the idle `sync_monday.py`
  (absorbed).

Result: one codebase, one token, one policy set, one on/off; comprehensive (cron) + instant (TM) are
the same logic behind two triggers.

---

## 7. Open decisions (need Joe)

- **D1 — RESOLVED: Description is JL → Monday one-way** (Name = first line; full text in item body).
- **D2 — RESOLVED: option (c).** The "assign creator as Lead PM" automation sets the *initial* Lead PM
  on create (placeholder); the real owner is allocated by a human afterward, and that allocation syncs
  two-way (Owner ⇄ Lead PM) under LWW. **Build nuance:** the sync must seed its baseline from JL's
  owner at creation and treat the automation's create-time assignment as a placeholder, NOT a user
  edit — otherwise the first cycle would push the token-user back onto the JL job owner.
- **D3 — RESOLVED (ref/PO extraction rule, validated on 20 live jobs).** Scan BOTH JL `OrderNumber`
  (Customer Order Number) and `ReferenceNumber` (both come from `GetById`; neither is in raw.jobs —
  rides the enrichment): **PO Number** ← first `(PO|REQ)-?\d+` token; **Client Ref.** ← a standalone
  8–9 digit number NOT attached to an alpha prefix (strip `[A-Za-z]+-?\d+` first, prefer
  `ReferenceNumber`). Ignores "Awaiting PO"/"Approved by…"/"Waiver" free text.
- **D4 — RESOLVED: JobLogic wins on ties / unknown timing; TM strongly recommended but not mandatory**
  (status/owner sync degrades gracefully to poll-only coarse timing with JL-wins).
- **D5 — CONFIRMED (default): sync applies to every board item carrying an Original or Upgraded Job
  Ref**, not only creator-made ones.
- **D6 — CONFIRMED (default): state store = BigQuery `monday_sync_state`.**

All decisions resolved 2026-07-23 → Phase 1 unblocked.

---

## 8. Phased plan (nothing deploys without go)

1. **Foundation** — build `jl_monday/` shared package (Monday client + board index + matchers + JL
   client + mappers). Fold in the existing creator + quote sync. One cron group, dry-run default.
2. **JL → Monday** — links + status + fields one-way (create, quote/upgrade refs, status per §4,
   field fill/refresh). Ship + validate on the live board.
3. **Monday → JL** — status writeback (`updatestatus`, the 3 mapped statuses) + field writeback
   (PO/Client Ref, owner per D2), with the LWW engine + `monday_sync_state` + echo suppression.
4. **TamperMonkey accelerator + queue** — retire Apps Script relay; add precise-timestamp events.
5. **Retire** the invoice script's Monday-marking step.
