//! JavaScript-facing adapter for the native ModiPDFy core.

use js_sys::{Object, Reflect};
use modipdfy_core::{PageInfo, PdfDocument, PdfError};
use wasm_bindgen::prelude::*;

/// Return the application version for display in the browser.
#[wasm_bindgen]
pub fn get_version() -> String {
    format!("ModiPDFy {}", modipdfy_core::VERSION)
}

/// A browser-owned handle to one native PDF document.
///
/// JavaScript should call [`ModiPdfDocument::dispose`] when the document is no longer needed.
/// Dropping the JavaScript object also releases the Rust document, but explicit disposal makes
/// the resource lifetime deterministic for long-running browser sessions.
#[wasm_bindgen]
pub struct ModiPdfDocument {
    inner: Option<PdfDocument>,
}

/// Page information returned by [`ModiPdfDocument::page_info`].
#[wasm_bindgen]
pub struct ModiPdfPageInfo {
    page_index: u32,
    width: f64,
    height: f64,
    rotation_degrees: i32,
    media_left: f64,
    media_bottom: f64,
    media_right: f64,
    media_top: f64,
    crop_left: f64,
    crop_bottom: f64,
    crop_right: f64,
    crop_top: f64,
}

#[wasm_bindgen]
impl ModiPdfDocument {
    /// Open a PDF from a JavaScript `Uint8Array`.
    ///
    /// The generated binding copies the typed-array bytes once into Rust-owned memory. The core
    /// then takes ownership of that buffer so it can preserve the original source bytes without
    /// another copy.
    #[wasm_bindgen(js_name = open)]
    pub fn open(bytes: &[u8]) -> Result<ModiPdfDocument, JsValue> {
        let document = PdfDocument::from_owned_bytes(bytes.to_vec()).map_err(pdf_error)?;
        Ok(Self { inner: Some(document) })
    }

    /// Return the zero-based page count for this document.
    #[wasm_bindgen(js_name = pageCount)]
    pub fn page_count(&self) -> Result<u32, JsValue> {
        let document = self.document()?;
        u32::try_from(document.page_count()).map_err(|_| {
            structured_error(
                "page_count_overflow",
                "The document contains more pages than the JavaScript API can represent.",
                false,
            )
        })
    }

    /// Return page dimensions and PDF page boxes for a zero-based page index.
    #[wasm_bindgen(js_name = pageInfo)]
    pub fn page_info(&self, page_index: u32) -> Result<ModiPdfPageInfo, JsValue> {
        let document = self.document()?;
        let info = document.page_info(page_index as usize).map_err(pdf_error)?;
        Ok(ModiPdfPageInfo::from_core(page_index, info))
    }

    /// Save the current document to a new JavaScript `Uint8Array`.
    #[wasm_bindgen]
    pub fn save(&mut self) -> Result<Vec<u8>, JsValue> {
        let document = self.document_mut()?;
        document.save_to_bytes().map_err(pdf_error)
    }

    /// Release the native document immediately. Calling this method more than once is safe.
    #[wasm_bindgen]
    pub fn dispose(&mut self) {
        self.inner.take();
    }
}

#[wasm_bindgen]
impl ModiPdfPageInfo {
    /// Zero-based page index.
    #[wasm_bindgen(getter, js_name = pageIndex)]
    pub fn page_index(&self) -> u32 {
        self.page_index
    }

    /// Effective crop-box width in PDF points.
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> f64 {
        self.width
    }

    /// Effective crop-box height in PDF points.
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> f64 {
        self.height
    }

    /// Page rotation normalized to 0..360 degrees.
    #[wasm_bindgen(getter, js_name = rotationDegrees)]
    pub fn rotation_degrees(&self) -> i32 {
        self.rotation_degrees
    }

    /// Media-box left coordinate in PDF points.
    #[wasm_bindgen(getter, js_name = mediaLeft)]
    pub fn media_left(&self) -> f64 {
        self.media_left
    }

    /// Media-box bottom coordinate in PDF points.
    #[wasm_bindgen(getter, js_name = mediaBottom)]
    pub fn media_bottom(&self) -> f64 {
        self.media_bottom
    }

