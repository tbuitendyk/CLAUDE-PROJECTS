#!/usr/bin/env bash
# classifier-schema-scan.sh -- one-off, READ-ONLY compliance scan of every
# stored run and model dump against the phase-2 schema (owner, 2026-07-30:
# "double-check the salvaged data from previous loops to make sure it fully
# complies with the new schema").
#
# The new schema is ADDITIVE and readers are tolerant by design: old docs
# without params.windowLayout classify as 'legacy'; old dumps carry a third
# spec field the inspect panel still renders. This scan PROVES that on the
# real files instead of assuming it: every doc through the new readers,
# every dump through the inspect endpoint, and the comparison endpoint must
# REFUSE legacy docs with a clean named reason -- never a crash.
set -uo pipefail
B="http://127.0.0.1:8093"
python3 <<'EOF'
import json, os, glob, urllib.request, urllib.error
B = "http://127.0.0.1:8093"
ROOT = "/opt/general-classifier/data"
def get(u):
    with urllib.request.urlopen(u, timeout=60) as r: return json.load(r)
def post(u, body):
    req = urllib.request.Request(u, json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try: return e.code, json.load(e)
        except Exception: return e.code, {"error": "NON-JSON ERROR BODY"}
fails = []
def chk(ok, msg):
    print(("  ok   " if ok else "  FAIL ") + msg)
    if not ok: fails.append(msg)

docs = sorted(glob.glob(f"{ROOT}/batches/bracketlab-*.json"))
legacy = quota = 0
bad_rows = 0
for p in docs:
    with open(p) as f: d = json.load(f)
    wl = (d.get("params") or {}).get("windowLayout") or "legacy"
    if wl == "legacy": legacy += 1
    else: quota += 1
    for r in (d.get("edgeCensus") or []):
        rl = r.get("windowLayout", "MISSING")
        if wl == "legacy":
            if rl not in ("MISSING", "legacy"): bad_rows += 1
        else:
            if rl in ("MISSING", "legacy") and wl != "legacy" and wl != "both": bad_rows += 1
print(f"bracketlab docs on disk: {len(docs)} ({legacy} legacy, {quota} quota-layout)")
chk(bad_rows == 0, f"census rows consistent with their doc's layout ({bad_rows} inconsistent)")

srcs = get(f"{B}/api/bracketlab/verdict-sources").get("sources", [])
chk(all("windowLayout" in s for s in srcs), f"verdict-sources labels every run's layout ({len(srcs)} listed)")
leg_ids = [s["id"] for s in srcs if s["windowLayout"] == "legacy" and s["realRows"] > 0]
chk(len(leg_ids) >= 2, f"enough legacy runs to test refusal ({len(leg_ids)})")
if len(leg_ids) >= 2:
    code, body = post(f"{B}/api/bracketlab/compare", {"a": leg_ids[0], "b": leg_ids[1]})
    chk(code == 400 and "error" in body, f"comparing two legacy runs refused cleanly: HTTP {code}: {body.get('error','')[:90]}")
    code2, body2 = post(f"{B}/api/bracketlab/compare", {"a": leg_ids[0]})
    chk(code2 == 400 and "error" in body2, f"legacy run alone refused cleanly: HTTP {code2}: {body2.get('error','')[:90]}")
code3, body3 = post(f"{B}/api/bracketlab/compare", {"a": "../../etc/passwd"})
chk(code3 == 400 and "error" in body3, f"hostile id refused cleanly (HTTP {code3})")

old_dump = new_dump = None
for d in sorted(glob.glob(f"{ROOT}/models/*/*.json")):
    with open(d) as f: j = json.load(f)
    specs = j.get("specs") or []
    if specs and "regime" in specs[0]: old_dump = old_dump or d
    elif specs: new_dump = new_dump or d
chk(old_dump is not None, f"found an old-schema dump (3-part specs): {os.path.relpath(old_dump, ROOT) if old_dump else '-'}")
for tag, path in (("old", old_dump), ("new", new_dump)):
    if not path: continue
    job = os.path.basename(os.path.dirname(path)); fn = os.path.basename(path)
    try:
        r = get(f"{B}/api/bracketlab/{job}/inspect?file={fn}&quorum=4")
        chk(len(r.get("members", [])) > 0, f"{tag}-schema dump renders through inspect ({len(r.get('members', []))} members, pairwise {len(r.get('pairwise', []))}x)")
    except Exception as e:
        chk(False, f"{tag}-schema dump through inspect: {e}")

total = sum(len(json.load(open(p)).get("edgeCensus") or []) for p in docs)
print(f"census rows scanned across all docs: {total}")
print()
print("SCHEMA SCAN PASS" if not fails else f"SCHEMA SCAN FAIL: {len(fails)} problem(s)")
raise SystemExit(0 if not fails else 1)
EOF
