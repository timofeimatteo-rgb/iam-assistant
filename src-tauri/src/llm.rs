//! Локальная языковая модель: движок llama.cpp (llama-server) запускается как отдельный
//! процесс только при первом обращении к чату и выгружается при простое.
//! Общение идёт только через 127.0.0.1 — в интернет ничего не отправляется.
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct Engine {
    child: Option<Child>,
    port: u16,
    file: String,
    key: String, // параметры запуска, при изменении которых нужен перезапуск
}

pub struct LlmState {
    pub engine: Mutex<Option<Engine>>,
    pub starting: tokio::sync::Mutex<()>,
    pub last_used: Mutex<Instant>,
    pub unload_after_min: Mutex<u64>,
    pub busy: AtomicBool,
    pub cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl LlmState {
    pub fn new() -> Self {
        Self {
            engine: Mutex::new(None),
            starting: tokio::sync::Mutex::new(()),
            last_used: Mutex::new(Instant::now()),
            unload_after_min: Mutex::new(10),
            busy: AtomicBool::new(false),
            cancels: Mutex::new(HashMap::new()),
            downloads: Mutex::new(HashMap::new()),
        }
    }
    pub fn pid(&self) -> Option<u32> {
        self.engine
            .lock()
            .ok()?
            .as_ref()?
            .child
            .as_ref()
            .map(|c| c.id())
    }
    pub fn kill(&self) {
        if let Ok(mut g) = self.engine.lock() {
            if let Some(mut e) = g.take() {
                if let Some(mut c) = e.child.take() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
            }
        }
    }
}

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

pub fn engine_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("llama"))
}

fn server_exe(app: &AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    };
    let p = engine_dir(app)?.join(name);
    if !p.exists() {
        return Err(format!("не найден движок ИИ: {}", p.display()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(m) = fs::metadata(&p) {
            if m.permissions().mode() & 0o111 == 0 {
                let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o755));
            }
        }
    }
    Ok(p)
}

fn safe_file(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || !name.ends_with(".gguf")
    {
        return Err("недопустимое имя файла модели".into());
    }
    Ok(())
}

fn free_port() -> Result<u16, String> {
    let l = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(l.local_addr().map_err(|e| e.to_string())?.port())
}

fn log_tail(path: &PathBuf) -> String {
    let mut s = String::new();
    if let Ok(mut f) = fs::File::open(path) {
        let _ = f.read_to_string(&mut s);
    }
    let lines: Vec<&str> = s.lines().rev().take(6).collect();
    lines.into_iter().rev().collect::<Vec<_>>().join("\n")
}

fn spawn(
    app: &AppHandle,
    model: &PathBuf,
    port: u16,
    ctx: u32,
    gpu: bool,
    extra: &[String],
) -> Result<(Child, PathBuf), String> {
    let exe = server_exe(app)?;
    let log = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("llama.log");
    let logf = fs::File::create(&log).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&exe);
    cmd.arg("-m")
        .arg(model)
        .args(["--host", "127.0.0.1", "--port", &port.to_string()])
        .args(["-c", &ctx.to_string()])
        .args(["-ngl", if gpu { "99" } else { "0" }])
        .args(["--parallel", "1", "--jinja"])
        .args(extra)
        .current_dir(exe.parent().unwrap())
        .stdin(Stdio::null())
        .stdout(Stdio::from(logf.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(logf));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — без чёрного окна консоли
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("не удалось запустить движок ИИ: {e}"))?;
    Ok((child, log))
}

