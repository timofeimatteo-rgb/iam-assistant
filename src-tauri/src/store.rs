//! Локальное хранение данных: JSON-файлы в папке данных приложения.
//! Ничего не отправляется в сеть.
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("data");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn file_for(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    // только латинские буквы — защита от обхода путей
    if name.is_empty() || name.len() > 32 || !name.chars().all(|c| c.is_ascii_lowercase()) {
        return Err("недопустимое имя хранилища".into());
    }
    Ok(data_dir(app)?.join(format!("{name}.json")))
}

#[tauri::command]
pub fn store_load(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = file_for(&app, &name)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn store_save(app: AppHandle, name: String, data: String) -> Result<(), String> {
    // проверяем, что это корректный JSON, и пишем атомарно через временный файл
    serde_json::from_str::<serde_json::Value>(&data)
        .map_err(|e| format!("некорректные данные: {e}"))?;
    let path = file_for(&app, &name)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Чтение настроек на стороне ядра (видимость маскота, «поверх окон»).
pub fn read_settings(app: &AppHandle) -> serde_json::Value {
    file_for(app, "settings")
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null)
}
