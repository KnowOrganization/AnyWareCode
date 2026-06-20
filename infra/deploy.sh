#!/usr/bin/env bash
# Local -> Oracle box: rsync working dir + run bootstrap.
# Usage: IP=<public-ip> ./infra/deploy.sh
set -euo pipefail

IP="${IP:?set IP=<oracle public ip>}"
KEY="${KEY:-$HOME/Downloads/ssh-key-2026-06-20.key}"
USER_HOST="ubuntu@$IP"
SRC="$(cd "$(dirname "$0")/.." && pwd)/"
DEST="$USER_HOST:~/anywarecode/"

chmod 600 "$KEY"

rsync -az --delete \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  --exclude node_modules --exclude '.git' --exclude 'dist' \
  --exclude '**/dist' --exclude '.turbo' --exclude '**/.next' \
  "$SRC" "$DEST"

ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$USER_HOST" \
  'chmod +x ~/anywarecode/infra/oci-bootstrap.sh && ~/anywarecode/infra/oci-bootstrap.sh'
