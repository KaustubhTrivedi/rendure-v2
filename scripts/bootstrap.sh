#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${RENDURE_REPO_URL:-https://github.com/KaustubhTrivedi/rendure-v2.git}"
APP_DIR="${RENDURE_APP_DIR:-rendure}"
HTTP_PORT="${HTTP_PORT:-8080}"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

log() {
  printf '%s\n' "$1"
}

random_hex() {
  local bytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c "$((bytes * 2))"
  fi
}

random_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 24 | tr '+/' '-_' | tr -d '='
  else
    LC_ALL=C tr -dc 'A-Za-z0-9_-' </dev/urandom | head -c 32
  fi
}

ensure_project_dir() {
  if [[ -f "docker-compose.yml" && -d "frontend" && -d "api" ]]; then
    return
  fi

  if [[ "$DRY_RUN" == true ]]; then
    return
  fi

  if [[ -d "$APP_DIR/.git" ]]; then
    log "Updating existing $APP_DIR checkout..."
    git -C "$APP_DIR" pull --ff-only
  else
    log "Cloning Rendure into $APP_DIR..."
    git clone "$REPO_URL" "$APP_DIR"
  fi

  cd "$APP_DIR"
}

write_env_if_missing() {
  if [[ -f ".env" ]]; then
    log "Using existing .env"
    return
  fi

  local postgres_password api_key encryption_key encoded_password
  postgres_password="$(random_password)"
  api_key="$(random_hex 24)"
  encryption_key="$(random_hex 32)"
  encoded_password="${postgres_password//@/%40}"

  cat > .env <<EOF
POSTGRES_USER=rendure_user
POSTGRES_PASSWORD=$postgres_password
POSTGRES_DB=rendure_db
DATABASE_URL=postgresql://rendure_user:$encoded_password@db:5432/rendure_db

RENDURE_API_KEY=$api_key
PROFILE_ENCRYPTION_KEY=$encryption_key
HTTP_PORT=$HTTP_PORT

OPENROUTER_API_KEY=
OPENROUTER_MODEL=qwen/qwen3-8b
MODEL_JOB_SCOUT=
MODEL_RESUME_TAILOR=
MODEL_QUALITY_ANALYST=
MODEL_CONFIRMATION=
MODEL_ORCHESTRATOR=
MODEL_FALLBACK=

QA_PASS_THRESHOLD=0.92
MAX_TAILORING_ITERATIONS=4
AGENT_TIMEOUT_SECONDS=300
POLL_INTERVAL_SECONDS=5
JINA_API_KEY=

CODEX_OAUTH_ENABLED=true
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EOF

  log "Created .env with local secrets."
}

start_system() {
  if [[ "$DRY_RUN" == true ]]; then
    log "Dry run: would run docker compose up -d --build"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log "Docker is required. Install Docker, start it, then rerun this command."
    exit 1
  fi

  docker compose up -d --build
}

print_next_steps() {
  local url="http://localhost:$HTTP_PORT"
  log ""
  log "Rendure is starting."
  log "Open $url"
  log "On first load, complete onboarding and add your OpenRouter API key."
}

ensure_project_dir
write_env_if_missing
start_system
print_next_steps
