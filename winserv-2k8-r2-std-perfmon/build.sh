#!/bin/sh
# Cross-compile perfmon.exe for Windows Server 2008 R2 (x64).
#
# MUST be built with Go 1.20.x — Go 1.21+ binaries refuse to run on NT 6.1
# (they require Windows 10 / Server 2016). Point GO at a 1.20 toolchain:
#   GO=/path/to/go1.20.14/bin/go ./build.sh
set -e
cd "$(dirname "$0")"
GO="${GO:-go}"
"$GO" version | grep -q 'go1\.20\.' || {
    echo "ERROR: need Go 1.20.x, got: $("$GO" version)" >&2
    exit 1
}
mkdir -p dist
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 "$GO" build -trimpath -ldflags="-s -w" -o dist/perfmon.exe .
ls -l dist/perfmon.exe
sha256sum dist/perfmon.exe