async fn wait_ready(state: &LlmState, port: u16, log: &PathBuf) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("http://127.0.0.1:{port}/health");
    let started = Instant::now();
    loop {
        // процесс завершился — значит ошибка запуска
        {
            let mut g = state.engine.lock().map_err(|e| e.to_string())?;
            if let Some(e) = g.as_mut() {
                if let Some(c) = e.child.as_mut() {
                    if let Ok(Some(status)) = c.try_wait() {
                        g.take();
                        return Err(format!("движок завершился ({status}). {}", log_tail(log)));
                    }
                }
            }
        }
        if let Ok(r) = client.get(&url).send().await {
            if r.status().is_success() {
                return Ok(());
            }
        }
        if started.elapsed() > Duration::from_secs(180) {
            return Err("модель загружалась слишком долго".into());
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

#[tauri::command]
pub async fn llm_start(
    app: AppHandle,
    state: State<'_, Arc<LlmState>>,
    file: String,
    args: Vec<String>,
    accel: String,
    ctx: u32,
    unload_after: u64,
) -> Result<Value, String> {
    safe_file(&file)?;
    let _guard = state.starting.lock().await;
    *state.unload_after_min.lock().unwrap() = unload_after;
    *state.last_used.lock().unwrap() = Instant::now();
    let key = format!("{file}|{accel}|{ctx}|{}", args.join(" "));
    if let Some(e) = state.engine.lock().unwrap().as_ref() {
        if e.key == key {
            return Ok(json!({ "state": "ready", "port": e.port }));
        }
    }
    state.kill();
    let model = models_dir(&app)?.join(&file);
    if !model.exists() {
        return Err("файл модели не найден — скачайте её в настройках".into());
    }
    let _ = app.emit("llm-state", json!({ "state": "loading", "file": file }));
    let ctx = ctx.clamp(1024, 16384);
    let mut gpu = accel != "cpu";
    loop {
        let port = free_port()?;
        let (child, log) = spawn(&app, &model, port, ctx, gpu, &args)?;
        *state.engine.lock().unwrap() = Some(Engine {
            child: Some(child),
            port,
            file: file.clone(),
            key: key.clone(),
        });
        match wait_ready(&state, port, &log).await {
            Ok(()) => {
                let _ = app.emit("llm-state", json!({ "state": "ready", "file": file }));
                return Ok(json!({ "state": "ready", "port": port, "gpu": gpu }));
            }
            Err(e) if gpu => {
                // видеоускорение не заработало — пробуем на процессоре
                eprintln!("GPU start failed, retrying on CPU: {e}");
                state.kill();
                gpu = false;
            }
            Err(e) => {
                state.kill();
                let _ = app.emit("llm-state", json!({ "state": "error", "error": e }));
                return Err(e);
            }
        }
    }
}

#[tauri::command]
pub fn llm_stop(app: AppHandle, state: State<'_, Arc<LlmState>>) {
    state.kill();
    let _ = app.emit("llm-state", json!({ "state": "stopped", "reason": "user" }));
}

#[tauri::command]
pub fn llm_config(state: State<'_, Arc<LlmState>>, unload_after: u64) {
    *state.unload_after_min.lock().unwrap() = unload_after;
}

#[tauri::command]
pub fn llm_status(state: State<'_, Arc<LlmState>>) -> Value {
    let g = state.engine.lock().unwrap();
    match g.as_ref() {
        Some(e) => {
            let rss = e
                .child
                .as_ref()
                .map(|c| crate::sys::process_tree_rss(c.id(), None))
                .unwrap_or(0);
            json!({ "state": "ready", "file": e.file, "port": e.port, "rss": rss })
        }
        None => json!({ "state": "stopped" }),
    }
}

/// Потоковый ответ модели. Фрагменты уходят в окно через Channel.
#[tauri::command]
pub async fn llm_chat(
    state: State<'_, Arc<LlmState>>,
    id: String,
    body: String,
    on_event: Channel<Value>,
) -> Result<(), String> {
    let port = match state.engine.lock().unwrap().as_ref() {
        Some(e) => e.port,
        None => return Err("модель не загружена".into()),
    };
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .cancels
        .lock()
        .unwrap()
        .insert(id.clone(), cancel.clone());
    state.busy.store(true, Ordering::SeqCst);
    *state.last_used.lock().unwrap() = Instant::now();

    let result = async {
        let mut req: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        req["stream"] = json!(true);
        let client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client
            .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
            .json(&req)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            let code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!(
                "HTTP {code}: {}",
                text.chars().take(300).collect::<String>()
            ));
        }
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::SeqCst) {
                return Ok("cancelled"); // соединение закрывается — сервер прекращает генерацию
            }
            let chunk = chunk.map_err(|e| e.to_string())?;
            buf.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(i) = buf.find('\n') {
                let line = buf[..i].trim().to_string();
                buf.drain(..=i);
                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data == "[DONE]" {
                    return Ok("stop");
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    if let Some(t) = v["choices"][0]["delta"]["content"].as_str() {
                        if !t.is_empty() {
                            let _ = on_event.send(json!({ "type": "delta", "text": t }));
                        }
                    }
                }
            }
        }
        Ok("stop")
    }
    .await;

    state.cancels.lock().unwrap().remove(&id);
    state.busy.store(false, Ordering::SeqCst);
    *state.last_used.lock().unwrap() = Instant::now();
    match result {
        Ok(reason) => {
            let _ = on_event.send(json!({ "type": "done", "reason": reason }));
            Ok(())
        }
        Err(e) => {
            let _ = on_event.send(json!({ "type": "error", "message": e }));
            Ok(())
        }
    }
}

#[tauri::command]
pub fn llm_cancel(state: State<'_, Arc<LlmState>>, id: String) {
    if let Some(c) = state.cancels.lock().unwrap().get(&id) {
        c.store(true, Ordering::SeqCst);
    }
}

