"""
Read-only probe v6: Invoice/CustomerGrouped/GetById?uniqueId={GUID}&tenantId={tid}
(correct endpoint for Customer Grouped invoices). Target #1922 (UniqueId a0fd08fb-...-45f8a3).
Dump the full response + every line, looking for a per-line JobNumber/JobId + net amount.
"""
import os, json, time, requests

TID  = os.environ["JL_TENANT_ID"]; CID = os.environ["JL_CLIENT_ID"]; CSEC = os.environ["JL_CLIENT_SECRET"]
APIV = "https://api.joblogic.com/api/v1"
tok = requests.post("https://identityservice.joblogic.com/connect/token",
    data={"grant_type":"client_credentials","client_id":CID,"client_secret":CSEC,"scope":"JL.Api"},
    timeout=60).json()["access_token"]
H = {"Authorization": f"Bearer {tok}", "Accept":"application/json"}

UID = "a0fd08fb-8e27-4c2b-b301-d9719a45f8a3"  # invoice #001922, Type 2, £61,167.86

def find_lines(o, d=0):
    if d>9 or o is None: return None
    if isinstance(o, dict):
        for k,v in o.items():
            if "line" in k.lower() and isinstance(v,list) and v: return (k,v)
        for v in o.values():
            h=find_lines(v,d+1)
            if h: return h
    elif isinstance(o,list):
        for v in o:
            h=find_lines(v,d+1)
            if h: return h
    return None

time.sleep(0.4)
r = requests.get(f"{APIV}/Invoice/CustomerGrouped/GetById",
                 headers=H, params={"uniqueId": UID, "tenantId": TID}, timeout=60)
print(f"GET Invoice/CustomerGrouped/GetById?uniqueId={UID} -> HTTP {r.status_code}")
if r.status_code != 200:
    print(r.text[:400]); raise SystemExit

j = r.json()
obj = j.get("Data", j) if isinstance(j, dict) else j
print("top-level keys:", sorted(obj.keys()) if isinstance(obj, dict) else type(obj).__name__)

h = find_lines(j)
if not h:
    print("NO line list found. Full response (truncated):")
    print(json.dumps(j, default=str)[:2500]); raise SystemExit

key, lines = h
print(f"\nFOUND {len(lines)} lines under '{key}'. line[0] keys: {sorted(lines[0].keys())}\n")
# Which keys look like a job reference / amount?
sums = 0.0
for i, ln in enumerate(lines):
    job = next((ln[k] for k in ln if "job" in k.lower() and ln[k]), None)
    net = next((ln[k] for k in ln if k.lower() in
               ("totalexcludingvat","sellexcludingvat","netamount","amountexcludingvat","totalexvat")), None)
    desc = next((ln[k] for k in ln if "desc" in k.lower()), "")
    try: sums += float(net or 0)
    except (TypeError, ValueError): pass
    if i < 15:
        print(f"  line {i}: job={job!r} net={net!r} desc={str(desc)[:60]!r}")
print(f"\n  lines total net = {sums:.2f}  (header net was 61167.86)")
print("\n  FULL line[0]:")
print(json.dumps(lines[0], indent=2, default=str)[:1500])
