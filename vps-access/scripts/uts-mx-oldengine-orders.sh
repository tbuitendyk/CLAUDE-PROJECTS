#!/usr/bin/env bash
# uts-mx-oldengine-orders.sh -- READ-ONLY. Before the new engine's probe places
# any order on the trading account, read how the OLD order program on the
# trading box treats an order it did not place: whether it ever lists open
# orders, which orders it looks up (by its own client ids only?), and what its
# reconcile compares (the coin held, or the dollars too). Prints the program's
# fingerprint and the lines that answer those questions. Reads one file; no
# writes, no orders, no keys read or printed.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "$BOX" 'bash -s' <<'R'
F=~/mx_executor.py
echo "== the order program =="
echo "  sha256 $(sha256sum $F | cut -c1-16) | $(wc -l < $F) lines"
echo "== every exchange path it calls =="
grep -n -o -E '"/(sapi|api)/v[0-9]/[A-Za-z/_-]+"' $F | sort -t: -k2 -u | sed 's/^/  /'
echo "== does it ever list open or past orders? =="
grep -n -E 'openOrders|allOrders|myTrades|openOrderList' $F | cut -c1-170 | sed 's/^/  /' || true
[ -z "$(grep -E 'openOrders|allOrders|myTrades|openOrderList' $F)" ] && echo "  no: no call lists open orders, past orders or trades"
echo "== which orders it looks up =="
grep -n -E 'def query_order|origClientOrderId|query_order\(' $F | cut -c1-170 | sed 's/^/  /'
echo "== what the reconcile reads from the account =="
grep -n -E 'quoteAsset|baseAsset|"locked"|\["locked"\]|free_base|free_quote|quote_free|borrowed' $F | cut -c1-170 | head -40 | sed 's/^/  /'
R
