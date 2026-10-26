//! The language of the native side and the tray menu strings. The macOS menu
//! bar keeps its own labels in `macos.rs`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    En,
    It,
}

impl Lang {
    /// `preference` is "auto", "en" or "it"; "auto" follows the system locale.
    pub fn resolve(preference: &str, system_locale: &str) -> Self {
        match preference {
            "it" => Self::It,
            "en" => Self::En,
            _ if system_locale.to_ascii_lowercase().starts_with("it") => Self::It,
            _ => Self::En,
        }
    }
}

pub struct TrayText {
    pub show: &'static str,
    pub always_on_top: &'static str,
    pub autostart: &'static str,
    pub open_folder: &'static str,
    pub quit: &'static str,
}

pub fn tray(lang: Lang) -> TrayText {
    match lang {
        Lang::En => TrayText {
            show: "Show board",
            always_on_top: "Always on top",
            autostart: "Start with the system",
            open_folder: "Open data folder",
            quit: "Quit Appunto",
        },
        Lang::It => TrayText {
            show: "Mostra la lavagna",
            always_on_top: "Sempre in primo piano",
            autostart: "Avvia con il sistema",
            open_folder: "Apri la cartella dei dati",
            quit: "Esci da Appunto",
        },
    }
}

pub fn system_locale() -> String {
    sys_locale::get_locale().unwrap_or_else(|| "en".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_choice_wins_over_the_system() {
        assert_eq!(Lang::resolve("en", "it-IT"), Lang::En);
        assert_eq!(Lang::resolve("it", "en-US"), Lang::It);
    }

    #[test]
    fn auto_follows_the_system_locale() {
        assert_eq!(Lang::resolve("auto", "it-IT"), Lang::It);
        assert_eq!(Lang::resolve("auto", "IT"), Lang::It);
        assert_eq!(Lang::resolve("auto", "de-DE"), Lang::En);
        assert_eq!(Lang::resolve("auto", ""), Lang::En);
    }
}
