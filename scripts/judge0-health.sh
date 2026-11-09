#!/usr/bin/env bash
# Health-check local/private Judge0. Usage: ./scripts/judge0-health.sh [baseUrl]
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:2358}"
BASE_URL="${BASE_URL%/}"
AUTH_HEADER=()
if [[ -n "${JUDGE0_AUTH_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "X-Auth-Token: ${JUDGE0_AUTH_TOKEN}")
fi

echo "Checking Judge0 at ${BASE_URL} ..."
ABOUT="$(curl -fsS --connect-timeout 5 "${AUTH_HEADER[@]}" "${BASE_URL}/about")"
echo "about: ${ABOUT}"

RESULT="$(curl -fsS --connect-timeout 30 -X POST \
  "${BASE_URL}/submissions?base64_encoded=false&wait=true" \
  -H "Content-Type: application/json" \
  "${AUTH_HEADER[@]}" \
  -d '{"source_code":"print(42)","language_id":71}')"

echo "submission: ${RESULT}"
echo "${RESULT}" | grep -q '"description":"Accepted"' || {
  echo "ERROR: expected Accepted status" >&2
  exit 1
}
echo "OK — Judge0 is healthy"
