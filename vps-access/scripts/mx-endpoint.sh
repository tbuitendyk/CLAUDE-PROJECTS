#!/usr/bin/env bash
# mx-endpoint.sh -- THE one place the Mexico execution host is named.
#
# Sourced, never executed. Six scripts used to carry the literal address, so
# changing it meant six edits and forgetting one meant a tunnel that comes up
# and goes nowhere.
#
# MX_HOST accepts an IP **or** a DNS name with no other change: an EC2 public
# IPv4 survives reboot but MOVES on stop/start, so whether the address ends up
# pinned by an Elastic IP or followed by a DNS record, only this line changes.
#
# MX_EXPECT_ASN / MX_EXPECT_COUNTRY are what mx-verify-egress.sh asserts the
# far end actually is. A tunnel that connects to the wrong host still raises a
# healthy-looking SOCKS listener, and the failure would surface as Binance
# calls timing out rather than as "the address moved" — which is a terrible
# thing to discover with money live.
MX_HOST="${MX_HOST:-78.12.190.144}"
MX_USER="${MX_USER:-admin}"
MX_KEY="${MX_KEY:-/root/.ssh/aws-mex-deb13.pem}"
MX_SOCKS_PORT="${MX_SOCKS_PORT:-1080}"
MX_EXPECT_COUNTRY="${MX_EXPECT_COUNTRY:-MX}"
MX_EXPECT_ORG_MATCH="${MX_EXPECT_ORG_MATCH:-Amazon}"
MX_SSH="${MX_USER}@${MX_HOST}"
