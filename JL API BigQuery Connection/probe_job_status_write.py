"""Build task (status sync): does the official JobLogic API allow WRITING a job's status?

SAFE: every call uses a NON-EXISTENT job id (999999999) and no real status value, so it can only
ever return an error. We infer endpoint existence from the status code, we never mutate a job:
  404            -> route does not exist
  400/422/500    -> route EXISTS (rejected our bogus id / body) — worth pursuing
  401/403        -> route exists but auth/permission/whitelist issue
  405            -> route exists, wrong HTTP verb

Run ON THE VM (whitelisted IP). Same env-var creds as the other probes.
  cd /opt/jl-loader
  JL_CLIENT_ID=$(gcloud secrets versions access latest --secret=jl-client-id --project=vmimporteddata) \
  JL_CLIENT_SECRET=$(gcloud secrets versions access latest --secret=jl-client-secret --project=vmimporteddata) \
  JL_TENANT_ID=$(gcloud secrets versions access latest --secret=jl-tenant-id --project=vmimporteddata) \
  ./venv/bin/python /tmp/probe_job_status_write.py
"""
import os, time, json, requests

CID = os.environ["JL_CLIENT_ID"]; CSEC = os.environ["JL_CLIENT_SECRET"]; TID = os.environ["JL_TENANT_ID"]
BASE = "https://api.joblogic.com/api/v1"
TOKEN_URL = "https://identityservice.joblogic.com/connect/token"
FAKE_ID = 999999999          # non-existent job id — guarantees no real job is touched

tok = requests.post(TOKEN_URL, data={"grant_type": "client_credentials", "client_id": CID,
    "client_secret": CSEC, "scope": "JL.Api"}, timeout=60).json()["access_token"]
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

def show(method, path, r):
    hint = {404: "no route", 405: "route exists (wrong verb)", 400: "route EXISTS (bad input)",
            422: "route EXISTS (validation)", 500: "route EXISTS (server err)", 401: "auth",
            403: "auth/whitelist"}.get(r.status_code, "")
    print(f"  {method:5s} {path:34s} -> {r.status_code} {hint} | {r.text[:90].strip()}")

# Candidate write endpoints (guessing JL conventions). Bogus id + minimal/no status.
CANDS = [
    ("PUT",   f"Job/updatestatus?id={FAKE_ID}&tenantId={TID}"),
    ("POST",  f"Job/updatestatus"),
    ("POST",  f"Job/UpdateStatus"),
    ("POST",  f"Job/changestatus"),
    ("POST",  f"Job/setstatus"),
    ("POST",  f"Job/updatejobstatus"),
    ("PUT",   f"Job/update?id={FAKE_ID}&tenantId={TID}"),
    ("POST",  f"Job/update"),
    ("PATCH", f"Job/{FAKE_ID}?tenantId={TID}"),
    ("PUT",   f"Job/{FAKE_ID}/status?tenantId={TID}"),
    ("POST",  f"JobStatus/update"),
    ("POST",  f"Job/create"),          # existence check only; bogus body -> should reject
]
BODY = {"TenantId": TID, "Id": FAKE_ID, "JobId": FAKE_ID}   # no status value on purpose

print("=== job status-write endpoint discovery (safe: fake id, no real status) ===")
for method, path in CANDS:
    time.sleep(0.6)
    try:
        url = f"{BASE}/{path}"
        if method == "POST":  r = requests.post(url, json=BODY, headers=H, timeout=30)
        elif method == "PUT": r = requests.put(url, json=BODY, headers=H, timeout=30)
        else:                 r = requests.patch(url, json=BODY, headers=H, timeout=30)
        show(method, path, r)
    except Exception as e:
        print(f"  {method} {path} -> ERR {e}")

print("\nInterpretation: any 400/422/500/405 = the route exists and Monday->JL writeback is viable.")
print("All 404 = no write endpoint in the official API -> Monday->JL would need a browser/userscript path.")
