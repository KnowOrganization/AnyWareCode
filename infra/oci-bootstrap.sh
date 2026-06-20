#!/usr/bin/env bash
# Runs ON the Oracle box (Ubuntu 22.04 arm64). Idempotent.
# Installs Docker, brings up the stack, starts the Cloudflare tunnel.
set -euo pipefail

APP_DIR="$HOME/anywarecode"

# --- Swap (E2.1.Micro has only 1GB RAM; pnpm install + docker build OOM without it) ---
if [ ! -f /swapfile ]; then
  sudo fallocate -l 3G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# --- Docker (official convenience script; no-op if already installed) ---
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
fi

# Oracle Ubuntu images REJECT all inbound except 22 via iptables. Open 80/443
# for Caddy (ACME http-challenge + https), then persist across reboots.
sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null  || sudo iptables -I INPUT 6 -p tcp --dport 80  -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true

cd "$APP_DIR"

# --- App stack + Caddy (auto Let's Encrypt TLS, reverse-proxy :443 -> bot:3000) ---
sudo docker compose -f docker-compose.yml -f infra/caddy.yml up -d --build

echo "Bootstrap done. Stack:"
sudo docker compose -f docker-compose.yml -f infra/caddy.yml ps
