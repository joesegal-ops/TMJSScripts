import os, json, time, urllib.request, urllib.parse, urllib.error

TID = os.environ["JL_TENANT_ID"]; TOK = os.environ["TOKEN"]
BASE = "https://api.joblogic.com/api/v1"
H = {"Authorization": "Bearer " + TOK, "Content-Type": "application/json"}

def get(path, params):
    time.sleep(0.7)
    url = f"{BASE}/{path}?" + urllib.parse.urlencode(params)
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=40))
        return ("OK", d)
    except urllib.error.HTTPError as e:
        return ("ERR", e.code, e.read()[:200].decode("utf-8", "ignore"))
    except Exception as e:
        return ("ERR", "?", str(e))

def post(path, extra):
    time.sleep(0.7)
    body = {"TenantId": TID, "PageIndex": 1, "PageSize": 5}; body.update(extra)
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(
            f"{BASE}/{path}", data=json.dumps(body).encode(), headers=H), timeout=40))
        return ("OK", len(d.get("Items", [])), d.get("TotalCount"))
    except urllib.error.HTTPError as e:
        return ("ERR", e.code, e.read()[:200].decode("utf-8", "ignore"))
    except Exception as e:
        return ("ERR", "?", str(e))

JOB_ID = "31855808"  # PROJ0001624, from the app URL /Job/Detail/31855808

print("=== Job/GetById (known job) ===")
r = get("Job/GetById", {"id": JOB_ID, "tenantId": TID})
if r[0] == "OK":
    d = r[1]
    print("  OK. type:", type(d).__name__, "keys:", list(d.keys())[:20] if isinstance(d, dict) else "n/a")
else:
    print("  ", r)

print("=== Job/GetById +additionalDetails ===")
print("  ", get("Job/GetById", {"id": JOB_ID, "tenantId": TID, "includeAdditionalDetails": "true"})[0:2])

print("=== Visit/GetAll for that JobId ===")
print("  ", post("Visit/GetAll", {"JobId": JOB_ID}))

print("=== StatusIds as comma-string + dates ===")
print("  ", post("Job/getall", {"StatusIds": "1,2,3,4,5,6,7,8,9,10,11,12",
                                 "StartDate": "2024-07-31T00:00:00Z", "EndDate": "2026-07-04T23:59:59Z"}))

print("=== Invoice/getall with dates ===")
print("  ", post("Invoice/getall", {"StartDate": "2024-07-31T00:00:00Z", "EndDate": "2026-07-04T23:59:59Z"}))
