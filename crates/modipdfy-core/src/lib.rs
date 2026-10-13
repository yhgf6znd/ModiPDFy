//! PDF-independent domain primitives for ModiPDFy.
//!
//! PDF parsing and browser integration deliberately live outside this crate. Keeping the
//! domain layer native-testable gives the future PDF adapter and WASM adapter one stable,
//! platform-independent contract.

/// The application version shared by native code and the browser adapter.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::VERSION;

    #[test]
    fn version_is_non_empty() {
        assert!(!VERSION.is_empty());
    }
}
