//! JavaScript-facing adapter for the native ModiPDFy core.

use wasm_bindgen::prelude::*;

/// Return the application version for display in the browser.
#[wasm_bindgen]
pub fn get_version() -> String {
    format!("ModiPDFy {}", modipdfy_core::VERSION)
}

#[cfg(test)]
mod tests {
    use super::get_version;

    #[test]
    fn exposes_the_application_version() {
        assert_eq!(get_version(), "ModiPDFy 0.1.0");
    }
}
