import os, json, urllib.request, urllib.error

TID = os.environ["JL_TENANT_ID"]; TOK = os.environ["TOKEN"]
BASE = "https://api.joblogic.com/api/v1"
F = "2015-01-01T00:00:00Z"; T = "2027-12-31T00:00:00Z"

def call(path, extra):
    body = {"TenantId": TID, "PageIndex": 1, "PageSize": 5}
    body.update(extra)
    req = urllib.request.Request(f"{BASE}/{path}", data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=40))
        return f"Items={len(d.get('Items', []))} Total={d.get('TotalCount')}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}: {e.read()[:160].decode('utf-8','ignore')}"
    except Exception as e:
        return f"ERR {e}"

print("=== Job/getall filter variants ===")
variants = {
    "baseline": {},
    "DateFrom/DateTo": {"DateFrom": F, "DateTo": T},
    "FromDate/ToDate": {"FromDate": F, "ToDate": T},
    "StartDate/EndDate": {"StartDate": F, "EndDate": T},
    "LoggedDateFrom/To": {"LoggedDateFrom": F, "LoggedDateTo": T},
    "DateLoggedFrom/To": {"DateLoggedFrom": F, "DateLoggedTo": T},
    "CreatedDateFrom/To": {"CreatedDateFrom": F, "CreatedDateTo": T},
    "LastUpdatedFrom/To": {"LastUpdatedFrom": F, "LastUpdatedTo": T},
    "ModifiedDateFrom/To": {"ModifiedDateFrom": F, "ModifiedDateTo": T},
    "CompletionDateFrom/To": {"CompletionDateFrom": F, "CompletionDateTo": T},
    "Statuses[]": {"Statuses": []},
    "JobStatuses 1..12": {"JobStatuses": list(range(1, 13))},
    "IncludeClosed/Completed": {"IncludeClosed": True, "IncludeCompleted": True},
    "SearchTerm+dates": {"SearchTerm": "", "DateFrom": F, "DateTo": T},
}
for name, extra in variants.items():
    print(f"  {name:28s} -> {call('Job/getall', extra)}")

print("=== the 400 endpoints: read their error messages ===")
for path in ["Timesheet/GetAll", "purchaseorder/getall", "JobAsset/GetAll", "Visit/GetAll", "Invoice/getall"]:
    print(f"  {path:24s} baseline -> {call(path, {})}")
    print(f"  {path:24s} +dates   -> {call(path, {'DateFrom': F, 'DateTo': T})}")
