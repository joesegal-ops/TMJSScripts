"""Build task 1b: Job/getbyid & Job/GetById returned 400 (route exists, wrong param). Find the
right parameter shape and check whether the returned job object carries QuoteId.

Run ON THE VM. Same env-var creds as probe_job_quoteid.py.
  cd /opt/jl-loader
  JL_CLIENT_ID=$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata) \
  JL_CLIENT_SECRET=$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata) \
  JL_TENANT_ID=$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata) \
  ./venv/bin/python /tmp/probe_job_quoteid2.py
"""
import os, time, json, requests

CID = os.environ["JL_CLIENT_ID"]; CSEC = os.environ["JL_CLIENT_SECRET"]; TID = os.environ["JL_TENANT_ID"]
BASE = "https://api.joblogic.com/api/v1"
TOKEN_URL = "https://identityservice.joblogic.com/connect/token"
NUM = 30798926
GUID = "65c6c083-d46d-4e5f-8d6b-9fc7a4a620c4"
JOBNO = "PROJ0000885"
EXPECT = 12137915

tok = requests.post(TOKEN_URL, data={"grant_type": "client_credentials", "client_id": CID,
    "client_secret": CSEC, "scope": "JL.Api"}, timeout=60).json()["access_token"]
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

def show(label, r):
    body = r.text
    tag = ""
    if r.status_code == 200:
        try:
            obj = r.json()
            # unwrap common envelopes
            for k in ("Item", "Data", "Result", "Job"):
                if isinstance(obj, dict) and isinstance(obj.get(k), dict):
                    obj = obj[k]; break
            if isinstance(obj, dict):
                qkeys = [k for k in obj.keys() if "uote" in k.lower() or "parent" in k.lower()]
                qid = obj.get("QuoteId")
                tag = f" | keys={len(obj)} quote/parent={qkeys} QuoteId={qid}"
                if qid == EXPECT: tag += "  <<< MATCH"
        except Exception as e:
            tag = f" | json-err {e}"
    else:
        tag = f" | body={body[:120]}"
    print(f"  {label} -> {r.status_code} len={len(body)}{tag}")

print("=== GET variants ===")
gets = [
    f"Job/getbyid?id={NUM}", f"Job/getbyid?jobId={NUM}", f"Job/getbyid?jobID={NUM}",
    f"Job/getbyid?Id={NUM}", f"Job/getbyid?JobId={NUM}", f"Job/getbyid?uniqueId={GUID}",
    f"Job/getbyid?jobNumber={JOBNO}", f"Job/getbyid?id={NUM}&tenantId={TID}",
    f"Job/GetById?id={NUM}", f"Job/GetById?jobId={NUM}", f"Job/GetById?uniqueId={GUID}",
    f"Job/GetById?jobNumber={JOBNO}", f"Job/GetById?jobId={GUID}",
]
for p in gets:
    time.sleep(0.6)
    try: show(p, requests.get(f"{BASE}/{p}", headers=H, timeout=40))
    except Exception as e: print(f"  {p} -> ERR {e}")

print("=== POST variants (body) ===")
posts = [
    ("Job/getbyid", {"TenantId": TID, "Id": NUM}),
    ("Job/getbyid", {"TenantId": TID, "JobId": NUM}),
    ("Job/getbyid", {"TenantId": TID, "UniqueId": GUID}),
    ("Job/getbyid", {"TenantId": TID, "JobNumber": JOBNO}),
    ("Job/GetById", {"TenantId": TID, "Id": NUM}),
    ("Job/GetById", {"TenantId": TID, "JobId": NUM}),
    ("Job/GetById", {"Id": NUM}),
    ("Job/GetById", {"JobId": NUM}),
]
for p, b in posts:
    time.sleep(0.6)
    try: show(f"{p} {json.dumps(b)}", requests.post(f"{BASE}/{p}", json=b, headers=H, timeout=40))
    except Exception as e: print(f"  {p} -> ERR {e}")
