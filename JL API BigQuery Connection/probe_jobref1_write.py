"""Can PUT /api/v1/Job set AdditionalDetail.JobRef1 without disturbing anything else?

PUT /api/v1/Job is a FULL update (Status/JobType/DateLogged/Description required), so the body is
rebuilt from GetById with only JobRef1 changed. For each Test-site job (aborts otherwise): snapshot
GetById + the Job/getall row (~120 fields), PUT, diff both, restore the original JobRef1, diff again.
Run ON THE VM:
  cd /opt/jl-loader
  JL_CLIENT_ID=$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata) \
  JL_CLIENT_SECRET=$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata) \
  JL_TENANT_ID=$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata) \
  ./venv/bin/python ~/probe_jobref1_write.py
"""
import os, json, time, requests

CID = os.environ["JL_CLIENT_ID"]; CSEC = os.environ["JL_CLIENT_SECRET"]; TID = os.environ["JL_TENANT_ID"]
APIV = "https://api.joblogic.com/api/v1"
JOBS = [(33894692, "RE0029570"), (30363311, "RE0016326")]   # both Site = "Test site"
TEST_VAL = "CLAUDE-TEST-JOBREF1"
ZERO_GUID = "00000000-0000-0000-0000-000000000000"
IGNORE = {"UpdatedAt", "_ingested_at", "IsRead", "PriorityRemainingResponseTime", "PriorityRemainingCompletionTime"}

tok = requests.post("https://identityservice.joblogic.com/connect/token",
    data={"grant_type": "client_credentials", "client_id": CID, "client_secret": CSEC, "scope": "JL.Api"},
    timeout=60).json()["access_token"]
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

def get_by_id(jid):
    r = requests.get(f"{APIV}/Job/GetById", params={"id": jid, "tenantId": TID, "includeAdditionalDetails": "true"},
                     headers=H, timeout=60)
    r.raise_for_status()
    j = r.json()
    return j.get("Data", j)

def get_row(jobno):
    body = {"TenantId": TID, "PageIndex": 1, "PageSize": 50, "SearchTerm": jobno,
            "IncludeReactiveJobs": True, "IncludePPMJobs": True, "IncludeInactive": True, "IncludeTags": True}
    r = requests.post(f"{APIV}/Job/getall", json=body, headers=H, timeout=60)
    r.raise_for_status()
    rows = [x for x in r.json().get("Items", []) if x.get("JobNumber") == jobno]
    return rows[0] if rows else {}

def flat(o, pre=""):
    out = {}
    if isinstance(o, dict):
        for k, v in o.items(): out.update(flat(v, f"{pre}{k}."))
    elif isinstance(o, list):
        out[pre[:-1]] = json.dumps(o, sort_keys=True, default=str)
    else:
        out[pre[:-1]] = o
    return out

def diff(a, b, label):
    fa, fb = flat(a), flat(b)
    ch = [(k, fa.get(k), fb.get(k)) for k in sorted(set(fa) | set(fb))
          if fa.get(k) != fb.get(k) and k.split(".")[-1] not in IGNORE]
    print(f"  {label}: {len(ch)} field(s) differ")
    for k, x, y in ch: print(f"     {k}: {str(x)[:100]!r} -> {str(y)[:100]!r}")

def tag_name(t):
    return t if isinstance(t, str) else (t.get("Title") or t.get("Name") or t.get("Description"))

def build_body(j, row, jobref1):
    ad = j.get("AdditionalDetail") or {}
    ref2 = ad.get("JobRef2")
    return {
        "Id": j["Id"], "TenantId": TID, "ExternalId": j.get("ExternalId"),
        "Description": j.get("Description"), "Status": j.get("Status"), "JobType": j.get("JobType"),
        "JobCategory": j.get("JobCategory"), "PriorityLevel": j.get("PriorityLevel"),
        "OrderNumber": j.get("OrderNumber"), "ReferenceNumber": j.get("ReferenceNumber"),
        "DateLogged": j.get("DateLogged"), "PreferredAppointmentDate": j.get("PreferredAppointmentDate"),
        "TargetCompletionDate": j.get("TargetCompletionDate"), "TargetAttendanceDate": j.get("TargetAttendanceDate"),
        "DateComplete": j.get("DateComplete"),
        "Tags": [tag_name(t) for t in (j.get("Tags") or []) if tag_name(t)],
        "AdditionalDetail": {
            "Trade": ad.get("Trade"), "OwnerUserId": ad.get("OwnerUserId"),
            "NextContactDate": ad.get("NextContactDate"), "IsRequireApproval": bool(ad.get("IsRequireApproval")),
            "QuotedValue": ad.get("QuotedValue") or None,   # API rejects 0 ("must be greater than 0")
            "JobRef1": jobref1,
            "JobRef2": None if ref2 in (None, ZERO_GUID) else ref2,
            "SecondaryTradeIds": [t.get("Id") or t.get("UniqueId") for t in (ad.get("SecondaryTrades") or [])],
        },
        "ProjectNumber": j.get("ProjectNumber"),
        "CustomerContractId": row.get("CustomerContractId") or None,
    }

for jid, jobno in JOBS:
    print(f"\n===== {jobno} (id {jid}) =====")
    g0, r0 = get_by_id(jid), get_row(jobno)
    if (g0.get("Site") or {}).get("Name", "").lower() != "test site":
        print("  ABORT: not a Test site job"); continue
    orig = (g0.get("AdditionalDetail") or {}).get("JobRef1")
    print("  original JobRef1:", repr(orig), "| Tags:", g0.get("Tags"), "| SecondaryTrades:", (g0.get("AdditionalDetail") or {}).get("SecondaryTrades"))
    r = requests.put(f"{APIV}/Job", json=build_body(g0, r0, TEST_VAL), headers=H, timeout=60)
    print(f"  PUT test value -> {r.status_code} {r.text[:200]}")
    time.sleep(3)
    g1, r1 = get_by_id(jid), get_row(jobno)
    print("  JobRef1 now:", repr((g1.get("AdditionalDetail") or {}).get("JobRef1")), "| grid JobUserReferenceFieldValue:", repr(r1.get("JobUserReferenceFieldValue")))
    diff(g0, g1, "GetById after PUT")
    diff(r0, r1, "getall row after PUT")
    r = requests.put(f"{APIV}/Job", json=build_body(g1, r1, orig), headers=H, timeout=60)
    print(f"  PUT restore -> {r.status_code} {r.text[:120]}")
    time.sleep(3)
    g2, r2 = get_by_id(jid), get_row(jobno)
    diff(g0, g2, "GetById after restore vs original")
    diff(r0, r2, "getall row after restore vs original")
