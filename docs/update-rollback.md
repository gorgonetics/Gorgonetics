# Update rollback — pre-update backup

The in-app auto-updater (#110) overwrites the install in place. The Tauri
updater has no built-in backup or rollback, so a failure during the swap (disk
full, power loss, a broken new build) could leave a corrupt install. As a safety
net (#111), the app copies the current install aside **before** the install step
and removes that copy once the new version launches successfully.

This is a manual-restore safety net, not an automatic rollback. Automatic
rollback of a build that won't launch would need an external watchdog process
the app can't provide while it's the thing that crashed; that is intentionally
out of scope.

## How it works

1. On "Install & restart", the updater downloads the new version, then the app
   calls the `backup_before_update` command, which copies the current install
   into `<app-data>/update-backup/payload/` and writes a `manifest.json`
   alongside it recording the from/to versions and the original install path.
2. The new version installs over the old one and the app relaunches.
3. On the next launch, startup compares the running version against the
   manifest's `to_version`. If they match, the update landed — the backup is
   deleted. If they don't (the app is still on the old version), the update
   failed and the backup is **kept** for manual restore.

The backup is taken on a best-effort basis: if the copy fails (e.g. no disk
space) the update still proceeds, since blocking a requested update on a missed
safety net is worse than proceeding without it.

### Backup location (`<app-data>`)

- macOS: `~/Library/Application Support/com.gorgonetics.app/update-backup/`
- Windows: `%APPDATA%\com.gorgonetics.app\update-backup\`
- Linux: `~/.local/share/com.gorgonetics.app/update-backup/`

The exact identifier follows the app's `identifier` in `tauri.conf.json`; the
manifest's `source_path` records where the backup must be restored to.

## Restoring manually

Only needed if an update failed and the app won't start correctly. Quit the app
first. Read `update-backup/manifest.json` for `source_path` (where the install
lives) and `backup_path` (the copy).

**macOS** — replace the `.app` bundle:

```bash
rm -rf "<source_path>"
cp -R "<backup_path>" "<source_path>"
```

If macOS refuses to open the restored app (Gatekeeper/quarantine), clear the
quarantine attribute:

```bash
xattr -dr com.apple.quarantine "<source_path>"
```

**Linux** — replace the AppImage file:

```bash
cp -f "<backup_path>" "<source_path>"
chmod +x "<source_path>"
```

**Windows** — replace the install directory contents. With the app closed, copy
everything from `backup_path` back over `source_path` (the install folder),
overwriting existing files.

After a successful manual restore, delete the `update-backup` directory so the
app doesn't treat the stale copy as a pending rollback.
