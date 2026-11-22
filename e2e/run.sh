#!/usr/bin/env bash
# braseh E2E test runner — all suites
# Usage: ./e2e/run.sh [--suite <name>] [--keep] [--no-build]
#   --suite basic|advanced|system|secrets|service  Run only one suite
#   --keep     Keep containers alive after run (for debugging)
#   --no-build Skip binary rebuild (use existing ./braseh)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEEP=false
NO_BUILD=false
SUITE=""

# while + shift, not for: shift inside a for loop does not move the loop, so
# "--no-build --suite service" used to set SUITE to the literal "--suite".
while [ $# -gt 0 ]; do
  case "$1" in
    --keep)     KEEP=true ;;
    --no-build) NO_BUILD=true ;;
    --suite)    shift; SUITE="${1:-}" ;;
    --suite=*)  SUITE="${1#--suite=}" ;;
  esac
  shift
done

# An unknown name would run nothing and report the suite as passed.
case "$SUITE" in
  ""|basic|advanced|system|secrets|service) ;;
  *) echo "unknown suite: $SUITE" >&2; exit 2 ;;
esac

SUITES=("basic" "advanced" "system" "secrets")
if [ -n "$SUITE" ]; then
  SUITES=("$SUITE")
fi

TOTAL_PASS=0
TOTAL_FAIL=0

hr() { echo "──────────────────────────────────────"; }

run_suite() {
  local suite="$1"
  local image="braseh-e2e-${suite}:latest"
  local container="braseh-e2e-${suite}-run"

  echo ""
  echo "╔══════════════════════════════════════╗"
  echo "║  Suite: ${suite^^}"
  echo "╚══════════════════════════════════════╝"

  local docker_opts="--name ${container}"
  [ "$KEEP" = false ] && docker_opts="$docker_opts --rm"

  local dockerfile="${REPO_ROOT}/e2e/Dockerfile"
  local run_cmd=""

  case "$suite" in
    service)
      dockerfile="${REPO_ROOT}/e2e/suites/service/Dockerfile.systemd"
      ;;
  esac

  # Build suite image
  echo "→ Building image ${image}..."
  docker build \
    --file "$dockerfile" \
    --tag "$image" \
    --quiet \
    "$REPO_ROOT" 2>&1 | tail -1
  echo "  ✓ Image built"

  # Build run command per suite
  case "$suite" in
    basic)
      run_cmd="
        set -e
        braseh apply /home/testuser/basic.ts
        bash /home/testuser/verify-basic.sh
      "
      ;;

    advanced)
      run_cmd="
        set -e
        braseh apply /home/testuser/advanced.ts
        bash /home/testuser/verify-advanced.sh
      "
      ;;

    system)
      run_cmd="
        set -e
        braseh apply /home/testuser/system.ts
        bash /home/testuser/verify-system.sh
      "
      ;;

    secrets)
      run_cmd="
        set -e
        # Set up secrets before applying
        mkdir -p .braseh
        braseh secrets set DB_PASSWORD 'supersecret123'
        braseh secrets set API_KEY 'test-api-key-abc'

        # Test check command (a local config needs editor types first)
        braseh prepare /home/testuser
        braseh check /home/testuser/secrets.ts

        # Test init command
        braseh init /tmp/braseh-init-test

        # Test dry-run (write a sentinel that SHOULD NOT be created)
        braseh apply /home/testuser/basic.ts --dry-run

        bash /home/testuser/verify-secrets.sh
      "
      ;;

    service)
      run_cmd="
        set -e
        # Wait for systemd to finish booting
        sleep 3
        su - testuser -c 'braseh apply /home/testuser/service.ts && bash /home/testuser/verify.sh'
      "
      ;;
  esac

  echo "→ Running suite..."

  local exit_code=0
  if [ "$suite" = "service" ]; then
    # Systemd containers need --privileged and different entry
    # shellcheck disable=SC2086
    docker run \
      $docker_opts \
      --privileged \
      --tmpfs /run \
      --tmpfs /run/lock \
      -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
      --cgroupns host \
      -d \
      "$image" || { echo "  ✗ Failed to start container"; return 1; }

    sleep 4  # Wait for systemd

    docker exec "${container}" bash -c "$run_cmd" || exit_code=$?

    if [ "$KEEP" = false ]; then
      docker stop "${container}" 2>/dev/null || true
      docker rm "${container}" 2>/dev/null || true
    fi
  else
    # shellcheck disable=SC2086
    docker run \
      $docker_opts \
      "$image" \
      bash -c "$run_cmd" || exit_code=$?
  fi

  if [ "$exit_code" -eq 0 ]; then
    echo ""
    echo "✓ Suite '${suite}' PASSED"
    TOTAL_PASS=$((TOTAL_PASS + 1))
  else
    echo ""
    echo "✗ Suite '${suite}' FAILED (exit code ${exit_code})"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    if [ "$KEEP" = true ]; then
      echo "  Container '${container}' is still running — attach with:"
      echo "    docker exec -it ${container} bash"
    fi
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       braseh E2E Test Runner          ║"
echo "╚══════════════════════════════════════╝"
echo "  Suites: ${SUITES[*]}"
echo ""

# Build binary (once, shared across suites)
if [ "$NO_BUILD" = false ]; then
  echo "→ Building braseh binary..."
  cd "$REPO_ROOT"
  bun build ./src/index.ts --compile --outfile braseh
  echo "  ✓ Binary built ($(du -sh braseh | cut -f1))"
fi

# Run each suite
for suite in "${SUITES[@]}"; do
  run_suite "$suite"
done

# Summary
echo ""
echo "╔══════════════════════════════════════╗"
echo "║  Final Summary"
echo "╠══════════════════════════════════════╣"
echo "║  Suites passed : ${TOTAL_PASS}"
echo "║  Suites failed : ${TOTAL_FAIL}"
echo "╚══════════════════════════════════════╝"
echo ""

[ "$TOTAL_FAIL" -eq 0 ] || exit 1
echo "✓ All E2E suites passed!"
