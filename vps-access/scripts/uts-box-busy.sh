#!/usr/bin/env bash
# READ-ONLY. Whether anything heavy is going on the box -- a sweep, a data
# job, a stage run OR a totalling -- read off the status the planted check's
# button sleeps on, which is the one answer that covers all four. Prints
# "busy: <what>" or "busy: none". Nothing written, nothing started.
set -uo pipefail
curl -sS -m 20 http://127.0.0.1:8094/api/planted-gate/status \
| node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d={};try{d=JSON.parse(r)}catch(e){console.log("busy: unknown (no answer)");return}console.log("busy: "+(d.blockedBy||"none"))})'
