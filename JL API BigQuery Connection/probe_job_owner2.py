"""Deep-introspect the PUT /api/v1/Job body model: full property list + any 'owner' field anywhere.
Run on the VM. NON-MUTATING (read-only swagger)."""
import os, json, re, requests
CID=os.environ["JL_CLIENT_ID"]; CSEC=os.environ["JL_CLIENT_SECRET"]; TID=os.environ["JL_TENANT_ID"]
BASE="https://api.joblogic.com"
tok=requests.post("https://identityservice.joblogic.com/connect/token",
    data={"grant_type":"client_credentials","client_id":CID,"client_secret":CSEC,"scope":"JL.Api"},
    timeout=60).json()["access_token"]
H={"Authorization":f"Bearer {tok}"}
spec=requests.get(f"{BASE}/swagger/v1/swagger.json",headers=H,timeout=60).json()

def resolve(ref):
    node=spec
    for p in ref.lstrip("#/").split("/"): node=node.get(p,{})
    return node

def deep_props(schema, seen=None, depth=0):
    seen=seen or set()
    if not isinstance(schema,dict) or depth>6: return {}
    if "$ref" in schema:
        if schema["$ref"] in seen: return {}
        seen.add(schema["$ref"]); return deep_props(resolve(schema["$ref"]),seen,depth+1)
    out={}
    for sub in schema.get("allOf",[]) or []: out.update(deep_props(sub,seen,depth+1))
    for k,v in (schema.get("properties",{}) or {}).items():
        if "$ref" in v: out[k]=v["$ref"].split("/")[-1]
        elif v.get("type")=="array": out[k]="array<%s>"%(v.get("items",{}).get("$ref","").split("/")[-1] or v.get("items",{}).get("type","?"))
        else: out[k]=v.get("type","?")+(("/"+v["format"]) if v.get("format") else "")
    return out

put=spec["paths"]["/api/v1/Job"]["put"]
schema={}
rb=put.get("requestBody",{})
if rb:
    for ct in rb.get("content",{}).values(): schema=ct.get("schema",{}); break
else:
    for p in put.get("parameters",[]) or []:
        if p.get("in")=="body": schema=p.get("schema",{}); break
print("PUT /api/v1/Job body ref:", schema.get("$ref","(inline)"))
props=deep_props(schema)
print(f"=== {len(props)} properties on the update-job body ===")
for k,t in sorted(props.items()):
    mark="   <== OWNER?" if "owner" in k.lower() else ""
    print(f"  {k}: {t}{mark}")

# whole-spec scan for any property name containing 'owner'
print("\n=== every schema property named *owner* across the spec ===")
schemas=spec.get("components",{}).get("schemas",{}) or spec.get("definitions",{}) or {}
for name,sc in schemas.items():
    for pk in (sc.get("properties",{}) or {}):
        if "owner" in pk.lower():
            print(f"  {name}.{pk}: {sc['properties'][pk].get('type', sc['properties'][pk].get('$ref','?'))}")
raw=json.dumps(spec)
print("\n'OwnerUserId' substring count in spec:", raw.count("OwnerUserId"))
