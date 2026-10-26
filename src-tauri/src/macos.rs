//! The macOS menu bar: the usual menus, except Quit, which goes through the
//! page so the last changes are saved before the app closes. Labels follow the
//! system language, like the rest of the menu bar.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

use crate::commands;
use crate::text::{self, Lang};

const QUIT: &str = "app-quit";

struct Labels {
    about: &'static str,
    services: &'static str,
    hide: &'static str,
    hide_others: &'static str,
    show_all: &'static str,
    quit: &'static str,
    edit: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    window: &'static str,
    minimize: &'static str,
    close: &'static str,
}

fn labels(lang: Lang) -> Labels {
    match lang {
        Lang::En => Labels {
            about: "About Appunto",
            services: "Services",
            hide: "Hide Appunto",
            hide_others: "Hide Others",
            show_all: "Show All",
            quit: "Quit Appunto",
            edit: "Edit",
            undo: "Undo",
            redo: "Redo",
            cut: "Cut",
            copy: "Copy",
            paste: "Paste",
            select_all: "Select All",
            window: "Window",
            minimize: "Minimize",
            close: "Close Window",
        },
        Lang::It => Labels {
            about: "Informazioni su Appunto",
            services: "Servizi",
            hide: "Nascondi Appunto",
            hide_others: "Nascondi altre",
            show_all: "Mostra tutte",
            quit: "Esci da Appunto",
            edit: "Composizione",
            undo: "Annulla",
            redo: "Ripeti",
            cut: "Taglia",
            copy: "Copia",
            paste: "Incolla",
            select_all: "Seleziona tutto",
            window: "Finestra",
            minimize: "Contrai",
            close: "Chiudi finestra",
        },
    }
}

pub fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let t = labels(Lang::resolve("auto", &text::system_locale()));
    let quit = MenuItem::with_id(app, QUIT, t.quit, true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        app,
        "Appunto",
        true,
        &[
            &PredefinedMenuItem::about(app, Some(t.about), None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some(t.services))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(t.hide))?,
            &PredefinedMenuItem::hide_others(app, Some(t.hide_others))?,
            &PredefinedMenuItem::show_all(app, Some(t.show_all))?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    // Without an Edit menu, ⌘C and ⌘V do nothing in the page.
    let edit = Submenu::with_items(
        app,
        t.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(t.undo))?,
            &PredefinedMenuItem::redo(app, Some(t.redo))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(t.cut))?,
            &PredefinedMenuItem::copy(app, Some(t.copy))?,
            &PredefinedMenuItem::paste(app, Some(t.paste))?,
            &PredefinedMenuItem::select_all(app, Some(t.select_all))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        t.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(t.minimize))?,
            &PredefinedMenuItem::close_window(app, Some(t.close))?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &window])
}

pub fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    if event.id().as_ref() == QUIT {
        commands::request_quit(app);
    }
}
