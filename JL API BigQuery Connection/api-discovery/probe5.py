import os, json, time, urllib.request, urllib.error

TID = os.environ["JL_TENANT_ID"]; TOK = os.environ["TOKEN"]
BASE = "https://api.joblogic.com/api/v1"

def call(path, extra):
    time.sleep(0.7)
    body = {"TenantId": TID, "PageIndex": 1, "PageSize": 5}; body.update(extra)
    req = urllib.request.Request(f"{BASE}/{path}", data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=40))
        return ("OK", len(d.get("Items", [])), d.get("TotalCount"))
    except urllib.error.HTTPError as e:
        return ("ERR", e.code, e.read()[:180].decode("utf-8", "ignore"))
    except Exception as e:
        return ("ERR", "?", str(e))

print("=== A. Job/getall StartDate/EndDate window sweep ===")
windows = [
    ("7 days",  "2026-06-26T00:00:00Z", "2026-07-03T23:59:59Z"),
    ("1 month", "2026-06-01T00:00:00Z", "2026-07-03T23:59:59Z"),
    ("3 months","2026-04-01T00:00:00Z", "2026-07-03T23:59:59Z"),
    ("1 year",  "2025-07-01T00:00:00Z", "2026-07-03T23:59:59Z"),
    ("full",    "2024-07-31T00:00:00Z", "2026-07-03T23:59:59Z"),
    ("date-only 1mo", "2026-06-01", "2026-07-03"),
]
for name, s, e in windows:
    print(f"  {name:14s} {s}..{e} -> {call('Job/getall', {'StartDate': s, 'EndDate': e})}")

print("\n=== B. Visit/GetAll extra field injection ===")
for fld in ["JobId","JobReference","VisitStatusIds","StatusIds","EngineerId","EngineerIds",
            "StartDate","EndDate","DateFrom","DateTo","DateRaised","VisitDateFrom"]:
    r = call("Visit/GetAll", {fld: {"probe": 1}})
    if r[0]=="ERR" and r[1]==400 and fld in r[2]: print(f"  REAL {fld}")

print("\n=== C. Invoice/getall extra field injection ===")
for fld in ["StatusIds","InvoiceStatusIds","DateRaised","JobId","DateFrom","DateTo",
            "InvoiceDateFrom","InvoiceDateTo","StartDate","EndDate","DateIssued"]:
    r = call("Invoice/getall", {fld: {"probe": 1}})
    if r[0]=="ERR" and r[1]==400 and fld in r[2]: print(f"  REAL {fld}")
