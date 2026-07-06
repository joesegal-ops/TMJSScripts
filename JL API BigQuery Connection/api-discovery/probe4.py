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
        return ("ERR", e.code, e.read()[:220].decode("utf-8", "ignore"))
    except Exception as e:
        return ("ERR", "?", str(e))

# Send each candidate field an OBJECT value. If the field is REAL, the server tries to parse
# it and errors, naming the field. If unknown, it's ignored (Items=0, no error).
candidates = ["DateLogged","DateCreated","CreatedDate","LoggedDate","Date","DateFrom","DateTo",
    "DateRaised","JobDate","DateBooked","CompletedDate","DateCompleted","TargetCompletionDate",
    "AppointmentDate","Status","Statuses","JobStatus","JobStatuses","StatusIds","CustomerId",
    "SiteId","SearchTerm","Reference","JobReference","JobType","JobTypeId","Priority","PriorityId",
    "Trade","EngineerId","IncludeInactive","Tags","TagIds","DateIssued","InvoiceDate","VisitDate",
    "DateAllocated","DateRange","StartDate","EndDate"]

for path in ["Job/getall", "Visit/GetAll", "Invoice/getall"]:
    print(f"=== {path}: which candidate names are REAL fields? ===")
    real = []
    for fld in candidates:
        r = call(path, {fld: {"probe": 1}})
        if r[0] == "ERR" and r[1] == 400 and fld in r[2]:
            print(f"  REAL  {fld}: {r[2][:130]}")
            real.append(fld)
    print(f"  -> real fields found: {real if real else 'NONE (all ignored/unknown)'}\n")
