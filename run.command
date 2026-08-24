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
HOSPITAL_EMAIL=hospital@local.test
MONGO_HOME="$HOME/.golden-hour"
MONGO_DATA="$MONGO_HOME/mongodb"
MONGO_LOG="$MONGO_HOME/mongod.log"
MONGO_PIDFILE="$MONGO_HOME/mongod.pid"
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
  stopped=0
  if [ -f "$MONGO_PIDFILE" ] && kill -0 "$(cat "$MONGO_PIDFILE")" 2>/dev/null; then
    kill "$(cat "$MONGO_PIDFILE")" 2>/dev/null && ok "Stopped mongod (pid $(cat "$MONGO_PIDFILE"))."
    rm -f "$MONGO_PIDFILE"
    stopped=1
  fi
  if command -v docker >/dev/null 2>&1 && docker ps -q -f name="$MONGO_CONTAINER" | grep -q .; then
    docker stop "$MONGO_CONTAINER" >/dev/null && ok "Container stopped."
    stopped=1
  fi
  [ "$stopped" -eq 0 ] && warn "Nothing to stop."
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

# Wait for the port to accept connections. A service manager reporting success
# is not the same as MongoDB being reachable, so the port is what we trust.
wait_for_mongo() {
  local tries="${1:-30}"
  printf '  waiting for MongoDB'
  for _ in $(seq 1 "$tries"); do
    if port_busy "$MONGO_PORT"; then printf '\n'; return 0; fi
    printf '.'; sleep 1
  done
  printf '\n'
  return 1
}

mongo_help() {
  cat <<HELP
     Start it manually with one of:
       brew services restart mongodb-community
       mongod --config \$(brew --prefix)/etc/mongod.conf --fork \\
              --logpath \$(brew --prefix)/var/log/mongodb/mongo.log
       docker run -d -p $MONGO_PORT:27017 mongo:7

     If Homebrew reports "Bootstrap failed: 5: Input/output error", the launch
     agent is stuck rather than missing. Clear it and retry:
       brew services stop mongodb-community
       launchctl bootout gui/\$(id -u)/homebrew.mxcl.mongodb-community 2>/dev/null
       brew services start mongodb-community
HELP
}

if port_busy "$MONGO_PORT"; then
  ok "Already running — using it."

elif command -v mongod >/dev/null 2>&1; then
  # Run the binary directly rather than through a service manager. Homebrew's
  # launch agent can report success while mongod dies immediately, which hides
  # the real error behind a service that claims to be running.
  mkdir -p "$MONGO_DATA" "$MONGO_HOME"
  mongod --dbpath "$MONGO_DATA" --port "$MONGO_PORT" \
         --fork --logpath "$MONGO_LOG" --pidfilepath "$MONGO_PIDFILE" >/dev/null 2>&1
  if ! wait_for_mongo 25; then
    printf '\n'
    [ -f "$MONGO_LOG" ] && tail -20 "$MONGO_LOG"
    die "MongoDB would not start.
     Data directory: $MONGO_DATA
     Log:            $MONGO_LOG
$(mongo_help)"
  fi
  ok "Started mongod (data in $MONGO_DATA)."

elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if docker ps -aq -f name="$MONGO_CONTAINER" | grep -q .; then
    docker start "$MONGO_CONTAINER" >/dev/null || die "Could not start the $MONGO_CONTAINER container."
  else
    docker run -d --name "$MONGO_CONTAINER" -p "$MONGO_PORT":27017 mongo:7 >/dev/null \
      || die "Could not create the MongoDB container."
  fi
  wait_for_mongo 30 || die "MongoDB container started but nothing is listening on port $MONGO_PORT."
  ok "Running in Docker."

elif command -v brew >/dev/null 2>&1 && brew list mongodb-community >/dev/null 2>&1; then
  brew services start mongodb-community >/dev/null 2>&1
  if ! wait_for_mongo 15; then
    # A stuck launch agent reports "Bootstrap failed: 5" and never binds.
    # Tearing the service down and bringing it back usually clears it.
    warn "Homebrew service did not come up — clearing it and retrying."
    brew services stop mongodb-community >/dev/null 2>&1
    launchctl bootout "gui/$(id -u)/homebrew.mxcl.mongodb-community" >/dev/null 2>&1
    sleep 2
    brew services start mongodb-community >/dev/null 2>&1
    wait_for_mongo 25 || die "MongoDB would not start on port $MONGO_PORT.
$(mongo_help)"
  fi
  ok "Started via Homebrew."

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

# Add a setting only when the file does not already define it. An existing
# value is never overwritten -- and creating the file only when absent is not
# enough, because an .env written by an older version of this script is
# missing keys the app now requires.
env_has() { [ -f "$1" ] && grep -qE "^[[:space:]]*$2=" "$1"; }

