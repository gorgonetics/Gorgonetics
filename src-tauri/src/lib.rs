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
    let instances = instances.0.read().await;
    let pool = instances
        .get(&db)
        .ok_or_else(|| format!("db '{db}' not found"))?;

    match pool {
        DbPool::Sqlite(pool) => {
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
                        q = q.bind(n.as_f64().unwrap_or_default());
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
        _ => Err("db_execute_transaction only supports sqlite pools".into()),
    }
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
