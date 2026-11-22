#!/bin/bash
# Secrets suite verification
# Tests: braseh secrets set, braseh secrets list, file with secret content
set -euo pipefail
PASS=0; FAIL=0
check() {
  local desc="$1" condition="$2"
  if eval "$condition" &>/dev/null; then echo "  ✓ $desc"; PASS=$((PASS+1))
  else echo "  ✗ $desc"; FAIL=$((FAIL+1)); fi
}

# Capture braseh output before grepping it. With pipefail, `braseh ... | grep -q`
# fails whenever grep exits on its first match and braseh then hits a closed pipe,
# and whenever braseh exits nonzero on purpose (the cyclic check).
output_of() { "$@" 2>&1 || true; }

echo ""
echo "══════════════════════════════════════"
echo "  Secrets Suite Verification"
echo "══════════════════════════════════════"

echo ""
echo "── secrets CLI ──────────────────────"
check "master key file created"          "test -f $HOME/.braseh_key"
check "vault created"                    "test -f .braseh/vault"
check "DB_PASSWORD listed"               "grep -q DB_PASSWORD <<<\"\$(output_of braseh secrets list)\""
check "API_KEY listed"                   "grep -q API_KEY <<<\"\$(output_of braseh secrets list)\""

echo ""
echo "── check command ────────────────────"
check "braseh check passes valid config"   "braseh check /home/testuser/secrets.ts"

echo ""
echo "── init command ─────────────────────"
check "braseh init creates project dir"    "test -f /tmp/braseh-init-test/braseh.ts"
check "init produces valid config"        "braseh check /tmp/braseh-init-test/braseh.ts"

echo ""
echo "── doctor command ───────────────────"
check "doctor runs without crashing"      "braseh doctor"
check "doctor detects git"               "grep -q 'git found' <<<\"\$(output_of braseh doctor)\""

echo ""
echo "── dry-run mode ─────────────────────"
check "dry-run produces output"           "grep -q 'DRY RUN' <<<\"\$(output_of braseh apply /home/testuser/secrets.ts --dry-run)\""
check "dry-run does not write files"      "! test -f /tmp/braseh-dryrun-should-not-exist.txt"

echo ""
echo "── cyclic dependency detection ──────"
check "cyclic dep throws an error"        "! braseh apply /home/testuser/cyclic.ts &>/dev/null && grep -iq 'cycl\\|circular\\|depend' <<<\"\$(output_of braseh apply /home/testuser/cyclic.ts)\""

echo ""
echo "══════════════════════════════════════"
echo "  Results: ${PASS} passed / ${FAIL} failed"
echo "══════════════════════════════════════"
echo ""
[ "$FAIL" -eq 0 ] || exit 1
