use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::Executor;
use tauri::{Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

/// One statement inside a transaction request.
#[derive(Deserialize)]
struct TxStatement {
    sql: String,
    params: Vec<JsonValue>,
}

/// Per-statement result: rows affected and last inserted rowid.
#[derive(Serialize)]
struct TxResult {
    rows_affected: u64,
    last_insert_id: i64,
}

/// Execute a list of statements inside a single sqlx transaction on a
/// pinned connection. tauri-plugin-sql exposes only per-statement
/// `execute()` over a Pool, so JS-side `BEGIN`/`COMMIT` calls don't form
/// a real transaction (the BEGIN's connection is returned to the pool
/// before the next statement runs). This command bridges that gap.
#[tauri::command]
async fn db_execute_transaction(
    db: String,
    statements: Vec<TxStatement>,
    instances: State<'_, DbInstances>,
) -> Result<Vec<TxResult>, String> {
    // Clone the Pool<Sqlite> (cheap — it's Arc-wrapped) and drop the
    // read-guard before doing real work, so a long transaction doesn't
    // block writers on DbInstances (db close/reload, etc).
    let pool = {
        let instances = instances.0.read().await;
        match instances.get(&db) {
            // The plugin's `DbPool` only has the `Sqlite` variant under
            // our feature set; if mysql/postgres are ever enabled here,
            // exhaustiveness checking will flag the new arms.
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            None => return Err(format!("db '{db}' not found")),
        }
    };

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut results = Vec::with_capacity(statements.len());
    for stmt in statements {
        let mut q = sqlx::query(&stmt.sql);
        for v in stmt.params {
            if v.is_null() {
                q = q.bind(None::<JsonValue>);
            } else if v.is_string() {
                q = q.bind(v.as_str().unwrap().to_owned());
            } else if let Some(n) = v.as_number() {
                // Bind integers as i64 so WHERE clauses match correctly.
                // f64-binding all numbers (which is what tauri-plugin-sql
                // itself does in `execute`) silently degrades int IDs.
                if let Some(i) = n.as_i64() {
                    q = q.bind(i);
                } else if let Some(u) = n.as_u64() {
                    let i = i64::try_from(u).map_err(|_| {
                        format!("numeric parameter out of range for SQLite INTEGER: {u}")
                    })?;
                    q = q.bind(i);
                } else if let Some(f) = n.as_f64() {
                    q = q.bind(f);
                } else {
                    return Err(format!(
                        "numeric parameter cannot be represented in SQLite: {n}"
                    ));
                }
            } else {
                q = q.bind(v);
            }
        }
        let r = (&mut *tx).execute(q).await.map_err(|e| e.to_string())?;
        results.push(TxResult {
            rows_affected: r.rows_affected(),
            last_insert_id: r.last_insert_rowid(),
        });
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(results)
}

/// A JSON/text member written inline (genes.json, pets.json, metadata.json…).
#[derive(Deserialize)]
struct ZipTextEntry {
    archive_path: String,
    contents: String,
}

/// An on-disk file streamed into the archive without loading it into memory.
/// `source_rel` is resolved against the app data dir; it is never an absolute
/// or parent-escaping path (validated below).
#[derive(Deserialize)]
struct ZipFileEntry {
    archive_path: String,
    source_rel: String,
}

#[derive(Serialize)]
struct WriteZipResult {
    images_written: u32,
    /// Archive paths whose source file was missing/unreadable at write time.
    /// The matching pet_images.json record is harmless — import skips entries
    /// with no archive member.
    images_skipped: Vec<String>,
}

/// Reject absolute paths and any `..`/root/prefix component. Only plain names
/// and `.` are allowed, so a crafted entry can't write or read outside the
/// intended tree.
fn is_safe_relpath(p: &str) -> bool {
    if p.is_empty() {
        return false;
    }
    Path::new(p)
        .components()
        .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}

/// Stream a zip archive to `output_path`: text entries written inline, file
/// entries copied straight from disk into the writer. Memory stays flat (one
/// `io::copy` buffer) regardless of image-library size — the point of #92.
/// Everything is Stored (no compression): images are already-compressed and
/// JSON shrinkage isn't worth a deflate dependency.
fn write_zip_inner(
    base: PathBuf,
    output_path: String,
    text_entries: Vec<ZipTextEntry>,
    file_entries: Vec<ZipFileEntry>,
) -> Result<WriteZipResult, String> {
    let file = File::create(&output_path).map_err(|e| format!("create {output_path}: {e}"))?;
    let mut zw = ZipWriter::new(BufWriter::new(file));
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

    for entry in &text_entries {
        if !is_safe_relpath(&entry.archive_path) {
            return Err(format!("unsafe archive path: {}", entry.archive_path));
        }
        zw.start_file(&entry.archive_path, opts)
            .map_err(|e| e.to_string())?;
        zw.write_all(entry.contents.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    let mut images_written = 0u32;
    let mut images_skipped = Vec::new();
    for entry in &file_entries {
        if !is_safe_relpath(&entry.archive_path) {
            return Err(format!("unsafe archive path: {}", entry.archive_path));
        }
        if !is_safe_relpath(&entry.source_rel) {
            return Err(format!("unsafe source path: {}", entry.source_rel));
        }
        let mut src = match File::open(base.join(&entry.source_rel)) {
            Ok(f) => f,
            // A file that vanished between the JS existence check and now is
            // skipped (the export still succeeds). Any other open error
            // (permissions, I/O) is surfaced rather than silently producing an
            // incomplete backup.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                images_skipped.push(entry.archive_path.clone());
                continue;
            }
            Err(e) => return Err(format!("open {}: {e}", entry.source_rel)),
        };
        zw.start_file(&entry.archive_path, opts)
            .map_err(|e| e.to_string())?;
        std::io::copy(&mut src, &mut zw).map_err(|e| e.to_string())?;
        images_written += 1;
    }

    zw.finish().map_err(|e| e.to_string())?;
    Ok(WriteZipResult {
        images_written,
        images_skipped,
    })
}

/// Write a backup archive, streaming image files from the app data dir so the
/// whole library is never resident in the JS heap (issue #92). Heavy I/O runs
/// on the blocking pool to keep the async runtime responsive.
#[tauri::command]
async fn write_zip(
    app: tauri::AppHandle,
    output_path: String,
    text_entries: Vec<ZipTextEntry>,
    file_entries: Vec<ZipFileEntry>,
) -> Result<WriteZipResult, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        write_zip_inner(base, output_path, text_entries, file_entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Records a pre-update copy of the current install so a botched update can be
/// restored manually. `to_version` is the version being installed; when the app
/// next launches reporting that version, the update succeeded and the backup is
/// deleted on startup (see `run`). Persisted as JSON at
/// `<app_data>/update-backup/manifest.json`.
#[derive(Serialize, Deserialize, Clone)]
struct UpdateBackupManifest {
    /// Version that was running when the backup was taken (the one to restore).
    from_version: String,
    /// Version being installed. Startup cleanup keys off this.
    to_version: String,
    /// Absolute path of the install artifact that was copied.
    source_path: String,
    /// Absolute path of the backup copy under the app data dir.
    backup_path: String,
}

/// Locate the on-disk install artifact for the running app, per platform:
/// the `.app` bundle (macOS), the AppImage file (Linux), or the install
/// directory containing the executable (Windows). Derived from `exe` so the
/// core logic is unit-testable without a live Tauri context.
fn install_artifact_for(exe: &Path) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        // exe is .../Gorgonetics.app/Contents/MacOS/Gorgonetics — walk up to
        // the bundle root.
        for anc in exe.ancestors() {
            if anc.extension().is_some_and(|e| e == "app") {
                return Ok(anc.to_path_buf());
            }
        }
        Err("could not locate .app bundle from executable path".into())
    }
    #[cfg(target_os = "linux")]
    {
        // The AppImage runtime exports APPIMAGE as the absolute path of the
        // running image. Absent it, the app was started some other way (cargo
        // run, extracted bundle) and there is no single artifact to back up.
        let _ = exe;
        std::env::var("APPIMAGE")
            .map(PathBuf::from)
            .map_err(|_| "not running as an AppImage (APPIMAGE unset)".into())
    }
    #[cfg(target_os = "windows")]
    {
        exe.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "executable has no parent directory".into())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = exe;
        Err("update backup is not supported on this platform".into())
    }
}

/// Recursively copy `src` to `dst`, preserving symlinks (macOS `.app` bundles
/// rely on versioned symlinks under `Contents/Frameworks`). Files are copied
/// byte-for-byte; an existing `dst` tree is assumed already cleared by the
/// caller.
fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            let ty = entry.file_type()?;
            let from = entry.path();
            let to = dst.join(entry.file_name());
            if ty.is_symlink() {
                let target = std::fs::read_link(&from)?;
                #[cfg(unix)]
                std::os::unix::fs::symlink(&target, &to)?;
                #[cfg(not(unix))]
                {
                    let _ = target;
                    std::fs::copy(&from, &to)?;
                }
            } else if ty.is_dir() {
                copy_tree(&from, &to)?;
            } else {
                std::fs::copy(&from, &to)?;
            }
        }
    } else {
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(src, dst)?;
    }
    Ok(())
}

