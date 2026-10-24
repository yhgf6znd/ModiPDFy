//! Native PDF document engine and domain primitives for ModiPDFy.
//!
//! PDF parsing and serialization deliberately live here, while browser integration remains
//! in the separate WASM adapter. The public API accepts byte slices and has no filesystem or
//! browser dependency.

mod annotation;
mod document;
mod error;
mod inspect;
mod metadata;
mod page;
mod serialization;

/// The application version shared by native code and the browser adapter.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub use annotation::{
    Annotation, AnnotationContent, AnnotationId, AnnotationStyle, AnnotationType,
    HighlightAnnotation, InkAnnotation, MAX_ANNOTATION_TEXT_BYTES, MAX_HIGHLIGHT_QUADS,
    MAX_INK_POINTS, PdfColor, PdfPoint, PdfQuad, SignatureAnnotation, SignatureStroke,
    TextAnnotation,
};
pub use document::{
    DEFAULT_MAX_DECOMPRESSED_STREAM_BYTES, DEFAULT_MAX_INPUT_BYTES, DocumentLoadOptions,
    PdfDocument,
};
pub use error::{PdfError, PdfResult};
pub use inspect::{PdfObjectId, PdfObjectInfo, PdfObjectKind};
pub use metadata::{DocumentMetadata, PdfWarning};
pub use page::{PageDimensions, PageInfo, PdfRectangle};

#[cfg(test)]
mod tests {
    use super::VERSION;

    #[test]
    fn version_is_non_empty() {
        assert!(!VERSION.is_empty());
    }
}
