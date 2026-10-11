//! I AM — помощник дизайн-студии.
//! Ядро: окна (маскот + рабочее окно), трей / строка меню, автозапуск, хранение данных,
//! локальная языковая модель. Вся логика задач, таймера и напоминаний — во фронтенде
//! (работает без модели); ядро присылает событие `tick`, чтобы напоминания срабатывали
//! даже когда окно скрыто и браузерные таймеры замедлены системой.
mod llm;
mod store;
mod sys;

use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, RunEvent, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_notification::NotificationExt;

#[derive(Default)]
struct UiState {
    mascot_pos: Mutex<Option<(i32, i32)>>,
}

fn mascot(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("mascot")
}

// ---------------------------------------------------------------- окна

fn open_main_window(app: &AppHandle, tab: &str) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        let _ = w.emit("navigate", json!({ "tab": tab }));
        return Ok(());
    }
    // рабочее окно создаётся только по запросу и уничтожается при закрытии — экономия памяти.
    // Вкладку передаём через скрипт инициализации: «#» в адресе на Windows кодируется и ломает загрузку.
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("I AM — помощник")
        .inner_size(1120.0, 740.0)
        .min_inner_size(380.0, 520.0)
        .center()
        .initialization_script(&format!(
            "window.__IAM_TAB = {};",
            serde_json::to_string(tab).unwrap_or_default()
        ))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_main(app: AppHandle, tab: Option<String>) -> Result<(), String> {
    open_main_window(&app, tab.as_deref().unwrap_or(""))
}

fn set_mascot_visible(app: &AppHandle, visible: bool) {
    if let Some(w) = mascot(app) {
        let _ = if visible { w.show() } else { w.hide() };
        let _ = w.emit("mascot-visibility", json!({ "visible": visible }));
    }
}

#[tauri::command]
fn mascot_set_visible(app: AppHandle, visible: bool) {
    set_mascot_visible(&app, visible);
}

#[tauri::command]
fn mascot_set_on_top(app: AppHandle, on_top: bool) {
    if let Some(w) = mascot(&app) {
        let _ = w.set_always_on_top(on_top);
    }
}

/// Изменение размера окна маскота с сохранением правого нижнего угла
/// (реплика растёт вверх, панель — влево; сам персонаж остаётся на месте).
#[tauri::command]
fn mascot_resize(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let w = mascot(&app).ok_or("нет окна маскота")?;
    let scale = w.scale_factor().map_err(|e| e.to_string())?;
    let pos = w.outer_position().map_err(|e| e.to_string())?;
    let size = w.outer_size().map_err(|e| e.to_string())?;
    let nw = (width.clamp(60.0, 900.0) * scale).round() as i32;
    let nh = (height.clamp(60.0, 900.0) * scale).round() as i32;
    let right = pos.x + size.width as i32;
    let bottom = pos.y + size.height as i32;
    w.set_size(PhysicalSize::new(nw as u32, nh as u32))
        .map_err(|e| e.to_string())?;
    w.set_position(PhysicalPosition::new(right - nw, bottom - nh))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Начальное положение: сохранённое (если монитор на месте) или правый нижний угол.
fn place_mascot(app: &AppHandle, w: &WebviewWindow) {
    let saved = std::fs::read_to_string(pos_file(app)).ok().and_then(|s| {
        let v: serde_json::Value = serde_json::from_str(&s).ok()?;
        Some((v["x"].as_i64()? as i32, v["y"].as_i64()? as i32))
    });
    let monitors = w.available_monitors().unwrap_or_default();
    if let Some((x, y)) = saved {
        let inside = monitors.iter().any(|m| {
            let p = m.position();
            let s = m.size();
            x >= p.x - 50
                && y >= p.y - 50
                && x < p.x + s.width as i32 - 40
                && y < p.y + s.height as i32 - 40
        });
        if inside {
            let _ = w.set_position(PhysicalPosition::new(x, y));
            return;
        }
    }
    if let Ok(Some(m)) = w.primary_monitor() {
        let size = w.outer_size().unwrap_or(PhysicalSize::new(150, 210));
        let mp = m.position();
        let ms = m.size();
        let margin = (40.0 * m.scale_factor()) as i32;
        let bottom_margin = (90.0 * m.scale_factor()) as i32; // над панелью задач / Dock
        let _ = w.set_position(PhysicalPosition::new(
            mp.x + ms.width as i32 - size.width as i32 - margin,
            mp.y + ms.height as i32 - size.height as i32 - bottom_margin,
        ));
    }
}

fn pos_file(app: &AppHandle) -> std::path::PathBuf {
    store::data_dir(app)
        .map(|d| d.join("window.json"))
        .unwrap_or_default()
}

fn save_mascot_pos(app: &AppHandle) {
    if let Some(w) = mascot(app) {
        if let Ok(p) = w.outer_position() {
            let _ = std::fs::write(pos_file(app), json!({ "x": p.x, "y": p.y }).to_string());
        }
    }
}

// ---------------------------------------------------------------- система

#[tauri::command]
fn autostart_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn autostart_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|e| e.to_string())
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/// Номер фазы самопроверки (аргумент --selftest=N), 0 — обычный запуск.
#[tauri::command]
fn selftest_phase() -> u32 {
    std::env::args()
        .find_map(|a| a.strip_prefix("--selftest=").and_then(|n| n.parse().ok()))
        .unwrap_or(0)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    save_mascot_pos(&app);
    app.state::<Arc<llm::LlmState>>().kill();
    app.exit(0);
}