/// Directory holding the most recent pre-update backup and its manifest.
fn backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("update-backup"))
}

fn read_backup_manifest(dir: &Path) -> Result<Option<UpdateBackupManifest>, String> {
    let path = dir.join("manifest.json");
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).map(Some).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// A backup is stale once the running version matches the version it was taken
/// for — that means the update it guarded has installed and launched
/// successfully, so the backup can be discarded.
fn backup_is_obsolete(manifest: &UpdateBackupManifest, current_version: &str) -> bool {
    manifest.to_version == current_version
}

/// Copy the current install to the backup directory and write a manifest, so a
/// failed update can be manually restored. Best-effort by design: the JS caller
/// treats a failure as non-fatal and proceeds with the update. Any prior backup
/// is discarded first. Heavy I/O runs on the blocking pool.
#[tauri::command]
async fn backup_before_update(
    app: tauri::AppHandle,
    to_version: String,
) -> Result<UpdateBackupManifest, String> {
    let from_version = app.package_info().version.to_string();
    let dir = backup_dir(&app)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let source = install_artifact_for(&exe)?;
        let name = source
            .file_name()
            .ok_or_else(|| "install artifact has no file name".to_string())?;

        // Clear any stale backup (e.g. from an earlier failed update).
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        let payload = dir.join("payload");
        let dest = payload.join(name);
        std::fs::create_dir_all(&payload).map_err(|e| e.to_string())?;
        copy_tree(&source, &dest).map_err(|e| format!("copy install to backup: {e}"))?;

        let manifest = UpdateBackupManifest {
            from_version,
            to_version,
            source_path: source.to_string_lossy().into_owned(),
            backup_path: dest.to_string_lossy().into_owned(),
        };
        let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("manifest.json"), json).map_err(|e| e.to_string())?;
        Ok(manifest)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read the current backup manifest, if any. Surfaced to the UI so a failed
