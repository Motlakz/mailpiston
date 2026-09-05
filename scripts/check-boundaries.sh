#!/usr/bin/env bash
#
# Architectural boundaries that CI enforces, because comments do not.
#
#  1. Only server/providers/forward-email may name Forward Email.
#  2. Only server/core/config.ts may read process.env.
#  3. Nothing under components/ or lib/ may import @/server/*.
#
# Each check prints the offending lines and the rule it broke.

set -uo pipefail
cd "$(dirname "$0")/.."

status=0

report() {
  echo ""
  echo "✗ $1"
  echo ""
  cat /tmp/mailpiston-boundary-hits
  status=1
}

# --- 1. Provider leakage ------------------------------------------------------
grep -rn --include='*.ts' --include='*.tsx' -iE 'forward-?email' \
  app components lib server 2>/dev/null \
  | grep -v '^server/providers/forward-email/' \
  | grep -v '^server/providers/registry.ts' \
  | grep -v '^server/core/config.ts' \
  | grep -v '^app/api/providers/forward-email/' \
  | grep -v "'forward-email'" \
  | grep -v '"forward-email"' \
  | grep -v 'api/providers/forward-email' \
  | grep -vE '^[^:]+:[0-9]+: *(\*|//|/\*)' \
  > /tmp/mailpiston-boundary-hits

if [ -s /tmp/mailpiston-boundary-hits ]; then
  report "Forward Email named outside server/providers/forward-email (roadmap §2.1).
  The provider must be replaceable; nothing above the adapter may know which one it is.
  The identifier string 'forward-email' is allowed — provider *implementation* details are not."
fi

# --- 2. Bare process.env ------------------------------------------------------
grep -rn --include='*.ts' --include='*.tsx' 'process\.env' \
  app components lib server 2>/dev/null \
  | grep -v '^server/core/config.ts' \
  | grep -v '^server/test/' \
  | grep -v 'NEXT_PUBLIC_' \
  > /tmp/mailpiston-boundary-hits

if [ -s /tmp/mailpiston-boundary-hits ]; then
  report "process.env read outside server/core/config.ts (roadmap Phase 1.1).
  Config is zod-parsed once at boot so a missing variable fails the deployment,
  not the first inbound email. NEXT_PUBLIC_* is exempt (inlined at build time),
  and so is server/test/, which sets the variables config then parses."
fi

# --- 3. Client code importing the server -------------------------------------
grep -rn --include='*.ts' --include='*.tsx' "from '@/server/" \
  components lib 2>/dev/null \
  | grep -v "from '@/server/core/types'" \
  > /tmp/mailpiston-boundary-hits

if [ -s /tmp/mailpiston-boundary-hits ]; then
  report "components/ or lib/ imports @/server/* (roadmap §2.1).
  Only @/server/core/types is allowed through — it is types-only and erases at build."
fi

rm -f /tmp/mailpiston-boundary-hits

if [ "$status" -eq 0 ]; then
  echo "✓ boundaries clean"
fi

exit "$status"
