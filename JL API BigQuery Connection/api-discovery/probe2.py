import os, json, urllib.request, urllib.error

TID = os.environ["JL_TENANT_ID"]; TOK = os.environ["TOKEN"]
BASE = "https://api.joblogic.com/api/v1"
F = "2015-01-01T00:00:00Z"; T = "2027-12-31T00:00:00Z"

def call(path, extra):
    body = {"TenantId": TID, "PageIndex": 1, "PageSize": 5}; body.update(extra)
    req = urllib.request.Request(f"{BASE}/{path}", data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=40))
        return f"Items={len(d.get('Items', []))} Total={d.get('TotalCount')}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}: {e.read()[:200].decode('utf-8','ignore')}"
    except Exception as e:
        return f"ERR {e}"

# candidate nested range-object field names, x two inner shapes
range_fields = ["DateLogged", "LoggedDate", "DateCreated", "CreatedDate", "JobDate",
                "DateRaised", "VisitDate", "AppointmentDate", "Date", "DateRange", "InvoiceDate"]
inner_shapes = [("From/To", {"From": F, "To": T}), ("Start/End", {"StartDate": F, "EndDate": T})]

for path in ["Job/getall", "Visit/GetAll", "Invoice/getall", "purchaseorder/getall"]:
    print(f"=== {path} ===")
    hit = False
    for fld in range_fields:
        for label, inner in inner_shapes:
            res = call(path, {fld: inner})
            if not res.startswith("Items=0") and "HTTP 400" not in res:
                print(f"   >>> {fld} ({label}) -> {res}")
                hit = True
    if not hit:
        # show one representative 400 to learn the required field name
        print("   (no hit; sample error with empty body):", call(path, {}))

print("=== Timesheet with StartDate/EndDate ===")
print("  ", call("Timesheet/GetAll", {"StartDate": F, "EndDate": T}))
