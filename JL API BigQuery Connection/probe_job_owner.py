"""Find the JL 'Update Job' endpoint and confirm it accepts OwnerUserId (for Monday Lead PM -> JL
job-owner write-back). Run ON THE VM (whitelisted IP). Reads JL_CLIENT_ID/SECRET/TENANT_ID from env.

NON-MUTATING: introspects swagger, then does an empty-body validation call (expects a 400 that
lists required fields). It never sends a real job id with real values, so no job is changed.
"""
import os, json, re, requests

CID = os.environ["JL_CLIENT_ID"]; CSEC = os.environ["JL_CLIENT_SECRET"]; TID = os.environ["JL_TENANT_ID"]
BASE = "https://api.joblogic.com"
APIV = BASE + "/api/v1"
TOKEN_URL = "https://identityservice.joblogic.com/connect/token"

tok = requests.post(TOKEN_URL, data={"grant_type": "client_credentials", "client_id": CID,
    "client_secret": CSEC, "scope": "JL.Api"}, timeout=60).json()["access_token"]
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

# ---- 1. swagger introspection ---------------------------------------------
spec = None
for url in (f"{BASE}/swagger/v1/swagger.json",):
    for hdr in (H, {}):
        try:
            r = requests.get(url, headers=hdr, timeout=60)
            if r.ok:
                spec = r.json(); print(f"swagger OK from {url} (auth={'yes' if hdr else 'no'})"); break
        except Exception as e:
            print("swagger err", e)
    if spec: break

def resolve(ref, root):
    node = root
    for part in ref.lstrip("#/").split("/"):
        node = node.get(part, {})
    return node

def props_of(schema, root, seen=None):
    """Flatten a schema's property names, following $ref/allOf one level deep."""
    seen = seen or set()
    if not isinstance(schema, dict): return {}
    if "$ref" in schema:
        if schema["$ref"] in seen: return {}
        seen.add(schema["$ref"])
        return props_of(resolve(schema["$ref"], root), root, seen)
    out = {}
    for sub in schema.get("allOf", []) or []:
        out.update(props_of(sub, root, seen))
    for k, v in (schema.get("properties", {}) or {}).items():
        t = v.get("type") or (v.get("$ref","").split("/")[-1] if "$ref" in v else "?")
        out[k] = t
    return out

if spec:
    paths = spec.get("paths", {})
    job_ops, owner_ops = [], []
    for path, ops in paths.items():
        if "job" not in path.lower(): continue
        for method, op in ops.items():
            if method not in ("get","post","put","patch","delete"): continue
            # request body schema (openapi3) or parameters(body) (swagger2)
            schema = {}
            rb = op.get("requestBody", {})
            if rb:
                content = rb.get("content", {})
                for ct in content.values():
                    schema = ct.get("schema", {}); break
            else:
                for p in op.get("parameters", []) or []:
                    if p.get("in") == "body":
                        schema = p.get("schema", {}); break
            props = props_of(schema, spec)
            job_ops.append((method.upper(), path, sorted(props.keys())))
            if any(k.lower() == "owneruserid" for k in props):
                owner_ops.append((method.upper(), path, props))
    print(f"\n=== {len(job_ops)} Job operations ===")
    for m, p, _ in job_ops:
        print(f"  {m:6} {p}")
    print(f"\n=== operations whose body has OwnerUserId ({len(owner_ops)}) ===")
    for m, p, props in owner_ops:
        print(f"\n  {m} {p}")
        for k, t in sorted(props.items()):
            mark = "  <== OWNER" if k.lower()=="owneruserid" else ""
            print(f"     {k}: {t}{mark}")

# ---- 2. non-mutating validation probe on likely update paths --------------
print("\n=== validation probes (empty/minimal body -> expect 400 listing required fields) ===")
candidates = [("PUT","Job/update"),("POST","Job/update"),("PUT","Job"),("POST","Job/updatejob"),
              ("PUT","Job/updatejob"),("PUT","Job/UpdateJob")]
for method, path in candidates:
    try:
        fn = requests.put if method=="PUT" else requests.post
        r = fn(f"{APIV}/{path}?tenantId={TID}", json={"TenantId": TID}, headers=H, timeout=40)
        snippet = re.sub(r"\s+"," ", r.text)[:500]
        print(f"  {method:4} {path} -> {r.status_code}  {snippet}")
    except Exception as e:
        print(f"  {method:4} {path} -> ERR {e}")
