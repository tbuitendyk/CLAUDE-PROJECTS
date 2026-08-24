#!/usr/bin/env bash
# uts-rows-audit.sh -- READ-ONLY. What state the interrupted sweep's stored rows
# are actually in, before anything touches them.
#
# The run filled the disk. Two things can be wrong as a result and neither is
# visible from the outside:
#
#   A TORN TAIL. lib/rowstore.js calls fs.writeSync and discards the count. On a
#   full disk write(2) can write FEWER bytes than asked and return the short
#   count rather than failing, so the last line of any of these files may be
#   half a line — while the sidecar beside it says the whole batch landed.
#
#   A SKEW BETWEEN COLLECTIONS. census and replication are written in the same
#   callback but buffered separately. Resume decides which units are already
#   done by reading CENSUS alone, so a unit whose census row landed and whose
#   replication rows did not would be skipped for ever: a replication table
#   short by one unit and nothing saying so.
#
# Changes nothing. Prints small: only the last 8 KB reaches the session.
set -uo pipefail
D=/opt/ultimate-trading-system/data/batches
RUN="$(ls -1 "$D" 2>/dev/null | grep -E '\.rows$' | head -1)"
[ -n "$RUN" ] || { echo "no row store found under $D"; exit 0; }
R="$D/$RUN"
echo "== $RUN =="
df -h / | tail -1 | sed 's/^/  disk  /'
echo

for name in slim census replication; do
  P="$R/$name.jsonl"; G="$R/$name.jsonl.gz"; M="$R/$name.meta.json"
  if [ -f "$P" ]; then F="$P"; KIND=plain
  elif [ -f "$G" ]; then F="$G"; KIND=squashed
  else echo "  $name: absent"; continue; fi
  SZ=$(stat -c%s "$F")
  printf '  %-12s %-9s %12s bytes\n' "$name" "$KIND" "$SZ"
  if [ "$KIND" = plain ]; then
    LINES=$(wc -l < "$F")
    # a file whose final byte is not a newline ends mid-line
    LASTCH=$(tail -c 1 "$F" | od -An -c | tr -d ' ')
    printf '               %s complete lines; ends with %s\n' "$LINES" "${LASTCH:-<empty>}"
    # does the final complete line parse?
    tail -c 200000 "$F" | tail -2 | head -1 > /tmp/uts-lastline.$$ 2>/dev/null
    node -e '
      const fs=require("fs");
      const s=fs.readFileSync("/tmp/uts-lastline."+process.argv[1],"utf8").trim();
      try { const v=JSON.parse(s); console.log("               last full line parses, "+(Array.isArray(v)?v.length+" fields":"object")); }
      catch(e){ console.log("               LAST FULL LINE DOES NOT PARSE: "+e.message.slice(0,60)); }
    ' $$ 2>/dev/null || echo "               (could not check the last line)"
    rm -f /tmp/uts-lastline.$$
  fi
  if [ -f "$M" ]; then
    node -e '
      const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      console.log("               sidecar says rows="+m.rows+", cols="+(m.cols||[]).length+(m.squashed?", squashed":""));
    ' "$M" 2>/dev/null
  else
    echo "               no sidecar"
  fi
done

echo
echo "== are census and replication in step at the cut? =="
node -e '
const fs=require("fs"), path=require("path"), readline=require("readline");
const R=process.argv[1];
function header(f){ const fd=fs.openSync(f,"r"); const b=Buffer.alloc(65536); const n=fs.readSync(fd,b,0,65536,0); fs.closeSync(fd);
  const line=b.slice(0,n).toString("utf8").split("\n")[0]; return JSON.parse(line); }
function tailLines(f,bytes){ const sz=fs.statSync(f).size; const from=Math.max(0,sz-bytes);
  const fd=fs.openSync(f,"r"); const b=Buffer.alloc(sz-from); fs.readSync(fd,b,0,b.length,from); fs.closeSync(fd);
  const parts=b.toString("utf8").split("\n"); if(from>0) parts.shift(); return parts.filter(x=>x.trim()); }
const out={};
for (const name of ["census","replication"]) {
  const f=path.join(R,name+".jsonl");
  if(!fs.existsSync(f)) continue;
  const h=header(f);
  const lines=tailLines(f, 4*1024*1024);
  const rows=[];
  for(const L of lines){ try{ const a=JSON.parse(L); if(Array.isArray(a)) rows.push(Object.fromEntries(h.cols.map((c,i)=>[c,a[i]]))); }catch(e){} }
  out[name]={cols:h.cols.length, tail:rows.slice(-3), n:rows.length};
}
const idOf=(r)=>[r.trade,r.ctx1||"",r.ctx2||"",r.geometry,r.decision||"",r.nullDealSeed==null?"real":"n"+r.nullDealSeed].join("|");
if(out.census&&out.census.tail.length){
  const c=out.census.tail[out.census.tail.length-1];
  console.log("  last census row  : "+idOf(c));
  console.log("                     key="+(c.key||"(none)"));
}
if(out.replication&&out.replication.tail.length){
  const r=out.replication.tail[out.replication.tail.length-1];
  console.log("  last replication : "+[r.trade,r.ctx1||"",r.ctx2||"",r.geometry,r.nullDealSeed==null?"real":"n"+r.nullDealSeed].join("|"));
  console.log("                     key="+(r.key||"(none)")+"  label="+String(r.declaredLabel||"").slice(0,44));
}
' "$R" 2>&1 | head -20
echo "(read-only)"
