"""Find a public-API endpoint that lists PPM contracts with their Tags (for StatutoryPPM). Run on VM. Read-only."""
import os, json, requests
CID=os.environ["JL_CLIENT_ID"]; CSEC=os.environ["JL_CLIENT_SECRET"]; TID=os.environ["JL_TENANT_ID"]
APIV="https://api.joblogic.com/api/v1"
tok=requests.post("https://identityservice.joblogic.com/connect/token",
    data={"grant_type":"client_credentials","client_id":CID,"client_secret":CSEC,"scope":"JL.Api"},
    timeout=60).json()["access_token"]
H={"Authorization":f"Bearer {tok}","Content-Type":"application/json"}
body={"TenantId":TID,"PageIndex":1,"PageSize":5,"IncludeTags":True,"IncludeInactive":True}
for path in ["PPMContract/GetAll","PPMContract/getall","PpmContract/GetAll","PPM/GetAll","PPMContract/Search"]:
    r=requests.post(f"{APIV}/{path}",json=body,headers=H,timeout=60)
    print("==",path,r.status_code,r.text[:300].replace("\n"," "))
    if r.ok:
        j=r.json(); items=j.get("Items") if isinstance(j,dict) else j
        print("TotalCount",j.get("TotalCount") if isinstance(j,dict) else None)
        if items: print(json.dumps(items[0],indent=1)[:4000])
        break
# The swagger may also be reachable from the whitelisted IP
r=requests.get("https://api.joblogic.com/swagger/v1/swagger.json",timeout=60)
print("swagger",r.status_code)
if r.ok:
    print("\n".join(p for p in r.json().get("paths",{}) if "ppm" in p.lower() or "contract" in p.lower()))
