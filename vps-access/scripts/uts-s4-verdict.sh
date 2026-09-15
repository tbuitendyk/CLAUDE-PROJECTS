#!/usr/bin/env bash
# uts-s4-verdict.sh <set-id>[:full] -- READ-ONLY. Brief by default (the header and one line per block); :full prints every figure. Verify's own dry read of one Stage 4
# record set, printed in full where the verdict is decided: the footing, the
# held-back read against the four comparisons, the survivors against their
# scrambled copies (the bar, the beats, the spread of the copies' means), the
# per-survivor readings, the sanity line and the marks -- every block stamped,
# oldest (the verdict) first. Changes nothing; the same GET the page makes.
set -uo pipefail
B=http://127.0.0.1:8094
arg="${1:?set id, or set id:full for every figure}"
id="${arg%:full}"
brief=1; [ "$arg" != "$id" ] && brief=""
curl -sf --max-time 60 "$B/api/funnel/set/$id/verify" | BRIEF="$brief" python3 -c '
import json,sys,statistics,os
d=json.load(sys.stdin)
brief=bool(os.environ.get("BRIEF"))
def m(v):
    return "none" if v is None else ("%.2f" % v)
print("SET", d.get("id"), "|", d.get("name"), "|", d.get("unitName"), "| release", d.get("release"))
print("  rule:", d.get("ruleSentence"))
print("  user rule:", d.get("userSentence"))
print("  counts:", json.dumps(d.get("counts")), "| closing:", json.dumps(d.get("closing")), "| check:", json.dumps(d.get("check")))
print("  marks:", json.dumps(d.get("marks")))
print("  refused:", d.get("refused"))
f=d.get("footing") or {}
print("  footing now: ok", f.get("ok"), "| why", f.get("why"), "| had", f.get("had"), "now", f.get("now"), "gone", f.get("gone"), "| releases", json.dumps(f.get("releases")))
print("  looks now:", json.dumps(d.get("looks")))
blocks=list(reversed(d.get("blocks") or []))
print("  blocks:", len(blocks))
for b in blocks:
    if brief:
        v=b.get("verdict") or {}; h=b.get("heldBack") or {}; c=h.get("comparisons") or {}; cp=b.get("copies") or {}; sn=b.get("sanity") or {}; r=b.get("rules") or {}
        print("== block", b.get("id"), "look", b.get("look"), "at", b.get("at"), "release", b.get("release"), "| PASS" if v.get("pass") else "| FAIL")
        print("   held real", m(h.get("real")), "vsLong", m(h.get("vsLong")), "trades", m(h.get("trades")), "| best", json.dumps(c.get("best")), "beatsBest", c.get("beatsBest"), "| alwaysLong", json.dumps(c.get("alwaysLong")), "| copies beats", cp.get("beats"), "of", cp.get("copies"), "bar", cp.get("bar"), "| sanity", sn.get("ok"), "losing", json.dumps((sn.get("board") or {}).get("losing")), "threshold", sn.get("threshold"), "| barPct", r.get("barPct"))
        continue
    print("== block", b.get("id"), "look", b.get("look"), "at", b.get("at"), "release", b.get("release"))
    v=b.get("verdict") or {}
    print("  VERDICT pass", v.get("pass"))
    print("  sentence:", v.get("sentence"))
    r=b.get("rules") or {}
    print("  rules: copies", r.get("copies"), "barPct", r.get("barPct"), "ownBarPct", r.get("ownBarPct"), "bar", r.get("bar"), "chance", r.get("chance"), "sanityPct", r.get("sanityPct"))
    fo=b.get("footing") or {}
    print("  footing: ok", fo.get("ok"), "why", fo.get("why"), "had", fo.get("had"), "now", fo.get("now"))
    h=b.get("heldBack") or {}
    c=h.get("comparisons") or {}
    print("  heldBack: real", m(h.get("real")), "of", h.get("of"), "missing", h.get("missing"), "trades", m(h.get("trades")), "vsLong", m(h.get("vsLong")), "positive", h.get("positive"), "pass", h.get("pass"))
    for k in ("alwaysLong","alwaysShort","buyHold","shortHold"):
        x=c.get(k)
        print("    comparison", k, json.dumps(x), "beaten", c.get("beats"+k[0].upper()+k[1:]))
    print("    best:", json.dumps(c.get("best")), "beatsBest", c.get("beatsBest"), "known", c.get("known"), "why", c.get("why"))
    cp=b.get("copies") or {}
    means=[x for x in (cp.get("copyMeans") or []) if x is not None]
    if means:
        s=sorted(means)
        print("  copies: K", cp.get("copies"), "real", m(cp.get("real")), "beats", cp.get("beats"), "bar", cp.get("bar"), "barPct", cp.get("barPct"), "chance", cp.get("chance"), "lead", m(cp.get("lead")), "pass", cp.get("pass"))
        print("    copy means: n", len(s), "min", m(s[0]), "p10", m(s[len(s)//10]), "median", m(statistics.median(s)), "mean", m(statistics.mean(s)), "p90", m(s[(9*len(s))//10]), "max", m(s[-1]), "positive", sum(1 for x in s if x>0))
        print("    survivorsWithNoFigure", cp.get("survivorsWithNoFigure"), "copiesShortOfSurvivors", cp.get("copiesShortOfSurvivors"))
    else:
        print("  copies:", json.dumps({k:cp.get(k) for k in ("copies","real","beats","bar","pass","incomplete")}))
    sv=b.get("survivors") or {}
    print("  survivors: n", sv.get("survivors"), "passing", sv.get("passing"), "byChance", sv.get("byChance"), "positive", sv.get("positive"), "beatsAlwaysLong", sv.get("beatsAlwaysLong"), "headToHeadsWon", sv.get("headToHeadsWon"), "medianStoredLead", sv.get("medianStoredLead"), "medianLead", sv.get("medianLead"), "moneyByThird", json.dumps(sv.get("moneyByThird")))
    rows=sv.get("rows") or []
    held=[x.get("held") for x in rows if x.get("held") is not None]
    if held:
        hs=sorted(held)
        print("    held per survivor: n", len(hs), "min", m(hs[0]), "median", m(statistics.median(hs)), "mean", m(statistics.mean(hs)), "max", m(hs[-1]), "positive", sum(1 for x in hs if x>0))
        besthi=((c.get("best") or {}).get("hi"))
        if besthi is not None:
            print("    survivors above the worst-hold best of the four (", m(besthi), "):", sum(1 for x in hs if x > besthi + 0.01), "of", len(hs))
        vsl=[x.get("vsLong") for x in rows if x.get("vsLong") is not None]
        if vsl:
            print("    survivors beating being long every period at their OWN hold length:", sum(1 for x in vsl if x > 0.01), "of", len(vsl), "| margin min", m(min(vsl)), "median", m(statistics.median(vsl)), "mean", m(statistics.mean(vsl)))
        beats=[x.get("beats") for x in rows if x.get("beats") is not None]
        print("    beats per survivor: min", min(beats), "median", statistics.median(beats), "max", max(beats), "| bar", sv.get("kept"))
        tr=[x.get("trades") for x in rows if x.get("trades") is not None]
        if tr: print("    trades per survivor: min", m(min(tr)), "median", m(statistics.median(tr)), "max", m(max(tr)))
    sn=b.get("sanity") or {}
    print("  sanity: threshold", sn.get("threshold"), "board", json.dumps(sn.get("board")), "survivors", json.dumps(sn.get("survivors")), "ok", sn.get("ok"))
    la=b.get("lineA") or {}; lb=b.get("lineB") or {}
    print("  lineA (test window vs copies):", json.dumps({k:la.get(k) for k in ("real","beats","bar","copies","pass") if k in la}))
    print("  lineB (shopping alone):", json.dumps({k:lb.get(k) for k in list(lb.keys())[:8]}))
    w=b.get("windows") or {}
    print("  windows:", json.dumps({k:w.get(k) for k in ("hold","sealed","layout") if k in w}))
    print("  others:", json.dumps(b.get("others")))
    print("  marks:", json.dumps(b.get("marks")))
' || echo "$id: the dry read did not answer"
