#!/bin/bash
# Runs INSIDE the container after braseh apply.
# Asserts all expected side effects occurred.
set -euo pipefail

PASS=0
FAIL=0

check() {
  local desc="$1"
  local condition="$2"
  if eval "$condition" &>/dev/null; then
    echo "  ✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "══════════════════════════════════════"
echo "  braseh E2E Verification"
echo "══════════════════════════════════════"
echo ""

echo "── Packages ─────────────────────────"
check "tree is installed"             "command -v tree"
check "jq is installed"               "command -v jq"

echo ""
echo "── Directories ──────────────────────"
check "~/.config/myapp exists"        "test -d $HOME/.config/myapp"
check "~/.local/bin exists"           "test -d $HOME/.local/bin"

echo ""
echo "── Files ────────────────────────────"
check "~/.gitconfig written"          "test -f $HOME/.gitconfig"
check "~/.gitconfig has email"        "grep -q 'test@example.com' $HOME/.gitconfig"
check "~/.config/myapp/config.json"   "test -f $HOME/.config/myapp/config.json"
check "config.json has correct mode"  "test \$(stat -c '%a' $HOME/.config/myapp/config.json) = '600'"

echo ""
echo "── Symlinks ─────────────────────────"
check "~/.config/myapp/settings.json is a symlink"   "test -L $HOME/.config/myapp/settings.json"
check "symlink resolves correctly"    "grep -q 'braseh' $HOME/.config/myapp/settings.json"

echo ""
echo "── lineInFile ───────────────────────"
check "BRASEH_MANAGED=1 in ~/.bashrc"  "grep -q 'BRASEH_MANAGED=1' $HOME/.bashrc"
check "PATH line in ~/.bashrc"        "grep -q '.local/bin' $HOME/.bashrc"

echo ""
echo "── Scripts ──────────────────────────"
check "jq version file created"       "test -f /tmp/braseh-jq-version.txt"
check "tree version file created"     "test -f /tmp/braseh-tree-version.txt"

echo ""
echo "── Platform guards ──────────────────"
check "linux/ubuntu guard ran"        "test -f /tmp/braseh-distro-check.txt"
check "darwin guard did NOT run"      "! test -f /tmp/braseh-darwin-error.txt"

echo ""
echo "── Idempotency ──────────────────────"
echo "  (re-running apply — should be a no-op)"
braseh apply /home/testuser/basic.ts
check "BRASEH_MANAGED not duplicated"  "test \$(grep -c 'BRASEH_MANAGED' $HOME/.bashrc) -eq 1"

echo ""
echo "══════════════════════════════════════"
echo "  Results: ${PASS} passed / ${FAIL} failed"
echo "══════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
