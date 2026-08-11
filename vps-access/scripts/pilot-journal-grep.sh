#!/usr/bin/env bash
set -uo pipefail
ssh -i /root/.ssh/aws-mex-deb13-new.pem -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new \
  admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com \
  'grep -E "DUST_DONE|DUST_SELL.*ORDER_ACK" ~/pilot/journal.jsonl | tail -3'
