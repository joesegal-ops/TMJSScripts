"""Validate the extraction rule: scan BOTH Customer Order Number (OrderNumber) and Reference Number
(ReferenceNumber) for PO-\\d+ (-> PO Number) and an 8-digit SF ID (-> Client Reference).
Also confirms ReferenceNumber is returned by GetById. Run on VM. Read-only."""
import os, re, requests
from google.cloud import bigquery

CID=os.environ["JL_CLIENT_ID"]; CSEC=os.environ["JL_CLIENT_SECRET"]; TID=os.environ["JL_TENANT_ID"]
APIV="https://api.joblogic.com/api/v1"
tok=requests.post("https://identityservice.joblogic.com/connect/token",
    data={"grant_type":"client_credentials","client_id":CID,"client_secret":CSEC,"scope":"JL.Api"},
    timeout=60).json()["access_token"]
H={"Authorization":f"Bearer {tok}"}

bq=bigquery.Client(project="vmimporteddata")
sql="""SELECT Id, JobNumber FROM `vmimporteddata.raw.jobs`
       WHERE TypeDescription='Project' AND CustomerName='WeWork Ltd'
         AND DateLogged>=TIMESTAMP('2026-06-15')
       ORDER BY DateLogged DESC LIMIT 20"""
ids=[(r["Id"], r["JobNumber"]) for r in bq.query(sql).result()]

PO_RE=re.compile(r'(?:PO|REQ)-?\d+', re.I)          # PO or REQ number -> PO Number
def extract(order, ref):
    blob=" ".join(v for v in (ref, order) if v)     # ref first so SF prefers the clean ReferenceNumber
    po=PO_RE.search(blob)
    stripped=re.sub(r'[A-Za-z]+-?\d+', ' ', blob)    # drop any alpha-prefixed token (PO-/REQ-/LG-101…)
    sf=re.search(r'\b\d{8,9}\b', stripped)           # standalone 8- or 9-digit = SF ID
    return (po.group(0) if po else None), (sf.group(0) if sf else None)

print(f"{'Job':13} {'OrderNumber':28} {'ReferenceNumber':20} -> PO / SF")
seen_refkeys=set()
for jid,jno in ids:
    try:
        r=requests.get(f"{APIV}/Job/GetById",params={"id":jid,"tenantId":TID},headers=H,timeout=40)
        if r.status_code!=200: print(f"{jno:13} GetById {r.status_code}"); continue
        o=r.json(); o=o.get("Data",o) if isinstance(o,dict) else {}
        for k in o:
            if 'ref' in k.lower() or 'order' in k.lower(): seen_refkeys.add(k)
        on=o.get("OrderNumber"); rn=o.get("ReferenceNumber")
        po,sf=extract(on,rn)
        print(f"{jno:13} {str(on)[:27]:28} {str(rn)[:19]:20} -> PO={po} SF={sf}")
    except Exception as e:
        print(f"{jno:13} ERR {e}")
print("\nGetById keys containing ref/order:", sorted(seen_refkeys))
