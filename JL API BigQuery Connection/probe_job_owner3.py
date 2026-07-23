"""Read-only: (1) GetById on a real job -> show current OwnerUserId + Owner name (round-trip feasibility).
(2) find a Staff/User list endpoint that exposes the integer OwnerUserId for name->id resolution.
Run on the VM. NON-MUTATING."""
import os, json, requests
CID=os.environ["JL_CLIENT_ID"]; CSEC=os.environ["JL_CLIENT_SECRET"]; TID=os.environ["JL_TENANT_ID"]
BASE="https://api.joblogic.com"; APIV=BASE+"/api/v1"
JOBID=os.environ.get("PROBE_JOBID","30798926")
tok=requests.post("https://identityservice.joblogic.com/connect/token",
    data={"grant_type":"client_credentials","client_id":CID,"client_secret":CSEC,"scope":"JL.Api"},
    timeout=60).json()["access_token"]
H={"Authorization":f"Bearer {tok}","Content-Type":"application/json"}

print("=== GetById job", JOBID, "===")
r=requests.get(f"{APIV}/Job/GetById?id={JOBID}&tenantId={TID}",headers=H,timeout=40)
print("status",r.status_code)
if r.ok:
    j=r.json()
    obj=j.get("Data",j) if isinstance(j,dict) else j
    if isinstance(obj,dict):
        print("top-level keys:",sorted(obj.keys()))
        print("Owner:",obj.get("Owner"))
        ad=obj.get("JobAdditionalDetail") or obj.get("AdditionalDetail") or {}
        print("JobAdditionalDetail.OwnerUserId:",ad.get("OwnerUserId") if isinstance(ad,dict) else ad)
        print("JobNumber:",obj.get("JobNumber"),"Status:",obj.get("Status"),"JobType:",obj.get("JobType"))
else:
    print(r.text[:400])

# staff/user endpoints that could map name -> integer OwnerUserId
spec=requests.get(f"{BASE}/swagger/v1/swagger.json",headers={"Authorization":f"Bearer {tok}"},timeout=60).json()
print("\n=== paths mentioning user/staff/engineer ===")
for p,ops in spec["paths"].items():
    if any(w in p.lower() for w in ("user","staff","engineer")):
        for m in ops:
            if m in ("get","post","put","patch","delete"): print(f"  {m.upper():6} {p}")

def resolve(ref):
    n=spec
    for x in ref.lstrip("#/").split("/"): n=n.get(x,{})
    return n
# schemas that carry BOTH an int id and a name/email (candidate resolver payloads)
print("\n=== response schemas with int Id + Name/Email ===")
schemas=spec.get("components",{}).get("schemas",{})
for name,sc in schemas.items():
    if not any(w in name.lower() for w in ("user","staff","engineer")): continue
    props=sc.get("properties",{}) or {}
    has_int_id=any(k.lower() in ("id","userid","staffid") and props[k].get("type")=="integer" for k in props)
    has_name=any(("name" in k.lower() or "email" in k.lower()) for k in props)
    if has_int_id and has_name:
        print(f"  {name}: {[k for k in props if k.lower() in ('id','userid','staffid') or 'name' in k.lower() or 'email' in k.lower()]}")