// ---------------------------------------------------------------- трей / строка меню

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(
        app,
        "toggle",
        "Показать / скрыть маскота",
        true,
        None::<&str>,
    )?;
    let open = MenuItem::with_id(app, "open", "Открыть рабочее окно", true, None::<&str>)?;
    let timer = MenuItem::with_id(
        app,
        "timer",
        "Таймер фокуса: старт / пауза",
        true,
        None::<&str>,
    )?;
    let dnd = MenuItem::with_id(
        app,
        "dnd",
        "Не беспокоить 1 час / выключить",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", "Настройки…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выйти из I AM", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[&toggle, &open, &sep1, &timer, &dnd, &settings, &sep2, &quit],
    )?;

    // macOS: чёрный силуэт-шаблон (система сама красит под светлую/тёмную строку меню);
    // Windows: цветной значок, чтобы был виден на тёмной панели задач.
    #[cfg(target_os = "macos")]
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    #[cfg(not(target_os = "macos"))]
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-color.png"))?;
    TrayIconBuilder::with_id("iam")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("I AM — помощник")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                let vis = mascot(app)
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);
                set_mascot_visible(app, !vis);
            }
            "open" => {
                let _ = open_main_window(app, "chat");
            }
            "settings" => {
                let _ = open_main_window(app, "settings");
            }
            "timer" => {
                let _ = app.emit("tray", json!({ "action": "timer" }));
            }
            "dnd" => {
                let _ = app.emit("tray", json!({ "action": "dnd" }));
            }
            "quit" => quit_app(app.clone()),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let vis = mascot(app)
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);
                set_mascot_visible(app, !vis);
            }
        })
        .build(app)?;
    Ok(())
}

// ---------------------------------------------------------------- запуск

pub fn run() {
    let llm_state = Arc::new(llm::LlmState::new());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // повторный запуск — просто показываем рабочее окно
            let _ = open_main_window(app, "chat");
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .manage(llm_state.clone())
        .manage(UiState::default())
        .invoke_handler(tauri::generate_handler![
            store::store_load,
            store::store_save,
            sys::system_info,
            sys::resource_usage,
            llm::models_installed,
            llm::model_download,
            llm::model_cancel_download,
            llm::model_delete,
            llm::llm_start,
            llm::llm_stop,
            llm::llm_status,
            llm::llm_config,
            llm::llm_chat,
            llm::llm_cancel,
            open_main,
            mascot_set_visible,
            mascot_set_on_top,
            mascot_resize,
            autostart_get,
            autostart_set,
            notify,
            quit_app,
            selftest_phase,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            build_tray(&handle)?;

            // настройки маскота из сохранённых данных
            let settings = store::read_settings(&handle);
            let visible = settings["mascotVisible"].as_bool().unwrap_or(true);
            let on_top = settings["onTop"].as_bool().unwrap_or(true);
            if let Some(m) = settings["model"]["unloadAfter"].as_u64() {
                *llm_state.unload_after_min.lock().unwrap() = m;
            }
            if let Some(w) = mascot(&handle) {
                place_mascot(&handle, &w);
                let _ = w.set_always_on_top(on_top);
                if visible {
                    let _ = w.show();
                }
            }

            // «пульс» для напоминаний и таймера (раз в 15 секунд)
            let h2 = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(15));
                let _ = h2.emit("tick", ());
            });
            llm::start_idle_watch(handle.clone(), llm_state.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            match (window.label(), event) {
                // окно маскота не закрывается (Alt+F4), а прячется в трей
                ("mascot", WindowEvent::CloseRequested { api, .. }) => {
                    api.prevent_close();
                    set_mascot_visible(window.app_handle(), false);
                }
                ("mascot", WindowEvent::Moved(p)) => {
                    if let Some(st) = window.app_handle().try_state::<UiState>() {
                        *st.mascot_pos.lock().unwrap() = Some((p.x, p.y));
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("ошибка запуска приложения");

    app.run(|app, event| match event {
        // закрытие рабочего окна не завершает приложение — маскот остаётся
        RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none() {
                api.prevent_exit();
            }
        }
        RunEvent::Exit => {
            save_mascot_pos(app);
            app.state::<Arc<llm::LlmState>>().kill();
        }
        _ => {}
    });
}
