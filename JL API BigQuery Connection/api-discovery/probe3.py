import os, json, time, urllib.request, urllib.error

TID = os.environ["JL_TENANT_ID"]; TOK = os.environ["TOKEN"]
BASE = "https://api.joblogic.com/api/v1"
F = "2024-07-31T00:00:00Z"; T = "2026-07-03T23:59:59Z"

def call(path, extra):
    time.sleep(0.7)  # stay under 100/min
    body = {"TenantId": TID, "PageIndex": 1, "PageSize": 5}; body.update(extra)
    req = urllib.request.Request(f"{BASE}/{path}", data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=40))
        return ("OK", len(d.get("Items", [])), d.get("TotalCount"))
    except urllib.error.HTTPError as e:
        return ("ERR", e.code, e.read()[:150].decode("utf-8", "ignore"))
    except Exception as e:
        return ("ERR", "?", str(e))

# date-range VALUE shapes to try for a field
shapes = {
    "string":            F,
    "From/To":           {"From": F, "To": T},
    "DateFrom/DateTo":   {"DateFrom": F, "DateTo": T},
    "StartDate/EndDate": {"StartDate": F, "EndDate": T},
    "Start/End":         {"Start": F, "End": T},
    "FromDate/ToDate":   {"FromDate": F, "ToDate": T},
}

print("=== Step 1: discover PO DateRaised shape ===")
po_shape = None
for name, val in shapes.items():
    r = call("purchaseorder/getall", {"DateRaised": val})
    print(f"  DateRaised={name:18s} -> {r}")
    if r[0] == "OK":
        po_shape = (name, val);
# also flat
r = call("purchaseorder/getall", {"DateRaisedFrom": F, "DateRaisedTo": T})
print(f"  DateRaisedFrom/To      -> {r}")

print(f"\n>>> PO working shape: {po_shape[0] if po_shape else 'NONE'}")

# Step 2: apply shapes to Job/Visit/Invoice across candidate field names
fields = ["DateLogged", "DateCreated", "CreatedDate", "LoggedDate", "Date", "DateRaised",
          "JobDate", "DateBooked", "CompletedDate", "TargetCompletionDate", "DateRange",
          "AppointmentDate", "DateRange", "SearchDateRange"]
try_shapes = [po_shape[1]] if po_shape else list(shapes.values())

for path in ["Job/getall", "Visit/GetAll", "Invoice/getall"]:
    print(f"\n=== Step 2: {path} ===")
    hit = False
    for fld in fields:
        for val in try_shapes:
            r = call(path, {fld: val})
            if r[0] == "OK" and r[1] > 0:
                print(f"  >>> HIT {fld} = {json.dumps(val)[:60]} -> Items={r[1]} Total={r[2]}")
                hit = True; break
            if r[0] == "ERR" and r[1] == 400:
                print(f"  400 on {fld}: {r[2][:120]}")
        if hit: break
    if not hit:
        print("  no hit")
