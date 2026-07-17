#!/bin/sh
# Inert operator rehearsal for a separately authorized deployment.
# It does not edit SWAG, DNS, the router, or the Boss Man host.
set -eu

: "${BOSS_MAN_URL:?Set BOSS_MAN_URL to the configured https origin}"
: "${SWAG_BASIC_USER:?Set SWAG_BASIC_USER}"
: "${SWAG_BASIC_PASSWORD:?Set SWAG_BASIC_PASSWORD}"
: "${BOSS_MAN_OWNER_PASSPHRASE:?Set BOSS_MAN_OWNER_PASSPHRASE}"

case "$BOSS_MAN_URL" in
  https://*) ;;
  *) echo "BOSS_MAN_URL must use https" >&2; exit 2 ;;
esac

cookie_jar="$(mktemp)"
headers="$(mktemp)"
body="$(mktemp)"
cleanup() { rm -f "$cookie_jar" "$headers" "$body"; }
trap cleanup EXIT HUP INT TERM

basic="$SWAG_BASIC_USER:$SWAG_BASIC_PASSWORD"

# The public edge must challenge a request that lacks outer Basic Auth.
code="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$BOSS_MAN_URL/api/session")"
[ "$code" = 401 ]

# Outer authentication alone is not an application owner session.
code="$(curl --silent --show-error --user "$basic" --output /dev/null --write-out '%{http_code}' "$BOSS_MAN_URL/api/session")"
[ "$code" = 401 ]

curl --silent --show-error --user "$basic" \
  --header 'Content-Type: application/json' \
  --dump-header "$headers" --cookie-jar "$cookie_jar" \
  --data "{\"passphrase\":\"$BOSS_MAN_OWNER_PASSPHRASE\"}" \
  "$BOSS_MAN_URL/api/session/login" >"$body"

grep -qi 'set-cookie: __Host-bm_session=.*Secure.*HttpOnly.*SameSite=Strict' "$headers"

# The login response must expose a CSRF token through its documented JSON field.
csrf="$(sed -n 's/.*"csrf_token":"\([^"]*\)".*/\1/p' "$body")"
[ -n "$csrf" ]

# An untrusted Origin is rejected even with both authentication layers.
code="$(curl --silent --show-error --user "$basic" --cookie "$cookie_jar" \
  --header 'Origin: https://untrusted.invalid' --output /dev/null \
  --write-out '%{http_code}' "$BOSS_MAN_URL/api/session")"
[ "$code" = 403 ]

# A state change without CSRF proof must fail.
code="$(curl --silent --show-error --user "$basic" --cookie "$cookie_jar" \
  --header "Origin: $BOSS_MAN_URL" --request POST --output /dev/null \
  --write-out '%{http_code}' "$BOSS_MAN_URL/api/session/revoke")"
[ "$code" = 403 ]

# A separately installed WebSocket client can verify terminal reconnect in the
# real environment. This avoids putting session cookies in a process listing.
if command -v websocat >/dev/null 2>&1; then
  echo "websocat is available; run the documented interactive reconnect check with an ephemeral cookie header"
else
  echo "websocat not installed; WebSocket operator check remains pending"
fi

curl --silent --show-error --user "$basic" --cookie "$cookie_jar" \
  --header "Origin: $BOSS_MAN_URL" --header "X-CSRF-Token: $csrf" \
  --request POST --output /dev/null "$BOSS_MAN_URL/api/session/revoke"

code="$(curl --silent --show-error --user "$basic" --cookie "$cookie_jar" \
  --output /dev/null --write-out '%{http_code}' "$BOSS_MAN_URL/api/session")"
[ "$code" = 401 ]

echo "HTTP edge contract passed; complete the documented WebSocket and large-artifact checks before deployment approval"
