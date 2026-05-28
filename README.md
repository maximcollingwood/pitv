# pi-kiosk

A Raspberry Pi 4B configured as a locked-down web kiosk: boots straight into a
fullscreen web app, auto-restarts the app if it crashes, and is otherwise
stripped down — with a hotkey escape hatch to a terminal.

The device's configuration is **code, not a hand-tuned filesystem.** The repo
holds an Ansible playbook; "updating the pi" means pulling this repo and
re-applying it. The same playbook provisions a local dev VM, so the setup is
reproducible across machines and safe for multiple developers to work on
concurrently.

## How it works

| Concern              | Mechanism                                                        |
|----------------------|-----------------------------------------------------------------|
| Boot to app          | Raspberry Pi OS Lite → `labwc` (Wayland) → `chromium --kiosk`    |
| Crash recovery       | `systemd` `Restart=always` (labwc) + app relaunch loop          |
| Terminal escape hatch| labwc keybinding Ctrl+Alt+F2 → `chvt` to console · Ctrl+Alt+F1 → back |
| Config in git        | Ansible playbook applied via `ansible-pull`                      |
| Dev parity           | Vagrant VM provisioned by the **same** playbook (`ansible_local`)|

## Repo layout

```
Vagrantfile                 x86 Debian VM for dev parity
bootstrap.sh                first-flash: install git+ansible, pull, apply
package.json                npm workspaces + `npm run dev` orchestration
app/                        React + Vite frontend (remote-navigable)
server/                     Fastify API (TypeScript)
db/                         schema.sql + seed.sql (SQLite catalog)
ansible/
  site.yml                  top-level play
  ansible.cfg               inventory/roles defaults
  inventory/localhost.yml   every target provisions itself locally
  group_vars/all.yml        ← the file you edit most (URL, repo, paths)
  roles/
    base/                   apt, unattended-upgrades, git, ssh
    nodejs/                 Node.js (NodeSource)
    database/               sqlite3 + schema/seed, service user
    backend/                Fastify API build + systemd service
    app/                    frontend build + nginx (serves SPA, proxies /api)
    kiosk-user/             dedicated locked-down kiosk user
    display/                labwc + xwayland + chromium
    kiosk-service/          systemd unit, labwc config, launch scripts, update-kiosk
```

## First time: set up the pi

1. Edit `ansible/group_vars/all.yml`: set `kiosk_url` and `kiosk_repo_url`. Commit + push.
2. Flash **Raspberry Pi OS Lite (64-bit)** with Raspberry Pi Imager. In the
   imager's settings, set the hostname, enable SSH, and create your admin user.
3. SSH into the pi and run:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/maximcollingwood/pitv/main/bootstrap.sh \
     | sh -s -- https://github.com/maximcollingwood/pitv.git main
   sudo reboot
   ```
4. It boots straight into the web app.

## Updating the pi

After pushing changes to the repo, on the pi:

```sh
sudo update-kiosk
```

This pulls the latest commit and re-applies the playbook idempotently. (An
optional scheduled auto-pull timer ships **disabled** — enable it with
`sudo systemctl enable --now kiosk-update.timer` if you want hands-off updates.)

## Developing on Windows / Linux

Requires [Vagrant](https://www.vagrantup.com/) + VirtualBox.

```sh
vagrant up          # provision the VM with the same playbook
vagrant provision   # re-run after changes; second run should report no changes (idempotent)
vagrant ssh         # poke around
```

Because it provisions the **full app stack** (nginx + API + SQLite), you can
browse it from your host at **http://localhost:8080** (forwarded from the VM),
or check it over SSH:

```sh
vagrant ssh -c "systemctl is-active nginx pitv-backend; curl -s localhost/api/books | head -c 200"
```

> The VM validates the playbook, the **web app**, and the **API/database** end
> to end. It does **not** run the on-screen compositor: `cage`/libseat needs a
> real DRM graphics seat, which VirtualBox doesn't provide. The compositor layer
> is verified on the actual pi, which has a real GPU and seat.

## The kiosk app (architecture + local dev)

The kiosk displays a library catalog app, self-hosted on the device:

| Layer    | Tech                                  | On the pi                          |
|----------|---------------------------------------|------------------------------------|
| Frontend | React + Vite, spatial navigation      | built to `app/dist`, served by nginx |
| Backend  | Fastify (TypeScript)                  | `pitv-backend.service` on port 3000 |
| Database | SQLite (`db/schema.sql`, `db/seed.sql`) | `/var/lib/pitv/library.db`        |

nginx serves the built frontend and reverse-proxies `/api` to the backend. The
frontend is navigated with **arrow keys (D-pad), Enter (OK), and Back** so it's
ready for a TV remote (the remote hardware → key mapping is a separate, later
concern).

### Local dev loop (just Node, no pi/VM)

```sh
npm install      # installs app + server workspaces
npm run dev      # seeds a local SQLite DB, then runs API + Vite together
```

Open **http://localhost:5173** and navigate with your keyboard arrow keys +
Enter (identical to the real remote). Vite proxies `/api` to the local Fastify
server on :3000.

> Commit `package-lock.json` files after your first `npm install` so every dev
> and the pi resolve identical dependency versions.

To point the kiosk at a remote app instead of this local stack, set
`kiosk_serve_local_app: false` and change `kiosk_url`.

## Customizing

- **Change the displayed site:** `kiosk_url` in `ansible/group_vars/all.yml`.
- **Chromium behavior:** the `chromium_flags` list in the same file.
- **Secrets** (if the app needs credentials): use `ansible-vault`, never commit
  plaintext. `*.vault` and `secrets.yml` are gitignored.

## Verifying on the pi

```sh
systemctl status kiosk.service        # active (running) — this is labwc
sudo pkill -f chromium                # kill the app...
# ...the relaunch loop brings Chromium back within ~2s (labwc stays up)
sudo pkill -f labwc                   # kill the compositor...
systemctl status kiosk.service        # ...and systemd restarts it within ~2s
```
Ctrl+Alt+F2 should drop you to a login console; Ctrl+Alt+F1 returns to the kiosk.
