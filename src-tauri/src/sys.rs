//! Сведения о компьютере и потреблении ресурсов.
use serde_json::{json, Value};
use std::path::Path;
use sysinfo::{Disks, Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Manager, State};

pub fn free_space(path: &Path) -> u64 {
    let disks = Disks::new_with_refreshed_list();
    let mut best: Option<(usize, u64)> = None;
    for d in disks.list() {
        let mp = d.mount_point();
        if path.starts_with(mp) {
            let depth = mp.components().count();
            if best.map(|(b, _)| depth > b).unwrap_or(true) {
                best = Some((depth, d.available_space()));
            }
        }
    }
    best.map(|(_, s)| s).unwrap_or(0)
}

/// Память процесса и всех его потомков (на Windows сюда входят процессы WebView2).
/// exclude — PID поддерева, которое не нужно учитывать (движок ИИ считается отдельно).
pub fn process_tree_rss(root: u32, exclude: Option<u32>) -> u64 {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let root = Pid::from_u32(root);
    let ex = exclude.map(Pid::from_u32);
    let mut total = 0u64;
    for (pid, p) in sys.processes() {
        // поднимаемся по родителям: принадлежит ли процесс дереву root
        let mut cur = Some(*pid);
        let mut hops = 0;
        while let Some(c) = cur {
            if Some(c) == ex {
                break;
            }
            if c == root {
                total += p.memory();
                break;
            }
            cur = sys.process(c).and_then(|x| x.parent());
            hops += 1;
            if hops > 16 {
                break;
            }
        }
    }
    total
}

fn dir_size(p: &Path) -> u64 {
    let mut total = 0;
    if let Ok(rd) = std::fs::read_dir(p) {
        for e in rd.flatten() {
            let Ok(m) = e.metadata() else { continue };
            total += if m.is_dir() {
                dir_size(&e.path())
            } else {
                m.len()
            };
        }
    }
    total
}

#[tauri::command]
pub fn system_info(app: AppHandle) -> Value {
    let mut sys = System::new();
    sys.refresh_memory();
    let data = app.path().app_data_dir().unwrap_or_default();
    let _ = std::fs::create_dir_all(&data);
    json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "total_ram": sys.total_memory(),
        "free_disk": free_space(&data),
        "cpus": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
    })
}

#[tauri::command]
pub fn resource_usage(
    app: AppHandle,
    llm: State<'_, std::sync::Arc<crate::llm::LlmState>>,
) -> Value {
    let me = std::process::id();
    let llm_pid = llm.pid();
    let app_rss = process_tree_rss(me, llm_pid);
    let llm_rss = llm_pid.map(|p| process_tree_rss(p, None)).unwrap_or(0);
    let exe = std::env::current_exe().ok();
    // размер приложения: на macOS — весь пакет .app без движка ИИ, на Windows — исполняемый файл
    let app_size = exe
        .as_ref()
        .map(|e| {
            #[cfg(target_os = "macos")]
            {
                if let Some(bundle) = e
                    .ancestors()
                    .find(|a| a.extension().map(|x| x == "app").unwrap_or(false))
                {
                    let engine = crate::llm::engine_dir(&app)
                        .map(|d| dir_size(&d))
                        .unwrap_or(0);
                    return dir_size(bundle).saturating_sub(engine);
                }
            }
            std::fs::metadata(e).map(|m| m.len()).unwrap_or(0)
        })
        .unwrap_or(0);
    let engine_size = crate::llm::engine_dir(&app)
        .map(|d| dir_size(&d))
        .unwrap_or(0);
    let models_size = crate::llm::models_dir(&app)
        .map(|d| dir_size(&d))
        .unwrap_or(0);
    json!({ "app_rss": app_rss, "llm_rss": llm_rss, "app_size": app_size, "engine_size": engine_size, "models_size": models_size })
}
