#!/bin/sh
# First-flash bootstrap for a fresh Raspberry Pi OS Lite install.
# Installs git + ansible, then pulls and applies this repo once.
#
# Usage (on the pi, over SSH):
#   curl -fsSL https://raw.githubusercontent.com/maximcollingwood/pitv/main/bootstrap.sh | sh -s -- <repo-url> [branch]
# or, if you've already cloned the repo:
#   ./bootstrap.sh <repo-url> [branch]
set -eu

REPO_URL="${1:-https://github.com/maximcollingwood/pitv.git}"
BRANCH="${2:-main}"

echo ">> Installing git + ansible..."
sudo apt-get update
sudo apt-get install -y git ansible

echo ">> Pulling and applying config from ${REPO_URL} (${BRANCH})..."
ansible-pull \
  --url "${REPO_URL}" \
  --checkout "${BRANCH}" \
  --inventory "localhost," \
  ansible/site.yml

echo ">> Done. Reboot to boot straight into the kiosk:  sudo reboot"