ensure_env() {
  local file="$1" key="$2" value="$3"
  [ -f "$file" ] || : > "$file"
  if env_has "$file" "$key"; then return 1; fi
  printf '%s=%s\n' "$key" "$value" >> "$file"
  return 0
}

# --- server ---------------------------------------------------------------
if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  ok "Created server/.env."
fi

server_added=""
ensure_env server/.env MONGO_URI "mongodb://127.0.0.1:$MONGO_PORT/samaritan-shield" && server_added="yes"
ensure_env server/.env PORT "$SERVER_PORT" && server_added="yes"

# Only opt into unverified tokens when no real credentials are configured --
# appending it alongside a service account would silently downgrade a properly
# configured server to accepting anything.
if env_has server/.env FIREBASE_SERVICE_ACCOUNT || env_has server/.env GOOGLE_APPLICATION_CREDENTIALS; then
  ok "server/.env — using the configured Firebase credentials."
else
  ensure_env server/.env ALLOW_INSECURE_NO_AUTH "true" && server_added="yes"
  ok "server/.env — local dev auth (tokens are not verified)."
fi
[ -n "$server_added" ] && warn "Added missing settings to server/.env."

# --- app ------------------------------------------------------------------
app_added=""
ensure_env app/.env EXPO_PUBLIC_API_URL "http://localhost:$SERVER_PORT" && app_added="yes"

if env_has app/.env EXPO_PUBLIC_FIREBASE_API_KEY; then
  ok "app/.env — using the configured Firebase project."
else
  ensure_env app/.env EXPO_PUBLIC_ALLOW_INSECURE_NO_AUTH "true" && app_added="yes"
  ok "app/.env — local sign-in, no Firebase project needed."
fi
[ -n "$app_added" ] && warn "Added missing settings to app/.env."

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
  # Most often this is a backend from a previous run, started by hand or left
  # behind by an interrupted one. Reclaim that; refuse to touch anything else.
  holder_pid=$(lsof -ti:"$SERVER_PORT" -sTCP:LISTEN 2>/dev/null | head -1)
  holder_cmd=$(ps -p "${holder_pid:-0}" -o command= 2>/dev/null || true)

  case "$holder_cmd" in
    *server.ts*|*dist/server.js*|*samaritan*)
      warn "Reclaiming port $SERVER_PORT from an earlier backend (pid $holder_pid)."
      kill "$holder_pid" 2>/dev/null
      for _ in $(seq 1 10); do
        port_busy "$SERVER_PORT" || break
        sleep 1
      done
      port_busy "$SERVER_PORT" && kill -9 "$holder_pid" 2>/dev/null && sleep 1
      port_busy "$SERVER_PORT" && die "Could not free port $SERVER_PORT (pid $holder_pid)."
      ;;
    *)
      die "Port $SERVER_PORT is in use by something else:
       pid $holder_pid — ${holder_cmd:-unknown}

     Stop it, or set PORT in server/.env to a free port."
      ;;
  esac
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
# 6b. Hospital desk account
# ---------------------------------------------------------------------------
step "Provisioning a hospital desk account"
if ( cd server && npx ts-node scripts/seed-hospital-staff.ts \
       --email "$HOSPITAL_EMAIL" \
       --hospitalId HOSP-01 \
       --hospitalName "Sawai Man Singh (SMS) Government Trauma Hospital" >/dev/null 2>&1 ); then
  ok "$HOSPITAL_EMAIL can reach the hospital desk."
else
  warn "Could not seed the hospital account — the citizen side still works."
fi

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

  ${BOLD}Sign in — no account setup needed${RESET}
    Citizen:   any email address, any password of 6+ characters
    Hospital:  ${BOLD}$HOSPITAL_EMAIL${RESET}, any password of 6+ characters

  ${BOLD}To see the whole thing work${RESET}
    1. Sign in as a citizen and press SOS. Note the SHA-256 shown.
    2. Open a second browser profile (or a private window) and sign in with
       $HOSPITAL_EMAIL — that is the hospital desk.
    3. The desk shows the incident. Dispatch a unit; the citizen screen updates.
    4. Compare the SHA-256 on both. They match, and
       ${BOLD}http://localhost:$SERVER_PORT/api/verify/<hash>${RESET} confirms the server holds it.

  ${DIM}Sign-in here is a local stand-in, not real authentication: no password is
  checked and no token is verified. Both sides opted into it explicitly and the
  server ignores the flag when NODE_ENV=production.

  Voice triage needs Chrome or Safari. Native speech recognition needs a
  development build, not Expo Go.${RESET}

  ${YELLOW}Press Ctrl+C to stop everything.${RESET}
  ${DIM}MongoDB keeps running; stop it with ./run.command stop${RESET}

INFO

# --clear resets Metro's cache. EXPO_PUBLIC_* values are inlined at build time,
# so a bundle cached before .env changed keeps serving the old values — which
# looks exactly like the setting being ignored.
cd app && npx expo start --web --clear
