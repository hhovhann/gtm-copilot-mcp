#!/usr/bin/env bash
# Regenerates the deterministic captures used on the demo slides, from real tool calls
# against a throwaway database. Needs network access for the DNS audit.
# Captures that come from real local-model runs (captures/local-*.txt, cost.txt) are kept as recorded.
set -euo pipefail
cd "$(dirname "$0")/../.."

OUT=docs/video/captures
WORK=$(mktemp -d)
export GTM_DB_PATH="$WORK/gtm.db" WEBHOOK_SECRET="capture-secret-0123456789" PORT=3931 SDR_DRAFTER=template
trap 'kill "${PID:-0}" 2>/dev/null || true; rm -rf "$WORK"' EXIT

npm run -s webhook > "$WORK/webhook.log" 2>&1 &
PID=$!
for _ in $(seq 1 40); do grep -q listening "$WORK/webhook.log" && break; sleep 0.5; done
grep -q listening "$WORK/webhook.log" || { echo "webhook did not start" >&2; exit 1; }
WEBHOOK_URL="http://127.0.0.1:$PORT" ./scripts/seed-demo-leads.sh > "$OUT/seed.txt"

call() { npm run -s call -- "$@"; }
call audit_domain '{"domain":"github.com"}'   > "$OUT/audit.txt"
call explain_lead '{"leadId":4}'              > "$OUT/explain.txt"
call list_leads   '{"limit":4}'               > "$OUT/list-leads.txt"
call draft_email  '{"leadId":9}'              > "$OUT/draft-injection.txt"
call draft_email  '{"leadId":6}'              > "$OUT/draft-skipped.txt" || true
echo "captured into $OUT"
