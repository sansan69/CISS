#!/usr/bin/env bash
# CISS end-to-end acceptance gate.
#
#   bash tests/e2e/verify.sh
#
# Hard gates: the emulator-backed E2E acceptance suite, the web app's typecheck,
# lint, and unit test suite.
# Recorded-only: the Flutter app (analyze + test, each exit status recorded
# separately). The mobile tree is mid refactor under a separate owner, so its
# result is evidence, not a blocker for this harness.
set -uo pipefail
cd "$(dirname "$0")/../.."

fail=0

echo "=============================================================="
echo " 1/5  E2E acceptance suite (Firebase emulators + next dev)"
echo "=============================================================="
node tests/e2e/acceptance.mjs || fail=1

echo
echo "=============================================================="
echo " 2/5  Web: typecheck"
echo "=============================================================="
npm run typecheck || fail=1

echo
echo "=============================================================="
echo " 3/5  Web: lint"
echo "=============================================================="
npm run lint || fail=1

echo
echo "=============================================================="
echo " 4/5  Web: unit test suite"
echo "=============================================================="
npm test || fail=1

echo
echo "=============================================================="
echo " 5/5  Mobile (recorded, non-blocking): analyze + test"
echo "=============================================================="
MOBILE_DIR="../CISS-Mobile"
if [ -d "$MOBILE_DIR" ] && command -v flutter >/dev/null 2>&1; then
  (
    cd "$MOBILE_DIR" || exit 0
    echo "-- flutter analyze"
    flutter analyze 2>&1 | tail -25
    echo "MOBILE analyze exit: ${PIPESTATUS[0]}"
    echo "-- flutter test"
    flutter test 2>&1 | tail -25
    echo "MOBILE test exit: ${PIPESTATUS[0]}"
  ) || echo "MOBILE: invocation failed (recorded only)"
  echo "MOBILE: recorded, not a blocking gate for this harness"
else
  echo "MOBILE: Flutter toolchain or mobile repo not available (recorded)"
fi

echo
echo "=============================================================="
if [ "$fail" -ne 0 ]; then
  echo " GATE: FAILED (see tests/e2e/report.md)"
  exit 1
fi
echo " GATE: PASSED — see tests/e2e/report.md"
