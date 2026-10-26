//! Installed font families, for the font picker.

use std::collections::BTreeSet;
use std::sync::OnceLock;

static FAMILIES: OnceLock<Vec<String>> = OnceLock::new();

/// Family names of the installed fonts, sorted. Scanned once, on first use.
pub fn system_families() -> Vec<String> {
    FAMILIES.get_or_init(scan).clone()
}

fn scan() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let names: BTreeSet<String> = db
        .faces()
        .filter_map(|face| {
            face.families
                .first()
                .map(|(name, _)| name.trim().to_string())
        })
        // macOS hides its private UI fonts behind a leading dot.
        .filter(|name| !name.is_empty() && !name.starts_with('.'))
        .collect();
    let mut families: Vec<String> = names.into_iter().collect();
    families.sort_by_key(|name| name.to_lowercase());
    families
}
