//! JavaScript-facing adapter for the native ModiPDFy core.

use js_sys::{Array, Object, Reflect};
use modipdfy_core::{
    Annotation, AnnotationContent, AnnotationId, AnnotationStyle, HighlightAnnotation,
    InkAnnotation, MAX_HIGHLIGHT_QUADS, MAX_INK_POINTS, PageInfo, PdfColor, PdfDocument, PdfError,
    PdfPoint, PdfQuad, PdfRectangle, TextAnnotation,
};
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
    /// The generated binding transfers the typed-array bytes into Rust-owned memory. The core
    /// takes ownership of that buffer so it can preserve the original source bytes without
    /// an additional application-level copy.
    #[wasm_bindgen(js_name = open)]
    pub fn open(bytes: Vec<u8>) -> Result<ModiPdfDocument, JsValue> {
        let document = PdfDocument::from_owned_bytes(bytes).map_err(pdf_error)?;
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

    /// Add a native FreeText annotation from canonical PDF-space values.
    #[wasm_bindgen(js_name = addTextAnnotation)]
    #[allow(clippy::too_many_arguments)]
    pub fn add_text_annotation(
        &mut self,
        editor_id: String,
        page_index: u32,
        position_x: f64,
        position_y: f64,
        bounds_left: f64,
        bounds_bottom: f64,
        bounds_right: f64,
        bounds_top: f64,
        text: String,
        color_red: f64,
        color_green: f64,
        color_blue: f64,
        opacity: f64,
        stroke_width: f64,
        font_size: f64,
    ) -> Result<String, JsValue> {
        let annotation = TextAnnotation {
            editor_id: AnnotationId::new(editor_id).map_err(pdf_error)?,
            page_index: page_index as usize,
            position: PdfPoint { x: position_x, y: position_y },
            bounds: PdfRectangle {
                left: bounds_left,
                bottom: bounds_bottom,
                right: bounds_right,
                top: bounds_top,
            },
            style: wire_style(color_red, color_green, color_blue, opacity, stroke_width, font_size),
            text,
        };
        let id = self.document_mut()?.add_text_annotation(annotation).map_err(pdf_error)?;
        Ok(id.to_string())
    }

    /// Add a native Ink annotation. `paths` is an array of point objects.
    #[wasm_bindgen(js_name = addInkAnnotation)]
    #[allow(clippy::too_many_arguments)]
    pub fn add_ink_annotation(
        &mut self,
        editor_id: String,
        page_index: u32,
        position_x: f64,
        position_y: f64,
        bounds_left: f64,
        bounds_bottom: f64,
        bounds_right: f64,
        bounds_top: f64,
        paths: JsValue,
        color_red: f64,
        color_green: f64,
        color_blue: f64,
        opacity: f64,
        stroke_width: f64,
        font_size: f64,
    ) -> Result<String, JsValue> {
        let paths = parse_paths(&paths)?;
        let annotation = InkAnnotation {
            editor_id: AnnotationId::new(editor_id).map_err(pdf_error)?,
            page_index: page_index as usize,
            position: PdfPoint { x: position_x, y: position_y },
            bounds: PdfRectangle {
                left: bounds_left,
                bottom: bounds_bottom,
                right: bounds_right,
                top: bounds_top,
            },
            style: wire_style(color_red, color_green, color_blue, opacity, stroke_width, font_size),
            paths,
        };
        let id = self.document_mut()?.add_ink_annotation(annotation).map_err(pdf_error)?;
        Ok(id.to_string())
    }

    /// Add a visual handwritten signature as a native PDF Ink annotation.
    #[wasm_bindgen(js_name = addSignatureAnnotation)]
    #[allow(clippy::too_many_arguments)]
    pub fn add_signature_annotation(
        &mut self,
        editor_id: String,
        page_index: u32,
        position_x: f64,
        position_y: f64,
        bounds_left: f64,
        bounds_bottom: f64,
        bounds_right: f64,
        bounds_top: f64,
        paths: JsValue,
        color_red: f64,
        color_green: f64,
        color_blue: f64,
        opacity: f64,
        stroke_width: f64,
        font_size: f64,
    ) -> Result<String, JsValue> {
        let paths = parse_paths(&paths)?;
        let annotation = InkAnnotation {
            editor_id: AnnotationId::new(editor_id).map_err(pdf_error)?,
            page_index: page_index as usize,
            position: PdfPoint { x: position_x, y: position_y },
            bounds: PdfRectangle {
                left: bounds_left,
                bottom: bounds_bottom,
                right: bounds_right,
                top: bounds_top,
            },
            style: wire_style(color_red, color_green, color_blue, opacity, stroke_width, font_size),
            paths,
        };
        let id = self.document_mut()?.add_signature_annotation(annotation).map_err(pdf_error)?;
        Ok(id.to_string())
    }

    /// Add a native Highlight annotation. `quads` is an array of quad objects.
    #[wasm_bindgen(js_name = addHighlightAnnotation)]
    #[allow(clippy::too_many_arguments)]
    pub fn add_highlight_annotation(
        &mut self,
        editor_id: String,
        page_index: u32,
        position_x: f64,
        position_y: f64,
        bounds_left: f64,
        bounds_bottom: f64,
        bounds_right: f64,
        bounds_top: f64,
        quads: JsValue,
        color_red: f64,
        color_green: f64,
        color_blue: f64,
        opacity: f64,
        stroke_width: f64,
        font_size: f64,
    ) -> Result<String, JsValue> {
        let quads = parse_quads(&quads)?;
        let annotation = HighlightAnnotation {
            editor_id: AnnotationId::new(editor_id).map_err(pdf_error)?,
            page_index: page_index as usize,
            position: PdfPoint { x: position_x, y: position_y },
            bounds: PdfRectangle {
                left: bounds_left,
                bottom: bounds_bottom,
                right: bounds_right,
                top: bounds_top,
            },
            style: wire_style(color_red, color_green, color_blue, opacity, stroke_width, font_size),
            quads,
        };
        let id = self.document_mut()?.add_highlight_annotation(annotation).map_err(pdf_error)?;
        Ok(id.to_string())
    }

    /// Remove a supported annotation by its stable editor ID.
    #[wasm_bindgen(js_name = removeAnnotation)]
    pub fn remove_annotation(&mut self, editor_id: String) -> Result<(), JsValue> {
        let id = AnnotationId::new(editor_id).map_err(pdf_error)?;
        self.document_mut()?.remove_annotation(&id).map_err(pdf_error)
    }

    /// Return supported annotations as plain JavaScript objects.
    #[wasm_bindgen(js_name = listAnnotations)]
    pub fn list_annotations(&self) -> Result<JsValue, JsValue> {
        let annotations = self.document()?.list_annotations().map_err(pdf_error)?;
        let result = Array::new();
        for annotation in &annotations {
            result.push(&annotation_js(annotation)?);
        }
        Ok(result.into())
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

fn invalid_annotation(message: &str) -> JsValue {
    structured_error("invalid_annotation", message, true)
}

fn number_property(value: &JsValue, key: &str) -> Result<f64, JsValue> {
    Reflect::get(value, &JsValue::from_str(key))
        .map_err(|_| invalid_annotation("annotation coordinate is unreadable"))?
        .as_f64()
        .filter(|number| number.is_finite())
        .ok_or_else(|| invalid_annotation("annotation coordinate must be finite"))
}

fn point_from_js(value: &JsValue) -> Result<PdfPoint, JsValue> {
    Ok(PdfPoint { x: number_property(value, "x")?, y: number_property(value, "y")? })
}

fn parse_paths(value: &JsValue) -> Result<Vec<Vec<PdfPoint>>, JsValue> {
    if !Array::is_array(value) {
        return Err(invalid_annotation("ink paths must be an array"));
    }
    let paths = Array::from(value);
    if paths.length() > MAX_INK_POINTS as u32 {
        return Err(invalid_annotation("ink point limit exceeded"));
    }
    let mut result = Vec::with_capacity(paths.length() as usize);
    let mut point_count = 0usize;
    for path in paths.iter() {
        if !Array::is_array(&path) {
            return Err(invalid_annotation("each ink path must be an array"));
        }
        let path = Array::from(&path);
        if path.length() > MAX_INK_POINTS as u32 {
            return Err(invalid_annotation("ink point limit exceeded"));
        }
        point_count = point_count.saturating_add(path.length() as usize);
        if point_count > MAX_INK_POINTS {
            return Err(invalid_annotation("ink point limit exceeded"));
        }
        result.push(path.iter().map(|point| point_from_js(&point)).collect::<Result<_, _>>()?);
    }
    Ok(result)
}

fn parse_quads(value: &JsValue) -> Result<Vec<PdfQuad>, JsValue> {
    if !Array::is_array(value) {
        return Err(invalid_annotation("highlight quads must be an array"));
    }
    let quads = Array::from(value);
    if quads.length() > MAX_HIGHLIGHT_QUADS as u32 {
        return Err(invalid_annotation("highlight quad limit exceeded"));
    }
    quads
        .iter()
        .map(|quad| {
            let property = |key| {
                Reflect::get(&quad, &JsValue::from_str(key))
                    .map_err(|_| invalid_annotation("highlight quad is unreadable"))
            };
            Ok(PdfQuad {
                top_left: point_from_js(&property("topLeft")?)?,
                top_right: point_from_js(&property("topRight")?)?,
                bottom_left: point_from_js(&property("bottomLeft")?)?,
                bottom_right: point_from_js(&property("bottomRight")?)?,
            })
        })
        .collect()
}

fn wire_style(
    color_red: f64,
    color_green: f64,
    color_blue: f64,
    opacity: f64,
    stroke_width: f64,
    font_size: f64,
) -> AnnotationStyle {
    AnnotationStyle {
        color: PdfColor { red: color_red, green: color_green, blue: color_blue },
        opacity,
        stroke_width,
        font_size,
    }
}

fn set_property(object: &Object, key: &str, value: &JsValue) -> Result<(), JsValue> {
    Reflect::set(object, &JsValue::from_str(key), value)
        .map(|_| ())
        .map_err(|_| invalid_annotation("could not build annotation response"))
}

fn point_js(point: PdfPoint) -> Result<JsValue, JsValue> {
    let object = Object::new();
    set_property(&object, "x", &JsValue::from_f64(point.x))?;
    set_property(&object, "y", &JsValue::from_f64(point.y))?;
    Ok(object.into())
}

fn rect_js(rect: PdfRectangle) -> Result<JsValue, JsValue> {
    let object = Object::new();
    set_property(&object, "left", &JsValue::from_f64(rect.left))?;
    set_property(&object, "bottom", &JsValue::from_f64(rect.bottom))?;
    set_property(&object, "right", &JsValue::from_f64(rect.right))?;
    set_property(&object, "top", &JsValue::from_f64(rect.top))?;
    Ok(object.into())
}

fn style_js(style: AnnotationStyle) -> Result<JsValue, JsValue> {
    let color = Object::new();
    set_property(&color, "red", &JsValue::from_f64(style.color.red))?;
    set_property(&color, "green", &JsValue::from_f64(style.color.green))?;
    set_property(&color, "blue", &JsValue::from_f64(style.color.blue))?;
    let object = Object::new();
    let color_value: JsValue = color.into();
    set_property(&object, "color", &color_value)?;
    set_property(&object, "opacity", &JsValue::from_f64(style.opacity))?;
    set_property(&object, "strokeWidth", &JsValue::from_f64(style.stroke_width))?;
    set_property(&object, "fontSize", &JsValue::from_f64(style.font_size))?;
    Ok(object.into())
}

fn annotation_js(annotation: &Annotation) -> Result<JsValue, JsValue> {
    let object = Object::new();
    set_property(&object, "editorId", &JsValue::from_str(annotation.editor_id.as_str()))?;
    set_property(&object, "pageIndex", &JsValue::from_f64(annotation.page_index as f64))?;
    let annotation_type = match annotation.annotation_type {
        modipdfy_core::AnnotationType::Text => "Text",
        modipdfy_core::AnnotationType::Ink => "Ink",
        modipdfy_core::AnnotationType::Signature => "Signature",
        modipdfy_core::AnnotationType::Highlight => "Highlight",
    };
    set_property(&object, "annotationType", &JsValue::from_str(annotation_type))?;
    let position = point_js(annotation.position)?;
    let bounds = rect_js(annotation.bounds)?;
    let style = style_js(annotation.style)?;
    set_property(&object, "position", &position)?;
    set_property(&object, "bounds", &bounds)?;
    set_property(&object, "style", &style)?;
    let content = Object::new();
    match &annotation.content {
        AnnotationContent::Text { text } => {
            set_property(&content, "text", &JsValue::from_str(text))?;
        }
        AnnotationContent::Ink { paths } | AnnotationContent::Signature { paths } => {
            let path_array = Array::new();
            for path in paths {
                let points = Array::new();
                for point in path {
                    points.push(&point_js(*point)?);
                }
                path_array.push(&points);
            }
            let value: JsValue = path_array.into();
            set_property(&content, "paths", &value)?;
        }
        AnnotationContent::Highlight { quads } => {
            let quad_array = Array::new();
            for quad in quads {
                let item = Object::new();
                let top_left = point_js(quad.top_left)?;
                let top_right = point_js(quad.top_right)?;
                let bottom_left = point_js(quad.bottom_left)?;
                let bottom_right = point_js(quad.bottom_right)?;
                set_property(&item, "topLeft", &top_left)?;
                set_property(&item, "topRight", &top_right)?;
                set_property(&item, "bottomLeft", &bottom_left)?;
                set_property(&item, "bottomRight", &bottom_right)?;
                quad_array.push(&item);
            }
            let value: JsValue = quad_array.into();
            set_property(&content, "quads", &value)?;
        }
    }
    let content_value: JsValue = content.into();
    set_property(&object, "content", &content_value)?;
    Ok(object.into())
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
