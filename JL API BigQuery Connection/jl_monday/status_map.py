"""JobLogic ⇄ Monday status maps (source: mapping_jl_to_monday.xlsx, locked 2026-07-23).

Board 5084790211: PM Stat. column = `status`; Finance Stat. = `color_mkvy3avs`.
"""

# --- JL job status -> Monday, keyed by JL StatusId (int) --------------------
# value: {"pm": <PM Stat. label or None>, "finance": <Finance Stat. label or None>}
# None = leave that Monday column unchanged.
JL_STATUS = {
    5:  {"name": "New Job",        "pm": "Assigned",             "finance": None},
    7:  {"name": "Allocated",      "pm": "Project In Progress",  "finance": None},
    1:  {"name": "Attended",       "pm": "Project In Progress",  "finance": None},
    6:  {"name": "Parts To Fit",   "pm": "Project In Progress",  "finance": None},
    9:  {"name": "Awaiting Parts", "pm": "Project In Progress",  "finance": None},
    2:  {"name": "Costed",         "pm": None,                   "finance": None},
    8:  {"name": "Reqs. Invoice",  "pm": None,                   "finance": "To Invoice"},
    4:  {"name": "Invoiced",       "pm": "Complete",             "finance": "Invoiced"},
    11: {"name": "Completed",      "pm": "Complete",             "finance": None},
    10: {"name": "Cancelled",      "pm": "Lost/Not Progressed",  "finance": None},
}

# --- Monday PM Stat. -> JL, keyed by Monday label ---------------------------
# Only entries with push=True are ever written back to JobLogic. "Approved" is
# JL-only (set by JobLogic; never pushed from Monday). Everything else: no push.
MONDAY_PM = {
    "Snagging":            {"push": True,  "jl_status_id": 5,  "jl_status_name": "New Job"},
    "Complete":            {"push": True,  "jl_status_id": 11, "jl_status_name": "Completed"},
    "Lost/Not Progressed": {"push": True,  "jl_status_id": 10, "jl_status_name": "Cancelled"},
    "Approved":            {"push": False, "jl_only": True},
    # all other PM Stat. labels default to no-push (see monday_pm_to_jl)
}


def jl_status_to_monday(status_id=None, status_name=None):
    """{'pm':..., 'finance':...} for a JL status. Match by id, then by name. Unknown -> both None."""
    if status_id is not None:
        try:
            rec = JL_STATUS.get(int(status_id))
        except (TypeError, ValueError):
            rec = None
        if rec:
            return {"pm": rec["pm"], "finance": rec["finance"]}
    if status_name:
        for rec in JL_STATUS.values():
            if rec["name"].lower() == status_name.strip().lower():
                return {"pm": rec["pm"], "finance": rec["finance"]}
    return {"pm": None, "finance": None}


def monday_pm_to_jl(pm_label):
    """{'push':bool, 'jl_status_id':int|None, 'jl_status_name':str|None} for a Monday PM Stat.
    Unmapped labels -> no push."""
    rec = MONDAY_PM.get((pm_label or "").strip())
    if rec and rec.get("push"):
        return {"push": True, "jl_status_id": rec["jl_status_id"], "jl_status_name": rec["jl_status_name"]}
    return {"push": False, "jl_status_id": None, "jl_status_name": None}
