#!/usr/bin/env bash
# uts-mx-survey.sh -- READ-ONLY. What the trading box in Mexico City has, before
# a new engine is installed beside the old one: OS, processors, memory, disk,
# node and python, listening ports, the users, what the old engine's folder holds
# (names only), and whether Binance's live price streams answer from there.
# No writes, no orders, no keys read.
set -uo pipefail
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "$BOX" 'bash -s' <<'R'
echo "== os =="; . /etc/os-release; echo "  $PRETTY_NAME | kernel $(uname -r) | $(uname -m)"
echo "== machine =="; echo "  cpus $(nproc) | $(free -m | awk '/Mem:/{print "mem total "$2"MB free "$7"MB"}') | disk $(df -h / | awk 'NR==2{print $4" free of "$2}')"
echo "== runtimes =="; echo "  node: $(command -v node && node -v 2>/dev/null || echo none)"; echo "  python3: $(python3 -V 2>&1)"
echo "  apt node candidate: $(apt-cache policy nodejs 2>/dev/null | awk '/Candidate/{print $2}')"
echo "== listening =="; ss -ltnp 2>/dev/null | awk 'NR>1{print "  "$4}' | sort -u | head -20
echo "== users =="; getent passwd | awk -F: '$3>=1000 && $3<65000{print "  "$1}'
echo "== sudo =="; sudo -n true 2>/dev/null && echo "  admin has passwordless sudo" || echo "  no passwordless sudo"
echo "== home (names only) =="; ls -la ~ | awk 'NR>1{print "  "$1" "$NF}' | head -30
echo "== pilot folder (names only) =="; ls ~/pilot 2>/dev/null | head -30 | sed 's/^/  /'
echo "== units =="; systemctl list-units --all --no-pager 2>/dev/null | grep -i -E 'pilot|exec|uts' | sed 's/^/  /'
echo "== egress ip =="; curl -s -m 10 https://api.ipify.org; echo
echo "== binance REST from here =="; for ep in ping time; do echo "  api/v3/$ep -> $(curl -s -m 10 -o /dev/null -w '%{http_code} %{time_total}s' https://api.binance.com/api/v3/$ep)"; done
echo "== binance live streams from here (5 seconds) =="
python3 - <<'PY'
import socket, ssl, base64, os, time, json
def ws(path, n=3, timeout=8):
    host = "stream.binance.com"; port = 9443
    s = socket.create_connection((host, port), timeout=timeout)
    s = ssl.create_default_context().wrap_socket(s, server_hostname=host)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    hdr = b""
    while b"\r\n\r\n" not in hdr: hdr += s.recv(1)
    status = hdr.split(b"\r\n")[0].decode()
    got = []
    t0 = time.time()
    buf = b""
    while len(got) < n and time.time() - t0 < timeout:
        buf += s.recv(65536)
        while len(buf) >= 2:
            b1 = buf[1] & 0x7f; off = 2
            if b1 == 126: ln = int.from_bytes(buf[2:4], "big"); off = 4
            elif b1 == 127: ln = int.from_bytes(buf[2:10], "big"); off = 10
            else: ln = b1
            if len(buf) < off + ln: break
            payload = buf[off:off+ln]; op = buf[0] & 0x0f; buf = buf[off+ln:]
            if op == 1: got.append(payload.decode()[:160])
    s.close()
    return status, got, time.time() - t0
for p in ["/ws/ltcusdt@trade", "/ws/ltcusdt@depth5@100ms", "/ws/ltcusdt@kline_1h"]:
    try:
        st, got, dt = ws(p)
        print(f"  {p}: {st} | {len(got)} message(s) in {dt:.1f}s | first: {got[0] if got else '-'}")
    except Exception as e:
        print(f"  {p}: FAILED {e}")
PY
R
