#!/usr/bin/env bash
# READ-ONLY. Whether anything heavy is going on the box -- a data job, a stage
# run, a totalling, the step-6 press or the stage-engine check itself -- read
# off the stage-engine check's status, whose `blockedBy` is the one answer its
# own press sleeps on (3.98.0; it was the planted check's status until that
# check was retired with the older sweep path in 3.97.0). Prints
# "busy: <what>" or "busy: none"; a service that does not answer, or one that
# serves a release without the field, prints "busy: unknown (no answer)" so a
# gate built on this refuses rather than guesses. Nothing written, nothing
# started.
set -uo pipefail
curl -sS -m 20 http://127.0.0.1:8094/api/stage-gate/status \
| node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d={};try{d=JSON.parse(r)}catch(e){console.log("busy: unknown (no answer)");return}if(!("blockedBy" in d)){console.log("busy: unknown (no answer)");return}console.log("busy: "+(d.blockedBy||"none"))})'
