#!/bin/bash
# ============================================================================
# Golden Hour — Samaritan Shield
# Double-click this file (macOS) or run ./run.command to set up, verify and
# launch the whole project.
#
#   ./run.command            setup, verify, then launch server + app
#   ./run.command verify     setup and run the checks, then stop
#   ./run.command stop       stop the background MongoDB container
# ============================================================================

set -uo pipefail
cd "$(dirname "$0")" || exit 1

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'

SERVER_PORT=3000
MONGO_PORT=27017
MONGO_CONTAINER=golden-hour-mongo
SERVER_PID=""

step()  { printf '\n%s▸ %s%s\n' "$BOLD$BLUE" "$1" "$RESET"; }
ok()    { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn()  { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
fail()  { printf '\n  %s✗ %s%s\n' "$RED" "$1" "$RESET"; }

# Keep the Terminal window open so the message is readable after a failure.
die() {
  fail "$1"
  printf '\n%sPress any key to close.%s\n' "$DIM" "$RESET"
  read -n 1 -s -r 2>/dev/null || true
  exit 1
}

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    printf '\n%sStopping backend (pid %s)...%s\n' "$DIM" "$SERVER_PID" "$RESET"
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# stop
# ---------------------------------------------------------------------------
if [ "${1:-}" = "stop" ]; then
  step "Stopping MongoDB"
  if command -v docker >/dev/null 2>&1 && docker ps -q -f name="$MONGO_CONTAINER" | grep -q .; then
    docker stop "$MONGO_CONTAINER" >/dev/null && ok "Container stopped."
  else
    warn "No $MONGO_CONTAINER container running."
  fi
  exit 0
fi

printf '%s\n' "$BOLD"
printf '  ╔══════════════════════════════════════════════╗\n'
printf '  ║   Golden Hour — Samaritan Shield             ║\n'
printf '  ╚══════════════════════════════════════════════╝\n'
printf '%s' "$RESET"

# ---------------------------------------------------------------------------
# 1. Prerequisites
# ---------------------------------------------------------------------------
step "Checking prerequisites"

command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node 22+ from https://nodejs.org"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  die "Node $(node -v) is too old. This project needs Node 22+."
fi
ok "Node $(node -v)"

command -v npm >/dev/null 2>&1 || die "npm not found."
ok "npm $(npm -v)"

# ---------------------------------------------------------------------------
# 2. MongoDB
# ---------------------------------------------------------------------------
step "Checking MongoDB on port $MONGO_PORT"

if port_busy "$MONGO_PORT"; then
  ok "Already running — using it."
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker ps -aq -f name="$MONGO_CONTAINER" | grep -q .; then
    docker start "$MONGO_CONTAINER" >/dev/null && ok "Restarted existing container."
  else
    docker run -d --name "$MONGO_CONTAINER" -p "$MONGO_PORT":27017 mongo:7 >/dev/null \
      && ok "Started mongo:7 in Docker." \
      || die "Could not start the MongoDB container."
  fi
  printf '  waiting for MongoDB'
  for _ in $(seq 1 30); do
    port_busy "$MONGO_PORT" && break
    printf '.'; sleep 1
  done
  printf '\n'
  port_busy "$MONGO_PORT" || die "MongoDB did not come up on port $MONGO_PORT."
elif command -v brew >/dev/null 2>&1 && brew list mongodb-community >/dev/null 2>&1; then
  brew services start mongodb-community >/dev/null && ok "Started via Homebrew."
  sleep 3
else
  die "MongoDB is not running and no way to start it was found.
     Install one of:
       Docker Desktop        https://docker.com/products/docker-desktop
       brew tap mongodb/brew && brew install mongodb-community"
fi

# ---------------------------------------------------------------------------
# 3. Environment files
# ---------------------------------------------------------------------------
step "Checking environment files"

if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  # Local verification runs without Firebase. This flag is dev-only: tokens are
  # read as `uid:email` with no signature check, and the server ignores it when
  # NODE_ENV=production.
  printf '\nALLOW_INSECURE_NO_AUTH=true\n' >> server/.env
  ok "Created server/.env (insecure dev auth — local verification only)."
  warn "For real use, set FIREBASE_SERVICE_ACCOUNT and remove ALLOW_INSECURE_NO_AUTH."
else
  ok "server/.env exists."
fi

if [ ! -f app/.env ]; then
  cp app/.env.example app/.env
  ok "Created app/.env."
else
  ok "app/.env exists."
fi

# ---------------------------------------------------------------------------
# 4. Dependencies
# ---------------------------------------------------------------------------
step "Installing dependencies"

install_deps() {
  local dir="$1"
  if [ -d "$dir/node_modules" ]; then
    ok "$dir — already installed."
    return
  fi
  printf '  installing %s (this can take a minute)...\n' "$dir"
  ( cd "$dir" && npm ci --no-audit --no-fund >/dev/null 2>&1 ) \
    || ( cd "$dir" && npm install --no-audit --no-fund >/dev/null 2>&1 ) \
    || die "npm install failed in $dir. Run 'cd $dir && npm install' to see why."
  ok "$dir — installed."
}

install_deps server
install_deps app

# ---------------------------------------------------------------------------
# 5. Verification
# ---------------------------------------------------------------------------
step "Verifying — typecheck and unit tests"

( cd server && npm run typecheck >/dev/null 2>&1 ) || die "Server typecheck failed. Run: cd server && npm run typecheck"
ok "Server typechecks."

( cd app && npm run typecheck >/dev/null 2>&1 ) || die "App typecheck failed. Run: cd app && npm run typecheck"
ok "App typechecks."

# Decide on the exit code, not on the output text. Node's default test reporter
# differs by version -- Node 22 emits TAP ("# fail 0") while Node 25 emits the
# spec reporter ("ℹ fail 0") -- so parsing the summary misreads a passing
# run on a newer Node. The count below is for display only.
TEST_OUT=$(cd server && npm test 2>&1)
TEST_STATUS=$?
if [ "$TEST_STATUS" -eq 0 ]; then
  # Both reporters render the summary as "<marker> pass <n>", so match on
  # fields rather than a byte-wise character class.
  TEST_COUNT=$(printf '%s' "$TEST_OUT" | awk '$2=="pass" {print $3; exit}')
  ok "Unit tests: ${TEST_COUNT:-all} passed."
else
  printf '%s\n' "$TEST_OUT" | tail -30
  die "Unit tests failed."
fi

# ---------------------------------------------------------------------------
# 6. Start the backend
# ---------------------------------------------------------------------------
step "Starting the backend on port $SERVER_PORT"

if port_busy "$SERVER_PORT"; then
  die "Port $SERVER_PORT is already in use. Stop that process and try again."
fi

mkdir -p .logs
( cd server && npm run dev > "../.logs/server.log" 2>&1 ) &
SERVER_PID=$!

printf '  waiting for the server'
for _ in $(seq 1 45); do
  if curl -fsS "http://localhost:$SERVER_PORT/api/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    printf '\n'; tail -25 .logs/server.log
    die "The server exited during startup. Full log: .logs/server.log"
  fi
  printf '.'; sleep 1
done
printf '\n'

HEALTH=$(curl -fsS "http://localhost:$SERVER_PORT/api/health" 2>/dev/null) \
  || die "Server never became healthy. Log: .logs/server.log"
ok "Backend healthy — $HEALTH"

# ---------------------------------------------------------------------------
# 7. End-to-end check
# ---------------------------------------------------------------------------
step "Running the end-to-end check"
printf '%s  Exercises the auth boundary and asserts the record digest matches\n' "$DIM"
printf '  across responder, hospital feed and public verification.%s\n\n' "$RESET"

if ( cd server && node test_e2e_sync.js ); then
  ok "End-to-end checks passed."
else
  fail "End-to-end checks failed — see the output above."
  printf '  %sServer log: .logs/server.log%s\n' "$DIM" "$RESET"
fi

if [ "${1:-}" = "verify" ]; then
  printf '\n%s✓ Verification complete.%s Backend still running on port %s.\n' "$BOLD$GREEN" "$RESET" "$SERVER_PORT"
  printf '%sPress any key to stop it and exit.%s\n' "$DIM" "$RESET"
  read -n 1 -s -r 2>/dev/null || true
  exit 0
fi

# ---------------------------------------------------------------------------
# 8. Launch the app
# ---------------------------------------------------------------------------
step "Launching the app"
cat <<INFO

  ${BOLD}Backend${RESET}  http://localhost:$SERVER_PORT   ${DIM}(log: .logs/server.log)${RESET}
  ${BOLD}App${RESET}      opening in your browser shortly

  ${BOLD}To try it:${RESET}
    1. Sign up as a citizen, then press SOS.
    2. In a second browser profile, sign up again — that account is a
       citizen too. Hospital access is provisioned deliberately:

         ${DIM}cd server && npx ts-node scripts/seed-hospital-staff.ts \\
           --email you@example.com \\
           --hospitalId HOSP-01 \\
           --hospitalName "SMS Government Trauma Hospital"${RESET}

       Sign in again afterwards to pick up the role.
    3. As the hospital desk, dispatch a unit and watch the citizen's
       screen update. Compare the SHA-256 on both — they now match.
    4. Open ${BOLD}http://localhost:$SERVER_PORT/api/verify/<that hash>${RESET} to confirm it.

  ${DIM}Note: voice triage needs Chrome or Safari for speech. Native speech
  recognition requires a development build, not Expo Go.${RESET}

  ${YELLOW}Press Ctrl+C to stop everything.${RESET}

INFO

cd app && npm run web
