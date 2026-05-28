#!/bin/bash
# Smoke Tests — hit every health endpoint and key API routes
# Exits non-zero if any check fails

set -e

INGESTION="http://localhost:5010"
AI="http://localhost:5011"
REVIEW="http://localhost:5012"
PASS=0
FAIL=0

check() {
  local name="$1"
  local url="$2"
  local expected="$3"

  response=$(curl -sf "$url" 2>/dev/null || echo "CURL_FAILED")

  if echo "$response" | grep -q "$expected"; then
    echo "  ✅ PASS — $name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ FAIL — $name (got: $response)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Levatas Demo — Smoke Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "[ Health Checks ]"
check "Ingestion API /health"  "$INGESTION/health" "ok"
check "AI Service /health"     "$AI/health"        "ok"
check "Review Service /health" "$REVIEW/health"    "ok"

echo ""
echo "[ Inspections Endpoint ]"
check "GET /inspections returns array" "$INGESTION/inspections" "\["

echo ""
echo "[ Review Queue Endpoint ]"
check "GET /queue returns array"       "$REVIEW/queue"        "\["
check "GET /queue/stats returns total" "$REVIEW/queue/stats"  "total"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $FAIL -gt 0 ]; then
  exit 1
fi
