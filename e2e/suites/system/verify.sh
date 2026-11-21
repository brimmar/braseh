#!/bin/bash
set -euo pipefail
PASS=0; FAIL=0
check() {
  local desc="$1" condition="$2"
  if eval "$condition" &>/dev/null; then echo "  ✓ $desc"; PASS=$((PASS+1))
  else echo "  ✗ $desc"; FAIL=$((FAIL+1)); fi
}

echo ""
echo "══════════════════════════════════════"
echo "  System Suite Verification"
echo "══════════════════════════════════════"

echo ""
echo "── group ────────────────────────────"
check "braseh-testgroup exists"           "getent group braseh-testgroup"
check "braseh-tempgroup was removed"      "! getent group braseh-tempgroup"

echo ""
echo "── user ─────────────────────────────"
check "braseh-testuser exists"            "id braseh-testuser"
check "braseh-testuser has bash shell"    "getent passwd braseh-testuser | cut -d: -f7 | grep -q bash"
check "braseh-testuser home created"      "test -d /home/braseh-testuser"
check "braseh-testuser in testgroup"      "id -Gn braseh-testuser | grep -q braseh-testgroup"
check "braseh-tempuser was removed"       "! id braseh-tempuser"

echo ""
echo "── aptRepository ────────────────────"
check "braseh-test-repo.list exists"      "test -f /etc/apt/sources.list.d/braseh-test-repo.list"
check "repo file has correct URI"        "grep -q 'archive.ubuntu.com/ubuntu' /etc/apt/sources.list.d/braseh-test-repo.list"
check "repo file has universe component" "grep -q 'universe' /etc/apt/sources.list.d/braseh-test-repo.list"

echo ""
echo "── idempotency (re-run) ─────────────"
braseh apply /home/testuser/system.ts
check "group still exists after re-run"  "getent group braseh-testgroup"
check "user still exists after re-run"   "id braseh-testuser"
check "repo list still exists"           "test -f /etc/apt/sources.list.d/braseh-test-repo.list"

echo ""
echo "══════════════════════════════════════"
echo "  Results: ${PASS} passed / ${FAIL} failed"
echo "══════════════════════════════════════"
echo ""
[ "$FAIL" -eq 0 ] || exit 1
