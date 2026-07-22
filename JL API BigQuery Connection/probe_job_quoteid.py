"""Build task 1: find where the official JL API exposes the job->quote link (QuoteId).

Run ON THE VM (whitelisted IP). Reads JL_CLIENT_ID / JL_CLIENT_SECRET / JL_TENANT_ID from env.

  cd /opt/jl-loader
  JL_CLIENT_ID=$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata) \
  JL_CLIENT_SECRET=$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata) \
  JL_TENANT_ID=$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata) \
  ./venv/bin/python probe_job_quoteid.py

Prints which approach yields QuoteId=12137915 for job PROJ0000885 (Id 30798926). Paste output back.
"""
import os, time, requests

CID = os.environ["JL_CLIENT_ID"]; CSEC = os.environ["JL_CLIENT_SECRET"]; TID = os.environ["JL_TENANT_ID"]
BASE = "https://api.joblogic.com/api/v1"
TOKEN_URL = "https://identityservice.joblogic.com/connect/token"
JOBID = 30798926; JOBNO = "PROJ0000885"; EXPECT = 12137915

tok = requests.post(TOKEN_URL, data={"grant_type": "client_credentials", "client_id": CID,
    "client_secret": CSEC, "scope": "JL.Api"}, timeout=60).json()["access_token"]
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

def quote_keys(obj):
    return [k for k in obj.keys() if "uote" in k.lower() or "parent" in k.lower()] if isinstance(obj, dict) else []

# 1) Job/getall with EVERY include flag we can think of — does a row gain a quote field?
print("=== 1. Job/getall with extended include flags ===")
flags = {"IncludeReactiveJobs": True, "IncludePPMJobs": True, "IncludeInactive": True,
         "IncludeTags": True, "IncludeContacts": True, "IncludeNotes": True,
         "IncludeQuote": True, "IncludeQuoteDetails": True, "IncludeCosts": True,
         "IncludeRelated": True, "IncludeParent": True, "IncludeLinkedRecords": True}
body = {"TenantId": TID, "PageIndex": 1, "PageSize": 5, "SearchTerm": JOBNO}; body.update(flags)
r = requests.post(f"{BASE}/Job/getall", json=body, headers=H, timeout=60)
print("  status", r.status_code)
if r.ok:
    items = r.json().get("Items", [])
    if items:
        print("  quote/parent-ish keys:", quote_keys(items[0]) or "NONE")
        hit = {k: v for k, v in items[0].items() if v == EXPECT}
        if hit: print("  *** field holding 12137915:", hit)

# 2) candidate single-job detail endpoints
print("=== 2. single-job endpoints ===")
for method, path in [("GET", f"Job/get?id={JOBID}"), ("GET", f"Job/{JOBID}"),
                     ("GET", f"Job/getbyid?id={JOBID}"), ("GET", f"Job/detail?id={JOBID}"),
                     ("GET", f"Job/getdetail?id={JOBID}"), ("GET", f"Job/GetById?jobId={JOBID}"),
                     ("POST", "Job/get"), ("POST", "Job/getdetail")]:
    time.sleep(0.6)
    try:
        if method == "GET":
            r = requests.get(f"{BASE}/{path}", headers=H, timeout=40)
        else:
            r = requests.post(f"{BASE}/{path}", json={"TenantId": TID, "Id": JOBID, "JobId": JOBID}, headers=H, timeout=40)
        body_txt = r.text
        has = '"QuoteId"' in body_txt
        val = ""
        if has:
            import re; m = re.search(r'"QuoteId":\s*([0-9]+)', body_txt); val = " -> " + (m.group(1) if m else "?")
        print(f"  {method} {path} -> {r.status_code} len={len(body_txt)}{' QUOTEID'+val if has else ''}")
    except Exception as e:
        print(f"  {method} {path} -> ERR {e}")

print("\nWANT: an endpoint returning QuoteId == 12137915. If none, the link is web-only (TamperMonkey path).")