    /// Media-box right coordinate in PDF points.
    #[wasm_bindgen(getter, js_name = mediaRight)]
    pub fn media_right(&self) -> f64 {
        self.media_right
    }

    /// Media-box top coordinate in PDF points.
    #[wasm_bindgen(getter, js_name = mediaTop)]
    pub fn media_top(&self) -> f64 {
        self.media_top
    }

    /// Crop-box left coordinate in PDF points.
    #[wasm_bindgen(getter, js_name = cropLeft)]
    pub fn crop_left(&self) -> f64 {
        self.crop_left
    }

    /// Crop-box bottom coordinate in PDF points.
    #[wasm_bindgen(getter, js_name = cropBottom)]
    pub fn crop_bottom(&self) -> f64 {
        self.crop_bottom
    }

    /// Crop-box right coordinate in PDF points.
    #[wasm_bindgen(getter, js_name = cropRight)]
    pub fn crop_right(&self) -> f64 {
        self.crop_right
    }

    /// Crop-box top coordinate in PDF points.
    #[wasm_bindgen(getter, js_name = cropTop)]
    pub fn crop_top(&self) -> f64 {
        self.crop_top
    }
}

impl ModiPdfDocument {
    fn document(&self) -> Result<&PdfDocument, JsValue> {
        self.inner.as_ref().ok_or_else(disposed_error)
    }

    fn document_mut(&mut self) -> Result<&mut PdfDocument, JsValue> {
        self.inner.as_mut().ok_or_else(disposed_error)
    }
}

impl ModiPdfPageInfo {
    fn from_core(page_index: u32, info: PageInfo) -> Self {
        let media = info.dimensions.media_box;
        let crop = info.dimensions.crop_box;
        Self {
            page_index,
            width: info.dimensions.width,
            height: info.dimensions.height,
            rotation_degrees: info.dimensions.rotation_degrees,
            media_left: media.left,
            media_bottom: media.bottom,
            media_right: media.right,
            media_top: media.top,
            crop_left: crop.left,
            crop_bottom: crop.bottom,
            crop_right: crop.right,
            crop_top: crop.top,
        }
    }
}

fn disposed_error() -> JsValue {
    structured_error("document_disposed", "The PDF document has been disposed.", true)
}

fn pdf_error(error: PdfError) -> JsValue {
    let (code, recoverable) = match &error {
        PdfError::EmptyInput | PdfError::InputTooLarge { .. } => ("invalid_input", true),
        PdfError::MalformedPdf { .. } | PdfError::ParserPanicked => ("malformed_pdf", false),
        PdfError::PageIndexOutOfRange { .. } => ("invalid_page_index", true),
        PdfError::MissingPageAttribute { .. }
        | PdfError::InvalidPageAttribute { .. }
        | PdfError::InvalidPageTree { .. } => ("invalid_page_info", false),
        PdfError::ObjectNotFound { .. } | PdfError::ObjectInspection { .. } => {
            ("object_inspection_failed", false)
        }
        PdfError::Serialization { .. } => ("serialization_failed", false),
        PdfError::InvalidAnnotationId { .. }
        | PdfError::InvalidAnnotationGeometry { .. }
        | PdfError::InvalidAnnotationStyle
        | PdfError::InvalidAnnotationContent { .. }
        | PdfError::DuplicateAnnotationId { .. }
        | PdfError::AnnotationNotFound { .. } => ("invalid_annotation", true),
        PdfError::AnnotationParse { .. } => ("annotation_parse_failed", false),
        PdfError::SignedDocument { .. } => ("signed_document", false),
    };
    structured_error(code, &error.to_string(), recoverable)
}

fn structured_error(code: &str, message: &str, recoverable: bool) -> JsValue {
    let error = Object::new();
    let _ = Reflect::set(&error, &JsValue::from_str("code"), &JsValue::from_str(code));
    let _ = Reflect::set(&error, &JsValue::from_str("message"), &JsValue::from_str(message));
    let _ =
        Reflect::set(&error, &JsValue::from_str("recoverable"), &JsValue::from_bool(recoverable));
    error.into()
}

#[cfg(test)]
mod tests {
    use super::get_version;

    #[test]
    fn exposes_the_application_version() {
        assert_eq!(get_version(), "ModiPDFy 0.1.0");
    }
}
