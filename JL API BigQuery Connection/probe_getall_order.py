"""Does Job/getall (loader source) return the Customer Order Number? Run on VM. Read-only."""
import os, json, requests
CID=os.environ["JL_CLIENT_ID"]; CSEC=os.environ["JL_CLIENT_SECRET"]; TID=os.environ["JL_TENANT_ID"]
APIV="https://api.joblogic.com/api/v1"; JOBNO=os.environ.get("PROBE_JOBNO","PROJ0000467")
tok=requests.post("https://identityservice.joblogic.com/connect/token",
    data={"grant_type":"client_credentials","client_id":CID,"client_secret":CSEC,"scope":"JL.Api"},
    timeout=60).json()["access_token"]
H={"Authorization":f"Bearer {tok}","Content-Type":"application/json"}
body={"TenantId":TID,"PageIndex":1,"PageSize":5,"SearchTerm":JOBNO,
      "IncludeReactiveJobs":True,"IncludePPMJobs":True,"IncludeInactive":True,
      "IncludeTags":True,"IncludeContacts":True,"IncludeNotes":True,"OrderBy":0}
r=requests.post(f"{APIV}/Job/getall",json=body,headers=H,timeout=60)
print("status",r.status_code)
items=r.json().get("Items",[])
print("items:",len(items))
if items:
    it=items[0]
    print("JobNumber:",it.get("JobNumber"))
    # every key mentioning order/reference/custom + its value
    for k in sorted(it):
        if any(w in k.lower() for w in ("order","reference","custom","ref")):
            print(f"  {k} = {it[k]!r}")
