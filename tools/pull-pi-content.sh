#!/usr/bin/env bash
# Copy a Pi's library into the Vagrant development VM: the content database,
# uploaded images and downloaded background music, so the VM's TV and phone UIs show real
# content. The Pi is only read; the VM's previous database is kept as a backup.
#
# Usage (from the repo, with the VM running):
#   bash tools/pull-pi-content.sh [--no-media] [user@host]
# Defaults to pitv@raspberrypi.local. The SSH user needs passwordless sudo
# (the Raspberry Pi OS default). PITV_SSH_KEY selects a key file.
# --no-media skips the music files; those tracks then download again in the VM.
# (Videos stream, so there are none to copy.)
set -euo pipefail

media=1
target=pitv@raspberrypi.local
for arg in "$@"; do
  case $arg in
    --no-media) media=0 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) target=$arg ;;
  esac
done

root=$(cd "$(dirname "$0")/.." && pwd)
archive="$root/.artifacts/pi-content.tar"
mkdir -p "$root/.artifacts"
ssh_args=(-o BatchMode=yes)
key=${PITV_SSH_KEY:-$HOME/.ssh/id_ed25519_pitv}
[[ -f $key ]] && ssh_args+=(-i "$key")
members="uploads"
[[ $media == 1 ]] && members="uploads media"

echo "Copying the library from $target ..."
# The online backup gives a consistent snapshot, including committed WAL data,
# while the Pi keeps running. Partial downloads (media/.work) are skipped.
ssh "${ssh_args[@]}" "$target" "set -e
  tmp=\$(mktemp -d); trap 'sudo -n rm -rf \"\$tmp\"' EXIT
  sudo -n sqlite3 /var/lib/pitv/library.db \".backup '\$tmp/library.db'\"
  sudo -n tar -cf - --exclude=media/.work -C \"\$tmp\" library.db -C /var/lib/pitv $members" > "$archive"
echo "Received $(du -h "$archive" | cut -f1). Installing into the VM ..."

cd "$root"
vagrant ssh -c 'sudo bash -s' <<'VM'
set -euo pipefail
data=/var/lib/pitv
user=$(systemctl show -p User --value pitv-backend)
work=$(mktemp -d /var/tmp/pitv-pull.XXXXXX)
trap 'rm -rf "$work"' EXIT
tar -xf /vagrant/.artifacts/pi-content.tar -C "$work"
systemctl stop pitv-backend
backup="$data/vm-before-pull-$(date +%Y%m%d-%H%M%S).db"
[ -f "$data/library.db" ] && sqlite3 "$data/library.db" ".backup '$backup'" && echo "Previous VM database saved as $backup"
rm -f "$data/library.db-wal" "$data/library.db-shm"
install -o "$user" -g "$user" -m 0644 "$work/library.db" "$data/library.db"
for dir in uploads media; do
  if [ -d "$work/$dir" ]; then rm -rf "${data:?}/$dir"; mv "$work/$dir" "$data/$dir"; chown -R "$user:$user" "$data/$dir"; fi
done
systemctl start pitv-backend
echo "The VM now shows the Pi's library."
VM
rm -f "$archive"
