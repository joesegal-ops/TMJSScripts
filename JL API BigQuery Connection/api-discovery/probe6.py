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
        return ("OK", len(d.get("Items", [])), d.get("TotalCount"), d.get("Items", [])[:1])
    except urllib.error.HTTPError as e:
        return ("ERR", e.code, e.read()[:180].decode("utf-8", "ignore"), None)
    except Exception as e:
        return ("ERR", "?", str(e), None)

FULL = {"StartDate": "2024-07-31T00:00:00Z", "EndDate": "2026-07-04T23:59:59Z"}

# get a real CustomerId
cust = call("Customer/GetAll", {})
cid = None
if cust[0] == "OK" and cust[3]:
    rec = cust[3][0]
    print("customer record keys:", list(rec.keys()))
    for k in rec:
        if k.lower() in ("id", "customerid", "uniqueid"):
            cid = rec[k]; print(f"  using CustomerId={k}={cid}")
            break

tests = {
    "SearchTerm PM0001607": {"SearchTerm": "PM0001607"},
    "SearchTerm RE0012455": {"SearchTerm": "RE0012455"},
    "StatusIds 1..12":      {"StatusIds": list(range(1, 13))},
    "dates+StatusIds":      {**FULL, "StatusIds": list(range(1, 13))},
    "dates+IncludeInactive":{**FULL, "IncludeInactive": True, "StatusIds": list(range(1, 13))},
}
if cid is not None:
    tests["CustomerId+dates"] = {"CustomerId": cid, **FULL}
    tests["CustomerId only"] = {"CustomerId": cid}

print("\n=== Job/getall decisive tests ===")
for name, extra in tests.items():
    r = call("Job/getall", extra)
    print(f"  {name:24s} -> {r[0]} Items={r[1]} Total={r[2]}" + (f"  ERR:{r[2]}" if r[0]=="ERR" else ""))
    if r[0] == "OK" and r[1] > 0:
        print("     FIELDS:", list(r[3][0].keys()))
