// The desktop shell: starts the bundled Node runtime (desktop/launcher.mjs: local database, app server, MSX
// connector), shows the app it serves on loopback, and shuts it all down cleanly when the window closes.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Default)]
struct Backend {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    stopping: AtomicBool,
}

type Log = Arc<Mutex<Option<File>>>;

/// Links to other sites open in the default browser; the window only ever shows the local app.
const LINKS: &str = r#"(() => {
  if (window.__cdLinks) return;
  window.__cdLinks = true;
  const external = (href) => {
    try {
      const u = new URL(href, location.href);
      return /^(https?|mailto):$/.test(u.protocol) && u.origin !== location.origin ? u.href : null;
    } catch {
      return null;
    }
  };
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a || a.hasAttribute("download")) return;
    const href = external(a.getAttribute("href"));
    if (!href) return;
    e.preventDefault();
    location.assign(href);
  }, true);
  const open = window.open;
  window.open = (url, ...rest) => {
    const href = url ? external(String(url)) : null;
    if (href) {
      location.assign(href);
      return null;
    }
    return open.call(window, url, ...rest);
  };
})();"#;

fn data_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("CloudDelivery")
}

fn log_path() -> PathBuf {
    data_dir().join("logs").join("desktop.log")
}

fn open_log() -> Log {
    let path = log_path();
    let _ = fs::create_dir_all(path.parent().unwrap());
    let _ = fs::rename(&path, path.with_file_name("desktop.prev.log"));
    Arc::new(Mutex::new(
        OpenOptions::new().create(true).append(true).open(&path).ok(),
    ))
}

fn write_log(log: &Log, line: &str) {
    if let Some(f) = log.lock().unwrap().as_mut() {
        let _ = writeln!(f, "{line}");
    }
}

fn hidden(mut cmd: Command) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn is_local(url: &Url) -> bool {
    matches!(url.scheme(), "tauri" | "about" | "data" | "blob")
        || matches!(url.host_str(), Some("tauri.localhost" | "127.0.0.1" | "localhost"))
}

fn open_in_browser(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let mut cmd = hidden(Command::new("rundll32"));
        let _ = cmd.args(["url.dll,FileProtocolHandler", url.as_str()]).spawn();
    }
}

fn show_error(window: &WebviewWindow, message: &str) {
    let text = format!("{message}\n\nDetails are in {}", log_path().display());
    let text = serde_json::to_string(&text).unwrap_or_else(|_| "\"\"".into());
    let js = format!(
        r#"(() => {{
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;inset:0;display:grid;place-items:center;background:#f7f8fa;font:14px 'Segoe UI',sans-serif;color:#1f2937;z-index:2147483647";
  const box = document.createElement("div");
  box.style.cssText = "max-width:560px;padding:24px;text-align:center";
  const h = document.createElement("h1");
  h.style.cssText = "font-size:16px;margin:0 0 8px";
  h.textContent = "Cloud Delivery couldn't start";
  const p = document.createElement("p");
  p.style.cssText = "color:#6b7280;white-space:pre-wrap;margin:0";
  p.textContent = {text};
  box.append(h, p);
  wrap.append(box);
  document.body.replaceChildren(wrap);
}})();"#
    );
    let _ = window.eval(&js);
}

fn start_backend(handle: &AppHandle, window: WebviewWindow) -> Result<(), String> {
    let log = open_log();
    let dir = handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("app");
    let node = dir.join("node.exe");
    let launcher = dir.join("desktop").join("launcher.mjs");
    write_log(&log, &format!("starting {} {}", node.display(), launcher.display()));
    let mut cmd = hidden(Command::new(&node));
    cmd.arg(&launcher)
        .arg("--shell")
        .env("CD_APP_DIR", &dir)
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Couldn't start the bundled runtime ({}): {e}", node.display()))?;
    let stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let state = handle.state::<Backend>();
    *state.stdin.lock().unwrap() = child.stdin.take();
    *state.child.lock().unwrap() = Some(child);

    let err_log = log.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = stderr.read(&mut buf) {
            if n == 0 {
                break;
            }
            write_log(&err_log, String::from_utf8_lossy(&buf[..n]).trim_end());
        }
    });

    let handle = handle.clone();
    thread::spawn(move || {
        let mut ready = false;
        let mut failure: Option<String> = None;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            write_log(&log, &line);
            let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            match event["event"].as_str() {
                Some("ready") => {
                    if let Some(url) = event["url"].as_str().and_then(|u| Url::parse(u).ok()) {
                        ready = true;
                        let _ = window.navigate(url);
                    }
                }
                Some("error") => {
                    failure = event["message"].as_str().map(str::to_owned);
                }
                _ => {}
            }
        }
        if handle.state::<Backend>().stopping.load(Ordering::SeqCst) {
            return;
        }
        let message = failure.unwrap_or_else(|| {
            if ready {
                "Cloud Delivery's local service stopped. Close the app and open it again.".into()
            } else {
                "The local service ended before it was ready.".into()
            }
        });
        write_log(&log, &format!("stopped: {message}"));
        show_error(&window, &message);
    });
    Ok(())
}

/// Closing stdin asks the launcher to stop the app server and close the database; give it time to finish.
fn stop_backend(handle: &AppHandle) {
    let state = handle.state::<Backend>();
    state.stopping.store(true, Ordering::SeqCst);
    drop(state.stdin.lock().unwrap().take());
    let Some(mut child) = state.child.lock().unwrap().take() else {
        return;
    };
    for _ in 0..100 {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let mut kill = hidden(Command::new("taskkill"));
    let _ = kill
        .args(["/T", "/F", "/PID", &child.id().to_string()])
        .status();
    let _ = child.kill();
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(Backend::default())
        .setup(|app| {
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Cloud Delivery")
                    .inner_size(1440.0, 900.0)
                    .min_inner_size(1000.0, 640.0)
                    .initialization_script(LINKS)
                    .on_navigation(|url| {
                        if is_local(url) {
                            return true;
                        }
                        open_in_browser(url);
                        false
                    })
                    .build()?;
            if let Err(message) = start_backend(app.handle(), window.clone()) {
                show_error(&window, &message);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Cloud Delivery failed to start");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_backend(handle);
        }
    });
}
