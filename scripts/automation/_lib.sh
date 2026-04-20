#!/usr/bin/env bash
# Shared helpers for JAK automation scripts.
# Sourced by each script — not executed directly.

set -u

# ─── Colors (no-op on non-TTY) ──────────────────────────────────────────────

if [ -t 1 ]; then
  C_RED=$'\033[0;31m'
  C_GREEN=$'\033[0;32m'
  C_YELLOW=$'\033[0;33m'
  C_BLUE=$'\033[0;34m'
  C_DIM=$'\033[2m'
  C_RESET=$'\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_DIM=''; C_RESET=''
fi

info()  { printf "%s[info]%s %s\n" "$C_BLUE"   "$C_RESET" "$*"; }
ok()    { printf "%s[ ok ]%s %s\n" "$C_GREEN"  "$C_RESET" "$*"; }
warn()  { printf "%s[warn]%s %s\n" "$C_YELLOW" "$C_RESET" "$*" >&2; }
fail()  { printf "%s[fail]%s %s\n" "$C_RED"    "$C_RESET" "$*" >&2; }
die()   { fail "$*"; exit 1; }

# ─── Dependency check ──────────────────────────────────────────────────────

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1. Install it and re-run."
}

# ─── Env var guard ─────────────────────────────────────────────────────────

require_env() {
  local var="$1"
  if [ -z "${!var:-}" ]; then
    die "Env var $var is not set. See scripts/automation/README.md."
  fi
}

# ─── Confirmation prompt (skippable with --yes flag) ──────────────────────

ASSUME_YES=0
for arg in "$@"; do
  if [ "$arg" = "--yes" ] || [ "$arg" = "-y" ]; then
    ASSUME_YES=1
  fi
done

confirm() {
  local prompt="$1"
  if [ "$ASSUME_YES" = "1" ]; then
    info "$prompt (auto-yes via --yes)"
    return 0
  fi
  printf "%s[?]%s %s [y/N]: " "$C_YELLOW" "$C_RESET" "$prompt"
  read -r answer
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) info "Skipped by user."; return 1 ;;
  esac
}

# ─── Safe curl with JSON body ──────────────────────────────────────────────
# Usage: api_call <METHOD> <URL> <AUTH_HEADER> [<JSON_BODY>]
# Prints response body to stdout. Returns 0 on 2xx, 1 on any other status.

api_call() {
  local method="$1"
  local url="$2"
  local auth_header="$3"
  local body="${4:-}"

  local tmp_body
  tmp_body=$(mktemp)
  trap "rm -f '$tmp_body'" RETURN

  local status
  if [ -n "$body" ]; then
    status=$(curl -sS -o "$tmp_body" -w '%{http_code}' \
      -X "$method" \
      -H "$auth_header" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      --data "$body" \
      --max-time 30 \
      "$url")
  else
    status=$(curl -sS -o "$tmp_body" -w '%{http_code}' \
      -X "$method" \
      -H "$auth_header" \
      -H "Accept: application/json" \
      --max-time 30 \
      "$url")
  fi

  cat "$tmp_body"
  rm -f "$tmp_body"

  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    fail "API call returned HTTP $status (method=$method url=$url)" >&2
    return 1
  fi
  return 0
}

# ─── Masked token display (never print full token) ────────────────────────

mask_token() {
  local token="$1"
  local len=${#token}
  if [ "$len" -lt 12 ]; then
    printf '***'
  else
    local prefix="${token:0:6}"
    local suffix="${token: -4}"
    printf '%s…%s' "$prefix" "$suffix"
  fi
}
