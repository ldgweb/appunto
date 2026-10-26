//! The tray (menu bar) icon: the way back to the board when it is hidden.

use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::settings::SettingsPatch;
use crate::text::{self, Lang};
use crate::{autostart, commands, lock, window, AppState};

pub struct Tray {
    _icon: TrayIcon,
    show: MenuItem<Wry>,
    on_top: CheckMenuItem<Wry>,
    launch_at_login: CheckMenuItem<Wry>,
    folder: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

impl Tray {
    pub fn build(
        app: &AppHandle,
        lang: Lang,
        on_top: bool,
        launch_at_login: bool,
        autostart_available: bool,
    ) -> tauri::Result<Self> {
        let text = text::tray(lang);
        let show = MenuItem::with_id(app, "show", text.show, true, None::<&str>)?;
        let on_top = CheckMenuItem::with_id(
            app,
            "on-top",
            text.always_on_top,
            true,
            on_top,
            None::<&str>,
        )?;
        let launch_at_login = CheckMenuItem::with_id(
            app,
            "autostart",
            text.autostart,
            autostart_available,
            launch_at_login,
            None::<&str>,
        )?;
        let folder = MenuItem::with_id(app, "folder", text.open_folder, true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", text.quit, true, None::<&str>)?;
        let menu = Menu::with_items(
            app,
            &[
                &show,
                &PredefinedMenuItem::separator(app)?,
                &on_top,
                &launch_at_login,
                &PredefinedMenuItem::separator(app)?,
                &folder,
                &quit,
            ],
        )?;

        let builder = TrayIconBuilder::with_id("main")
            .tooltip("Appunto")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(on_menu_event)
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    window::show(tray.app_handle());
                }
            });
        let icon = with_icon(app, builder).build(app)?;

        Ok(Self {
            _icon: icon,
            show,
            on_top,
            launch_at_login,
            folder,
            quit,
        })
    }

    /// Puts the check marks back in line with the real state.
    pub fn sync(&self, on_top: bool, launch_at_login: bool) {
        let _ = self.on_top.set_checked(on_top);
        let _ = self.launch_at_login.set_checked(launch_at_login);
    }

    pub fn relabel(&self, lang: Lang) {
        let text = text::tray(lang);
        let _ = self.show.set_text(text.show);
        let _ = self.on_top.set_text(text.always_on_top);
        let _ = self.launch_at_login.set_text(text.autostart);
        let _ = self.folder.set_text(text.open_folder);
        let _ = self.quit.set_text(text.quit);
    }
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "show" => window::show(app),
        "on-top" => {
            let on_top = lock(&app.state::<AppState>().settings).always_on_top;
            apply(
                app,
                SettingsPatch {
                    always_on_top: Some(!on_top),
                    ..SettingsPatch::default()
                },
            );
        }
        "autostart" => apply(
            app,
            SettingsPatch {
                autostart: Some(!autostart::enabled(app)),
                ..SettingsPatch::default()
            },
        ),
        "folder" => {
            let _ = commands::open_data_folder(app);
        }
        "quit" => commands::request_quit(app),
        _ => {}
    }
}

/// The menu flips a check mark as soon as it is clicked; when the change
/// fails, the mark goes back to the real state.
fn apply(app: &AppHandle, patch: SettingsPatch) {
    if commands::apply_patch(app, patch, true).is_ok() {
        return;
    }
    let state = app.state::<AppState>();
    let on_top = lock(&state.settings).always_on_top;
    let tray = lock(&state.tray);
    if let Some(tray) = tray.as_ref() {
        tray.sync(on_top, autostart::enabled(app));
    }
}

/// macOS wants a monochrome "template" image in the menu bar; elsewhere the
/// app icon reads best.
#[cfg(target_os = "macos")]
fn with_icon(_app: &AppHandle, builder: TrayIconBuilder<Wry>) -> TrayIconBuilder<Wry> {
    builder
        .icon(tauri::include_image!("./icons/tray-template.png"))
        .icon_as_template(true)
}

#[cfg(not(target_os = "macos"))]
fn with_icon(app: &AppHandle, builder: TrayIconBuilder<Wry>) -> TrayIconBuilder<Wry> {
    match app.default_window_icon() {
        Some(icon) => builder.icon(icon.clone()),
        None => builder,
    }
}
