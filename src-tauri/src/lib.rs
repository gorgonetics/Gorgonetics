use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::Executor;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

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
                    let i = i64::try_from(u)
                        .map_err(|_| format!("numeric parameter out of range for SQLite INTEGER: {u}"))?;
                    q = q.bind(i);
                } else if let Some(f) = n.as_f64() {
                    q = q.bind(f);
                } else {
                    return Err(format!("numeric parameter cannot be represented in SQLite: {n}"));
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![db_execute_transaction])
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
