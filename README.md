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
| Boot to app          | Raspberry Pi OS Lite → `cage` (Wayland kiosk) → `chromium --kiosk` |
| Crash recovery       | `systemd` unit `kiosk.service` with `Restart=always`            |
| Terminal escape hatch| Ctrl+Alt+F2 → login shell · Ctrl+Alt+F1 → back to kiosk          |
| Config in git        | Ansible playbook applied via `ansible-pull`                      |
| Dev parity           | Vagrant VM provisioned by the **same** playbook (`ansible_local`)|

## Repo layout

```
Vagrantfile                 x86 Debian VM for dev parity
bootstrap.sh                first-flash: install git+ansible, pull, apply
ansible/
  site.yml                  top-level play
  ansible.cfg               inventory/roles defaults
  inventory/localhost.yml   every target provisions itself locally
  group_vars/all.yml        ← the file you edit most (URL, repo, flags)
  roles/
    base/                   apt, unattended-upgrades, git
    kiosk-user/             dedicated locked-down kiosk user
    display/                cage + chromium
    kiosk-service/          systemd unit, launch script, update-kiosk helper
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

Confirm the app layer is serving correctly in the VM:

```sh
vagrant ssh -c "systemctl is-active nginx; grep -c 'Kiosk is running' /var/www/html/index.html"
# -> active
# -> 1
```

> The VM validates the playbook and the **web app** itself. It does **not** run
> the on-screen compositor: `cage`/libseat needs a real DRM graphics seat, which
> VirtualBox doesn't provide — trying to launch it there fails with
> `Failed to start a DRM session`. The compositor layer is verified on the
> actual pi, which has a real GPU and seat.

## Placeholder app

Out of the box the `app` role serves a static "hello world" page from nginx on
the device, and `kiosk_url` points at `http://localhost` — so you can confirm
the full pipeline (boot → compositor → Chromium → page) before a real app
exists. The page shows a live clock so you can tell it's actually rendering.

Once you have a real app, set `kiosk_serve_local_app: false` and point
`kiosk_url` at it.

## Customizing

- **Change the displayed site:** `kiosk_url` in `ansible/group_vars/all.yml`.
- **Chromium behavior:** the `chromium_flags` list in the same file.
- **Secrets** (if the app needs credentials): use `ansible-vault`, never commit
  plaintext. `*.vault` and `secrets.yml` are gitignored.

## Verifying on the pi

```sh
systemctl status kiosk.service        # active (running)
sudo pkill -f chromium                # kill the app...
systemctl status kiosk.service        # ...and watch systemd restart it within ~2s
```
Ctrl+Alt+F2 should drop you to a login shell; Ctrl+Alt+F1 returns to the kiosk.