/// update can point the user at the restore path.
#[tauri::command]
fn get_update_backup(app: tauri::AppHandle) -> Result<Option<UpdateBackupManifest>, String> {
    read_backup_manifest(&backup_dir(&app)?)
}

/// Delete the pre-update backup. Called on startup once the update is confirmed
/// (see `run`) and exposed for an explicit "discard backup" action.
#[tauri::command]
fn cleanup_update_backup(app: tauri::AppHandle) -> Result<(), String> {
    let dir = backup_dir(&app)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// On startup, drop the pre-update backup if the running version shows the
/// guarded update landed. A surviving backup (still on the old version) means
/// the update failed; it is kept for manual restore.
fn cleanup_backup_on_launch(app: &tauri::AppHandle) {
    let Ok(dir) = backup_dir(app) else { return };
    let current = app.package_info().version.to_string();
    if let Ok(Some(manifest)) = read_backup_manifest(&dir) {
        if backup_is_obsolete(&manifest, &current) {
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            db_execute_transaction,
            write_zip,
            backup_before_update,
            get_update_backup,
            cleanup_update_backup
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_process::init())?;
            #[cfg(desktop)]
            cleanup_backup_on_launch(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn rejects_unsafe_paths() {
        assert!(is_safe_relpath("images/abc/photo.png"));
        assert!(is_safe_relpath("genes.json"));
        assert!(!is_safe_relpath(""));
        assert!(!is_safe_relpath("/etc/passwd"));
        assert!(!is_safe_relpath("../secret"));
        assert!(!is_safe_relpath("images/../../escape"));
    }

    #[test]
    fn streams_text_and_file_entries_and_skips_missing() {
        let dir = std::env::temp_dir().join(format!("gorg_ziptest_{}", std::process::id()));
        let src_dir = dir.join("images/7");
        std::fs::create_dir_all(&src_dir).unwrap();
        let img_bytes = b"\x89PNG\r\n\x1a\nfake-image-data";
        std::fs::write(src_dir.join("a.png"), img_bytes).unwrap();
        let out = dir.join("backup.zip");

        let result = write_zip_inner(
            dir.clone(),
            out.to_string_lossy().into_owned(),
            vec![ZipTextEntry {
                archive_path: "metadata.json".into(),
                contents: "{\"v\":2}".into(),
            }],
            vec![
                ZipFileEntry {
                    archive_path: "images/h/a.png".into(),
                    source_rel: "images/7/a.png".into(),
                },
                ZipFileEntry {
                    archive_path: "images/h/gone.png".into(),
                    source_rel: "images/7/gone.png".into(),
                },
            ],
        )
        .unwrap();

        assert_eq!(result.images_written, 1);
        assert_eq!(result.images_skipped, vec!["images/h/gone.png".to_string()]);

        // Read the archive back and verify members + byte-exact image payload.
        let mut archive = zip::ZipArchive::new(File::open(&out).unwrap()).unwrap();
        let mut meta = String::new();
        archive
            .by_name("metadata.json")
            .unwrap()
            .read_to_string(&mut meta)
            .unwrap();
        assert_eq!(meta, "{\"v\":2}");
        let mut got = Vec::new();
        archive
            .by_name("images/h/a.png")
            .unwrap()
            .read_to_end(&mut got)
            .unwrap();
        assert_eq!(got, img_bytes);
        assert!(archive.by_name("images/h/gone.png").is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn backup_obsolete_only_when_version_matches() {
        let manifest = UpdateBackupManifest {
            from_version: "0.6.3".into(),
            to_version: "0.6.4".into(),
            source_path: "/x".into(),
            backup_path: "/y".into(),
        };
        // Still on the old version → update hasn't landed → keep the backup.
        assert!(!backup_is_obsolete(&manifest, "0.6.3"));
        // Running the installed version → update succeeded → discard.
        assert!(backup_is_obsolete(&manifest, "0.6.4"));
    }

    #[test]
    fn read_manifest_absent_is_none() {
        let dir = std::env::temp_dir().join(format!("gorg_nomanifest_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(read_backup_manifest(&dir).unwrap().is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copy_tree_preserves_files_symlinks_and_nesting() {
        let root = std::env::temp_dir().join(format!("gorg_copytree_{}", std::process::id()));
        let src = root.join("src");
        let nested = src.join("Contents/MacOS");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("bin"), b"binary").unwrap();
        std::fs::write(src.join("Info.plist"), b"plist").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("Contents/MacOS/bin", src.join("link")).unwrap();

        let dst = root.join("dst");
        copy_tree(&src, &dst).unwrap();

        assert_eq!(std::fs::read(dst.join("Contents/MacOS/bin")).unwrap(), b"binary");
        assert_eq!(std::fs::read(dst.join("Info.plist")).unwrap(), b"plist");
        #[cfg(unix)]
        {
            let meta = std::fs::symlink_metadata(dst.join("link")).unwrap();
            assert!(meta.file_type().is_symlink());
            assert_eq!(
                std::fs::read_link(dst.join("link")).unwrap(),
                Path::new("Contents/MacOS/bin")
            );
        }

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_manifest_roundtrips_written_json() {
        let dir = std::env::temp_dir().join(format!("gorg_manifest_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let manifest = UpdateBackupManifest {
            from_version: "0.6.3".into(),
            to_version: "0.6.4".into(),
            source_path: "/Applications/Gorgonetics.app".into(),
            backup_path: "/data/update-backup/payload/Gorgonetics.app".into(),
        };
        std::fs::write(
            dir.join("manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();

        let read = read_backup_manifest(&dir).unwrap().unwrap();
        assert_eq!(read.to_version, "0.6.4");
        assert_eq!(read.from_version, "0.6.3");
        assert_eq!(read.source_path, "/Applications/Gorgonetics.app");

        std::fs::remove_dir_all(&dir).ok();
    }
}
