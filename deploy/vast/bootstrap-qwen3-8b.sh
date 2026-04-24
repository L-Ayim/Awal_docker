#!/usr/bin/env bash
set -euo pipefail

SCRIPT_URL="${SCRIPT_URL:-https://raw.githubusercontent.com/L-Ayim/Awal_docker/main/deploy/vast/bootstrap-vast.sh}"

if [ -f "$(dirname "${BASH_SOURCE[0]}")/bootstrap-vast.sh" ]; then
  exec "$(dirname "${BASH_SOURCE[0]}")/bootstrap-vast.sh" 8b
fi

curl -fsSL "$SCRIPT_URL" | bash -s -- 8b
