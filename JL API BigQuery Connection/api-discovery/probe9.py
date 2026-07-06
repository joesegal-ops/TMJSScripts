import os, json, time, urllib.request, urllib.parse, urllib.error

TID = os.environ["JL_TENANT_ID"]; TOK = os.environ["TOKEN"]
BASE = "https://api.joblogic.com/api/v1"
H = {"Authorization": "Bearer " + TOK, "Content-Type": "application/json"}

def post(path, extra):
    time.sleep(0.7)
    body = {"TenantId": TID, "PageIndex": 1, "PageSize": 5}; body.update(extra)
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(
            f"{BASE}/{path}", data=json.dumps(body).encode(), headers=H), timeout=40))
        return f"Items={len(d.get('Items', []))} Total={d.get('TotalCount')}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}: {e.read()[:140].decode('utf-8','ignore')}"
    except Exception as e:
        return f"ERR {e}"

def get(path, params):
    time.sleep(0.7)
    url = f"{BASE}/{path}?" + urllib.parse.urlencode(params)
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=40))
        return f"OK {str(d)[:160]}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}: {e.read()[:140].decode('utf-8','ignore')}"
    except Exception as e:
        return f"ERR {e}"

print("=== more real-field injection on Job/getall ===")
for fld in ["DateType","DateFilterType","SearchType","DateRangeType","DateRangeFilter","Filter",
            "JobStatusIds","Statuses","JobTypeIds","JobCategoryIds","JobTypeId","CategoryId",
            "OwnerId","AssignedTo","Reference"]:
    r = post("Job/getall", {fld: {"probe": 1}})
    if "HTTP 400" in r and fld in r:
        print(f"  REAL {fld}: {r}")

print("=== Job/getall broad StatusIds + full dates ===")
sid = ",".join(str(i) for i in range(1, 41))
print("  StatusIds 1..40 + dates ->", post("Job/getall", {"StatusIds": sid,
      "StartDate": "2024-07-31T00:00:00Z", "EndDate": "2026-07-04T23:59:59Z"}))

print("=== alternate job-search GET endpoints ===")
print("  Job/searchjobref2 (jobRef) ->", get("Job/searchjobref2", {"tenantId": TID, "jobRef": "PROJ0001624"}))
print("  Job/searchjobref2 (search) ->", get("Job/searchjobref2", {"tenantId": TID, "searchTerm": "PROJ"}))
