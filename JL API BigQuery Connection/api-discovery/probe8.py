import os, json, time, urllib.request, urllib.error

TID = os.environ["JL_TENANT_ID"]; TOK = os.environ["TOKEN"]
BASE = "https://api.joblogic.com/api/v1"
H = {"Authorization": "Bearer " + TOK, "Content-Type": "application/json"}

def post(path, extra):
    time.sleep(0.7)
    body = {"TenantId": TID, "PageIndex": 1, "PageSize": 5}; body.update(extra)
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(
            f"{BASE}/{path}", data=json.dumps(body).encode(), headers=H), timeout=40))
        items = d.get("Items", [])
        first = items[0].get("JobNumber") if items and isinstance(items[0], dict) else None
        return f"Items={len(items)} Total={d.get('TotalCount')} first={first}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}: {e.read()[:150].decode('utf-8','ignore')}"
    except Exception as e:
        return f"ERR {e}"

print("=== Job/getall — SearchTerm with a REAL job number ===")
print("  SearchTerm PROJ0001624 ->", post("Job/getall", {"SearchTerm": "PROJ0001624"}))
print("  SearchTerm PROJ        ->", post("Job/getall", {"SearchTerm": "PROJ"}))

print("=== Job/getall — windows that CONTAIN known job (DateLogged 2026-06-02) ===")
wins = [
    ("1 day  06-02..06-03", "2026-06-02T00:00:00Z", "2026-06-03T00:00:00Z"),
    ("7 days 06-01..06-08", "2026-06-01T00:00:00Z", "2026-06-08T00:00:00Z"),
    ("30 days 06-01..06-30", "2026-06-01T00:00:00Z", "2026-06-30T23:59:59Z"),
    ("31 days 06-01..07-01", "2026-06-01T00:00:00Z", "2026-07-01T23:59:59Z"),
    ("61 days 05-01..06-30", "2026-05-01T00:00:00Z", "2026-06-30T23:59:59Z"),
    ("90 days 04-06..07-04", "2026-04-06T00:00:00Z", "2026-07-04T23:59:59Z"),
]
for name, s, e in wins:
    print(f"  {name:22s} ->", post("Job/getall", {"StartDate": s, "EndDate": e}))
