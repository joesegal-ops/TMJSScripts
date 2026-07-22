"""Build task 1c: the working detail route is GET {Entity}/getbyid?id=<numeric>&tenantId=<GUID>.
Job/getbyid has no QuoteId. Check (a) ALL job fields for an oddly-named link, and (b) whether
Quote/getbyid returns the resulting job for an upgraded quote (cleanest path if so).

Run ON THE VM. Same env-var creds.
  ./venv/bin/python /tmp/probe_job_quoteid3.py
"""
import os, time, json, requests

CID = os.environ["JL_CLIENT_ID"]; CSEC = os.environ["JL_CLIENT_SECRET"]; TID = os.environ["JL_TENANT_ID"]
BASE = "https://api.joblogic.com/api/v1"
TOKEN_URL = "https://identityservice.joblogic.com/connect/token"
JOB_NUM = 30798926; JOB_STR = "PROJ0000885"
QUOTE_ID = 12137915; QUOTE_STR = "UP01820"

tok = requests.post(TOKEN_URL, data={"grant_type": "client_credentials", "client_id": CID,
    "client_secret": CSEC, "scope": "JL.Api"}, timeout=60).json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}

def get(path):
    return requests.get(f"{BASE}/{path}", headers=H, timeout=40)

print("=== A. Job/getbyid — ALL fields + search for the quote id/number anywhere ===")
r = get(f"Job/getbyid?id={JOB_NUM}&tenantId={TID}")
print("status", r.status_code, "len", len(r.text))
if r.ok:
    obj = r.json()
    if isinstance(obj, dict) and len(obj) == 1:  # unwrap envelope if any
        only = list(obj.values())[0]
        if isinstance(only, dict): obj = only
    print("keys:", sorted(obj.keys()))
    txt = r.text
    print("contains quote Id 12137915 ?", str(QUOTE_ID) in txt, "| contains 'UP01820' ?", QUOTE_STR in txt)

print("\n=== B. Job/getbyid with include-quote flags ===")
for extra in ["&includeQuote=true", "&includeQuoteDetails=true", "&includeParent=true",
              "&includeRelated=true", "&includeAll=true"]:
    time.sleep(0.6)
    r = get(f"Job/getbyid?id={JOB_NUM}&tenantId={TID}{extra}")
    has = r.ok and ('"QuoteId"' in r.text or str(QUOTE_ID) in r.text)
    print(f"  {extra:30s} -> {r.status_code} len={len(r.text)} quoteLink={has}")

print("\n=== C. Quote/getbyid — does an upgraded quote return its resulting job? ===")
for path in [f"Quote/getbyid?id={QUOTE_ID}&tenantId={TID}",
             f"Quote/GetById?id={QUOTE_ID}&tenantId={TID}"]:
    time.sleep(0.6)
    r = get(path)
    print(f"  {path.split('?')[0]} -> {r.status_code} len={len(r.text)}")
    if r.ok:
        obj = r.json()
        if isinstance(obj, dict) and len(obj) == 1:
            only = list(obj.values())[0]
            if isinstance(only, dict): obj = only
        if isinstance(obj, dict):
            jobish = [k for k in obj.keys() if "job" in k.lower()]
            print("    all keys:", sorted(obj.keys()))
            print("    job-ish keys:", jobish, "| values:", {k: obj[k] for k in jobish})
            txt = r.text
            print("    contains job 30798926 ?", str(JOB_NUM) in txt, "| contains 'PROJ0000885' ?", JOB_STR in txt)
