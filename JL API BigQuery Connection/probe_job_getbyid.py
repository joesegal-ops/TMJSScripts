"""Dump GetById for a job to locate the Customer Order Number field. Run on VM. Read-only."""
import os, json, requests
CID=os.environ["JL_CLIENT_ID"]; CSEC=os.environ["JL_CLIENT_SECRET"]; TID=os.environ["JL_TENANT_ID"]
APIV="https://api.joblogic.com/api/v1"; JOBID=os.environ.get("PROBE_JOBID","29450326")
tok=requests.post("https://identityservice.joblogic.com/connect/token",
    data={"grant_type":"client_credentials","client_id":CID,"client_secret":CSEC,"scope":"JL.Api"},
    timeout=60).json()["access_token"]
r=requests.get(f"{APIV}/Job/GetById?id={JOBID}&tenantId={TID}",
               headers={"Authorization":f"Bearer {tok}"},timeout=40)
print("status",r.status_code)
j=r.json(); obj=j.get("Data",j) if isinstance(j,dict) else j
def show(o,pre=""):
    if isinstance(o,dict):
        for k,v in o.items():
            if isinstance(v,(dict,)): show(v,pre+k+".")
            elif isinstance(v,list): print(f"{pre}{k} = [list {len(v)}]")
            elif v not in (None,""): print(f"{pre}{k} = {v!r}")
show(obj)