/// Фоновая выгрузка модели при простое.
pub fn start_idle_watch(app: AppHandle, state: Arc<LlmState>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));
        let mins = *state.unload_after_min.lock().unwrap();
        if mins == 0 || state.busy.load(Ordering::SeqCst) || state.engine.lock().unwrap().is_none()
        {
            continue;
        }
        if state.last_used.lock().unwrap().elapsed() > Duration::from_secs(mins * 60) {
            state.kill();
            let _ = app.emit(
                "llm-state",
                json!({ "state": "stopped", "reason": "idle", "minutes": mins }),
            );
        }
    });
}

// ------------------------------------------------------------------ модели на диске

#[tauri::command]
pub fn models_installed(app: AppHandle) -> Result<Vec<Value>, String> {
    let mut out = vec![];
    for e in fs::read_dir(models_dir(&app)?)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let name = e.file_name().to_string_lossy().to_string();
        if name.ends_with(".gguf") {
            out.push(json!({ "file": name, "size": e.metadata().map(|m| m.len()).unwrap_or(0) }));
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn model_delete(
    app: AppHandle,
    state: State<'_, Arc<LlmState>>,
    file: String,
) -> Result<(), String> {
    safe_file(&file)?;
    if state
        .engine
        .lock()
        .unwrap()
        .as_ref()
        .map(|e| e.file == file)
        .unwrap_or(false)
    {
        state.kill();
    }
    let dir = models_dir(&app)?;
    let _ = fs::remove_file(dir.join(format!("{file}.part")));
    match fs::remove_file(dir.join(&file)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn model_cancel_download(state: State<'_, Arc<LlmState>>, id: String) {
    if let Some(c) = state.downloads.lock().unwrap().get(&id) {
        c.store(true, Ordering::SeqCst);
    }
}

/// Скачивание модели с докачкой (.part + Range), прогресс — событием model-progress.
#[tauri::command]
pub async fn model_download(
    app: AppHandle,
    state: State<'_, Arc<LlmState>>,
    id: String,
    url: String,
    file: String,
    size: u64,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    safe_file(&file)?;
    if !url.starts_with("https://huggingface.co/") {
        return Err("разрешена загрузка только с huggingface.co".into());
    }
    let dir = models_dir(&app)?;
    let free = crate::sys::free_space(&dir);
    let part = dir.join(format!("{file}.part"));
    let have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if free > 0 && size > have && free < (size - have) + 200 * 1024 * 1024 {
        return Err(format!(
            "недостаточно места на диске: нужно ещё {} МБ",
            (size - have) / 1_048_576 + 200
        ));
    }
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .downloads
        .lock()
        .unwrap()
        .insert(id.clone(), cancel.clone());
    let emit = |received: u64, st: &str| {
        let _ = app.emit(
            "model-progress",
            json!({ "id": id, "received": received, "total": size, "state": st }),
        );
    };

    let res: Result<(), String> = async {
        let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
        let mut req = client.get(&url);
        if have > 0 {
            req = req.header("Range", format!("bytes={have}-"));
        }
        let resp = req.send().await.map_err(|e| format!("нет соединения: {e}"))?;
        let status = resp.status();
        if !(status.is_success()) {
            return Err(format!("сервер ответил {status}"));
        }
        let resumed = status.as_u16() == 206;
        let mut f = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(resumed)
            .truncate(!resumed)
            .open(&part)
            .await
            .map_err(|e| e.to_string())?;
        let mut received = if resumed { have } else { 0 };
        let mut last = Instant::now();
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::SeqCst) {
                f.flush().await.ok();
                return Err("загрузка остановлена".into());
            }
            let chunk = chunk.map_err(|e| format!("соединение прервалось: {e}"))?;
            f.write_all(&chunk).await.map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            if last.elapsed() > Duration::from_millis(300) {
                emit(received, "downloading");
                last = Instant::now();
            }
        }
        f.flush().await.map_err(|e| e.to_string())?;
        drop(f);
        emit(received, "verifying");
        // проверка: размер и заголовок формата GGUF
        let len = fs::metadata(&part).map_err(|e| e.to_string())?.len();
        if size > 0 && len != size {
            return Err(format!("файл скачан не полностью ({len} из {size} байт) — нажмите «Скачать», чтобы продолжить"));
        }
        let mut magic = [0u8; 4];
        fs::File::open(&part).and_then(|mut f| f.read_exact(&mut magic)).map_err(|e| e.to_string())?;
        if &magic != b"GGUF" {
            let _ = fs::remove_file(&part);
            return Err("скачанный файл повреждён — попробуйте ещё раз".into());
        }
        fs::rename(&part, dir.join(&file)).map_err(|e| e.to_string())?;
        emit(len, "done");
        Ok(())
    }
    .await;
    state.downloads.lock().unwrap().remove(&id);
    if let Err(e) = &res {
        let _ = app.emit("model-progress", json!({ "id": id, "received": fs::metadata(&part).map(|m| m.len()).unwrap_or(0), "total": size, "state": "error", "error": e }));
    }
    res
}
