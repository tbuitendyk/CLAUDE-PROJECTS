#!/usr/bin/env bash
# uts-walk-start-same.sh -- starts Walk it forward with EXACTLY the parameters
# the owner's 07:54 run was asked for, read back off the box before the deploy:
# window 6 months, 12 months behind the first window, bands 200/250/300/350,
# no sweet-spot band, usual move trailing, leaning learned before each window,
# 100 copies each way, floor 3, every coin, look-backs 24h to 504h in 24s.
# Starts and returns at once; nothing is written to disk.
set -uo pipefail
curl -s -m 60 -X POST http://127.0.0.1:8094/api/coins/walk \
  -H 'Content-Type: application/json' \
  -d '{"windowMonths":6,"warmUpMonths":12,"bands":[200,250,300,350],"sweetSpot":false,"usual":"trailing","signsMode":"rolled","scrambles":100,"floor":3,"only":null,"lookbacks":[24,48,72,96,120,144,168,192,216,240,264,288,312,336,360,384,408,432,456,480,504]}'
echo
date -u +'started %Y-%m-%d %H:%M:%S UTC'
