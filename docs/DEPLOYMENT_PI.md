# Deployment on Raspberry Pi

Two deployment approaches are documented below. Start with **Option A** (simple clone), then optionally add **Option B** (ArchiDep auto-deploy) when you want automated deployments.

---

## Shared setup (both options)

### 1. Clone the repo on the Pi

```bash
ssh jermarti@PI_IP
cd ~
git clone https://github.com/jerem-marti/MAInD-Prototyping_Spatial_Experiences-2026.git maind-deploy
```

### 2. Create the environment file

```bash
cp ~/maind-deploy/config/shadow.env.example ~/maind-deploy/config/shadow.env
nano ~/maind-deploy/config/shadow.env
```

Set `KISMET_PASS` and verify all paths point to `~/maind-deploy/...`.

### 3. Install dependencies

```bash
bash ~/maind-deploy/scripts/install_pi_deps.sh
```

### 4. Install services

This installs systemd units for the three backend processes and adds the kiosk browser to the desktop's autostart:

```bash
bash ~/maind-deploy/scripts/install_services.sh
```

What it does:
- Copies `shadow-kismet.service`, `shadow-reducer.service`, `shadow-backend.service` to `/etc/systemd/system/` (with paths resolved from the deploy directory)
- Enables all three system services
- Detects the active desktop session (`rpd-x` on Pi OS) and appends the kiosk launch command to `~/.config/lxsession/<session>/autostart`
- Cleans up any old systemd user service from a previous install

### 5. Create the state directory

```bash
mkdir -p ~/maind-deploy/state
```

### 6. Reboot

```bash
sudo reboot
```

After reboot:
1. **systemd** starts Kismet, Reducer, and Backend
2. **lxsession** starts the desktop, then launches Chromium in kiosk mode via `scripts/kiosk.sh`
3. The kiosk script waits for the backend to respond before opening the browser

---

## Option A: Simple deployment (git pull)

After the shared setup above, the project is ready to run. To update:

```bash
ssh jermarti@PI_IP
cd ~/maind-deploy
git pull
bash scripts/deploy/restart_services.sh
```

This restarts all backend services and relaunches the kiosk browser with the new code.

---

## Option B: ArchiDep auto-deploy (bare repo + hook)

This adds automated deployment: `git push pi main` from your laptop updates the Pi and restarts services automatically. This is the pattern taught in the ArchiDep course.

### How it works

```
LAPTOP                              RASPBERRY PI

git push pi main  ──────────►  ~/maind-deploy-repo/     (bare repo)
                                       │
                                       │ triggers
                                       ▼
                                hooks/post-receive        (script)
                                       │
                                       ├─► git checkout -f main
                                       │   into ~/maind-deploy/   (work tree)
                                       │
                                       └─► restart_services.sh    (restarts all)
```

- **`GIT_DIR`** = the bare repo (git database only, no files)
- **`GIT_WORK_TREE`** = where the actual code lives (same `~/maind-deploy/` from the clone)

### B1. Create the bare repo on the Pi

```bash
ssh jermarti@PI_IP
mkdir -p ~/maind-deploy-repo
cd ~/maind-deploy-repo
git init --bare
```

### B2. Install the post-receive hook

Since `~/maind-deploy/` already exists from the clone:

```bash
cp ~/maind-deploy/scripts/deploy/post-receive ~/maind-deploy-repo/hooks/post-receive
chmod +x ~/maind-deploy-repo/hooks/post-receive
```

### B3. Allow passwordless service restart

The hook needs to restart systemd services. Add to sudoers:

```bash
sudo visudo
# Add this line:
jermarti ALL=(ALL) NOPASSWD: /bin/systemctl daemon-reload, /bin/systemctl restart shadow-reducer, /bin/systemctl restart shadow-backend, /bin/systemctl restart shadow-kismet
```

### B4. Add the Pi remote on your laptop

```bash
git remote add pi jermarti@PI_IP:/home/jermarti/maind-deploy-repo
```

### B5. Deploy

```bash
git push pi main
```

This triggers the `post-receive` hook which:
1. Checks out the latest code into `~/maind-deploy`
2. Runs `scripts/deploy/restart_services.sh` (restarts backend services + relaunches kiosk)

You can still `git push origin main` for GitHub separately -- the two remotes are independent.

---

## Verify

```bash
ssh jermarti@PI_IP
sudo systemctl status shadow-kismet
sudo systemctl status shadow-reducer
sudo systemctl status shadow-backend
journalctl -u shadow-backend -f
```

## Rollback

### Option A

```bash
ssh jermarti@PI_IP
cd ~/maind-deploy
git log --oneline          # find the commit to go back to
git checkout <commit-hash> -- .
bash scripts/deploy/restart_services.sh
```

### Option B

```bash
# From laptop: force-push a previous commit
git push pi <commit-hash>:main --force
```
