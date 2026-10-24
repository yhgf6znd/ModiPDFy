use std::collections::HashSet;

use lopdf::{
    Dictionary, Document, Object, ObjectId, Stream, StringFormat, decode_text_string, dictionary,
};

use crate::{PageInfo, PdfError, PdfRectangle, PdfResult};

/// Maximum encoded text accepted in one FreeText annotation.
pub const MAX_ANNOTATION_TEXT_BYTES: usize = 64 * 1024;
/// Maximum number of points accepted in one ink annotation.
pub const MAX_INK_POINTS: usize = 100_000;
/// Maximum number of highlight quadrilaterals accepted in one annotation.
pub const MAX_HIGHLIGHT_QUADS: usize = 10_000;
const GEOMETRY_EPSILON: f64 = 1e-7;

/// Stable editor identifier stored in the PDF annotation's `/NM` entry.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AnnotationId(String);

impl AnnotationId {
    /// Create an identifier suitable for a PDF name string.
    pub fn new(value: impl Into<String>) -> PdfResult<Self> {
        let value = value.into();
        if value.is_empty() || value.len() > 128 || !value.bytes().all(is_editor_id_byte) {
            return Err(PdfError::InvalidAnnotationId { value });
        }
        Ok(Self(value))
    }

    /// Return the identifier as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl AsRef<str> for AnnotationId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl std::fmt::Display for AnnotationId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

fn is_editor_id_byte(byte: u8) -> bool {
    byte.is_ascii_graphic() && !matches!(byte, b'(' | b')' | b'\\')
}

/// A point in canonical PDF user space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PdfPoint {
    pub x: f64,
    pub y: f64,
}

impl PdfPoint {
    fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

/// An ordered quadrilateral in PDF user space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PdfQuad {
    pub top_left: PdfPoint,
    pub top_right: PdfPoint,
    pub bottom_left: PdfPoint,
    pub bottom_right: PdfPoint,
}

impl PdfQuad {
    fn points(self) -> [PdfPoint; 4] {
        [self.top_left, self.top_right, self.bottom_left, self.bottom_right]
    }
}

/// RGB color with components in the inclusive range 0..=1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PdfColor {
    pub red: f64,
    pub green: f64,
    pub blue: f64,
}

impl PdfColor {
    pub const BLACK: Self = Self { red: 0.0, green: 0.0, blue: 0.0 };
    pub const YELLOW: Self = Self { red: 1.0, green: 1.0, blue: 0.0 };

    fn is_valid(self) -> bool {
        [self.red, self.green, self.blue]
            .iter()
            .all(|value| value.is_finite() && (0.0..=1.0).contains(value))
    }
}

/// Shared visual properties for the initial annotation types.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnnotationStyle {
    pub color: PdfColor,
    pub opacity: f64,
    pub stroke_width: f64,
    pub font_size: f64,
}

impl Default for AnnotationStyle {
    fn default() -> Self {
        Self { color: PdfColor::BLACK, opacity: 1.0, stroke_width: 2.0, font_size: 12.0 }
    }
}

impl AnnotationStyle {
    fn validate(self) -> PdfResult<()> {
        if !self.color.is_valid()
            || !self.opacity.is_finite()
            || !(0.0..=1.0).contains(&self.opacity)
            || !self.stroke_width.is_finite()
            || !(0.01..=100.0).contains(&self.stroke_width)
            || !self.font_size.is_finite()
            || !(1.0..=200.0).contains(&self.font_size)
        {
            return Err(PdfError::InvalidAnnotationStyle);
        }
        Ok(())
    }
}

/// Text/FreeText annotation input.
#[derive(Debug, Clone, PartialEq)]
pub struct TextAnnotation {
    pub editor_id: AnnotationId,
    pub page_index: usize,
    pub position: PdfPoint,
    pub bounds: PdfRectangle,
    pub style: AnnotationStyle,
    pub text: String,
}

/// Freehand ink annotation input. Each path is an ordered sequence of PDF points.
#[derive(Debug, Clone, PartialEq)]
pub struct InkAnnotation {
    pub editor_id: AnnotationId,
    pub page_index: usize,
    pub position: PdfPoint,
    pub bounds: PdfRectangle,
    pub style: AnnotationStyle,
    pub paths: Vec<Vec<PdfPoint>>,
}

/// Highlight annotation input. Quad points use PDF order: top-left, top-right,
/// bottom-left, bottom-right.
#[derive(Debug, Clone, PartialEq)]
pub struct HighlightAnnotation {
    pub editor_id: AnnotationId,
    pub page_index: usize,
    pub position: PdfPoint,
    pub bounds: PdfRectangle,
    pub style: AnnotationStyle,
    pub quads: Vec<PdfQuad>,
}

/// Supported PDF annotation subtypes exposed by the editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnnotationType {
    Text,
    Ink,
    Highlight,
}

/// Annotation-specific data returned by `list_annotations`.
#[derive(Debug, Clone, PartialEq)]
pub enum AnnotationContent {
    Text { text: String },
    Ink { paths: Vec<Vec<PdfPoint>> },
    Highlight { quads: Vec<PdfQuad> },
}

/// Reusable editor annotation record combining common and type-specific fields.
#[derive(Debug, Clone, PartialEq)]
pub struct Annotation {
    pub editor_id: AnnotationId,
    pub page_index: usize,
    pub annotation_type: AnnotationType,
    pub position: PdfPoint,
    pub bounds: PdfRectangle,
    pub style: AnnotationStyle,
    pub content: AnnotationContent,
}

impl Annotation {
    fn id(&self) -> &AnnotationId {
        &self.editor_id
    }
}

pub(crate) fn validate_text(annotation: &TextAnnotation, page: &PageInfo) -> PdfResult<()> {
    validate_common(
        &annotation.editor_id,
        annotation.page_index,
        annotation.position,
        annotation.bounds,
        annotation.style,
        page,
    )?;
    if annotation.text.is_empty() || annotation.text.len() > MAX_ANNOTATION_TEXT_BYTES {
        return Err(PdfError::InvalidAnnotationContent {
            message: "text must be non-empty and within the size limit".to_string(),
        });
    }
    Ok(())
}

pub(crate) fn validate_ink(annotation: &InkAnnotation, page: &PageInfo) -> PdfResult<()> {
    validate_common(
        &annotation.editor_id,
        annotation.page_index,
        annotation.position,
        annotation.bounds,
        annotation.style,
        page,
    )?;
    let point_count = annotation.paths.iter().map(Vec::len).sum::<usize>();
    if annotation.paths.is_empty()
        || point_count > MAX_INK_POINTS
        || annotation.paths.iter().any(|path| path.len() < 2)
    {
        return Err(PdfError::InvalidAnnotationContent {
            message:
                "ink must contain paths with at least two points and stay within the point limit"
                    .to_string(),
        });
    }
    for path in &annotation.paths {
        for point in path {
            validate_point_in_bounds(*point, annotation.bounds, page)?;
        }
    }
    Ok(())
}

pub(crate) fn validate_highlight(
    annotation: &HighlightAnnotation,
    page: &PageInfo,
) -> PdfResult<()> {
    validate_common(
        &annotation.editor_id,
        annotation.page_index,
        annotation.position,
        annotation.bounds,
        annotation.style,
        page,
    )?;
    if annotation.quads.is_empty() || annotation.quads.len() > MAX_HIGHLIGHT_QUADS {
        return Err(PdfError::InvalidAnnotationContent {
            message: "highlight must contain at least one quadrilateral and stay within the limit"
                .to_string(),
        });
    }
    for quad in &annotation.quads {
        for point in quad.points() {
            validate_point_in_bounds(point, annotation.bounds, page)?;
        }
    }
    Ok(())
}

fn validate_common(
    editor_id: &AnnotationId,
    page_index: usize,
    position: PdfPoint,
    bounds: PdfRectangle,
    style: AnnotationStyle,
    page: &PageInfo,
) -> PdfResult<()> {
    if page_index != page.index {
        return Err(PdfError::PageIndexOutOfRange { index: page_index, page_count: page.index });
    }
    if editor_id.as_str().is_empty() {
        return Err(PdfError::InvalidAnnotationId { value: String::new() });
    }
    if !position.is_finite()
        || !bounds.left.is_finite()
        || !bounds.bottom.is_finite()
        || !bounds.right.is_finite()
        || !bounds.top.is_finite()
        || bounds.left >= bounds.right
        || bounds.bottom >= bounds.top
        || !page_contains_rect(page, bounds)
        || !page_contains_point(page, position)
        || position.x < bounds.left - GEOMETRY_EPSILON
        || position.x > bounds.right + GEOMETRY_EPSILON
        || position.y < bounds.bottom - GEOMETRY_EPSILON
        || position.y > bounds.top + GEOMETRY_EPSILON
    {
        return Err(PdfError::InvalidAnnotationGeometry {
            message: "position and bounds must be finite, ordered, and inside the page crop box"
                .to_string(),
        });
    }
    style.validate()
}

fn page_contains_point(page: &PageInfo, point: PdfPoint) -> bool {
    let crop = page.dimensions.crop_box;
    point.x >= crop.left - GEOMETRY_EPSILON
        && point.x <= crop.right + GEOMETRY_EPSILON
        && point.y >= crop.bottom - GEOMETRY_EPSILON
        && point.y <= crop.top + GEOMETRY_EPSILON
}

fn page_contains_rect(page: &PageInfo, rect: PdfRectangle) -> bool {
    page_contains_point(page, PdfPoint { x: rect.left, y: rect.bottom })
        && page_contains_point(page, PdfPoint { x: rect.right, y: rect.top })
}

fn validate_point_in_bounds(
    point: PdfPoint,
    bounds: PdfRectangle,
    page: &PageInfo,
) -> PdfResult<()> {
    if !point.is_finite()
        || !page_contains_point(page, point)
        || point.x < bounds.left - GEOMETRY_EPSILON
        || point.x > bounds.right + GEOMETRY_EPSILON
        || point.y < bounds.bottom - GEOMETRY_EPSILON
        || point.y > bounds.top + GEOMETRY_EPSILON
    {
        return Err(PdfError::InvalidAnnotationGeometry {
            message: "annotation content lies outside its bounds or page crop box".to_string(),
        });
    }
    Ok(())
}

pub(crate) fn build_text_object(
    document: &mut Document,
    annotation: &TextAnnotation,
    page_id: ObjectId,
) -> Object {
    let font_id = add_standard_font(document);
    let appearance_id = add_text_appearance(document, annotation, font_id);
    let color = annotation.style.color;
    dictionary! {
        "Type" => "Annot",
        "Subtype" => "FreeText",
        "Rect" => rectangle_object(annotation.bounds),
        "Contents" => text_string(&annotation.text),
        "NM" => text_string(annotation.editor_id.as_str()),
        "P" => page_id,
        "F" => 4,
        "C" => color_object(color),
        "CA" => annotation.style.opacity,
        "DA" => Object::string_literal(format!("/F1 {} Tf {} {} {} rg", number(annotation.style.font_size), number(color.red), number(color.green), number(color.blue))),
        "AP" => dictionary! { "N" => appearance_id },
        "BS" => dictionary! { "W" => 0 },
    }
    .into()
}

pub(crate) fn build_ink_object(
    document: &mut Document,
    annotation: &InkAnnotation,
    page_id: ObjectId,
) -> Object {
    let appearance_id = add_ink_appearance(document, annotation);
    dictionary! {
        "Type" => "Annot",
        "Subtype" => "Ink",
        "Rect" => rectangle_object(annotation.bounds),
        "NM" => text_string(annotation.editor_id.as_str()),
        "P" => page_id,
        "F" => 4,
        "C" => color_object(annotation.style.color),
        "CA" => annotation.style.opacity,
        "BS" => dictionary! { "W" => annotation.style.stroke_width },
        "InkList" => annotation.paths.iter().map(|path| Object::Array(path.iter().flat_map(|point| [point.x.into(), point.y.into()]).collect())).collect::<Vec<_>>(),
        "AP" => dictionary! { "N" => appearance_id },
    }
    .into()
}

pub(crate) fn build_highlight_object(
    document: &mut Document,
    annotation: &HighlightAnnotation,
    page_id: ObjectId,
) -> Object {
    let appearance_id = add_highlight_appearance(document, annotation);
    dictionary! {
        "Type" => "Annot",
        "Subtype" => "Highlight",
        "Rect" => rectangle_object(annotation.bounds),
        "NM" => text_string(annotation.editor_id.as_str()),
        "P" => page_id,
        "F" => 4,
        "C" => color_object(annotation.style.color),
        "CA" => annotation.style.opacity,
        "QuadPoints" => annotation.quads.iter().flat_map(|quad| quad.points().into_iter().flat_map(|point| [point.x.into(), point.y.into()])).collect::<Vec<Object>>(),
        "AP" => dictionary! { "N" => appearance_id },
    }
    .into()
}

fn add_standard_font(document: &mut Document) -> ObjectId {
    document.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    })
}

fn add_text_appearance(
    document: &mut Document,
    annotation: &TextAnnotation,
    font_id: ObjectId,
) -> ObjectId {
    let width = annotation.bounds.width();
    let height = annotation.bounds.height();
    let font_size = annotation.style.font_size.min(height.max(1.0) * 0.8);
    let line_height = font_size * 1.2;
    let x = 2.0;
    let mut y = height - font_size - 2.0;
    let graphics_state_id = add_opacity_state(document, annotation.style.opacity);
    let mut content = format!(
        "q /GS1 gs 0 0 {} {} re W n BT /F1 {} Tf {} {} {} rg ",
        number(width),
        number(height),
        number(font_size),
        number(annotation.style.color.red),
        number(annotation.style.color.green),
        number(annotation.style.color.blue)
    );
    for line in annotation.text.lines().take(256) {
        if y < 0.0 {
            break;
        }
        content.push_str(&format!(
            "1 0 0 1 {} {} Tm {} Tj ",
            number(x),
            number(y),
            pdf_literal(line)
        ));
        y -= line_height;
    }
    content.push_str("ET Q");
    let stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "BBox" => vec![0.into(), 0.into(), width.into(), height.into()],
            "Resources" => dictionary! {
                "Font" => dictionary! { "F1" => font_id },
                "ExtGState" => dictionary! { "GS1" => graphics_state_id },
            },
        },
        content.into_bytes(),
    );
    document.add_object(stream)
}

fn add_ink_appearance(document: &mut Document, annotation: &InkAnnotation) -> ObjectId {
    let bounds = annotation.bounds;
    let graphics_state_id = add_opacity_state(document, annotation.style.opacity);
    let mut content = format!(
        "q /GS1 gs {} {} {} RG {} w 1 J 1 j ",
        number(annotation.style.color.red),
        number(annotation.style.color.green),
        number(annotation.style.color.blue),
        number(annotation.style.stroke_width)
    );
    for path in &annotation.paths {
        if let Some(first) = path.first() {
            content.push_str(&format!(
                "{} {} m ",
                number(first.x - bounds.left),
                number(first.y - bounds.bottom)
            ));
            for point in &path[1..] {
                content.push_str(&format!(
                    "{} {} l ",
                    number(point.x - bounds.left),
                    number(point.y - bounds.bottom)
                ));
            }
            content.push_str("S ");
        }
    }
    content.push('Q');
    let stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "BBox" => vec![0.into(), 0.into(), bounds.width().into(), bounds.height().into()],
            "Resources" => dictionary! { "ExtGState" => dictionary! { "GS1" => graphics_state_id } },
        },
        content.into_bytes(),
    );
    document.add_object(stream)
}

fn add_highlight_appearance(document: &mut Document, annotation: &HighlightAnnotation) -> ObjectId {
    let bounds = annotation.bounds;
    let color = annotation.style.color;
    let graphics_state_id = add_opacity_state(document, annotation.style.opacity);
    let mut content = format!(
        "q /GS1 gs {} {} {} rg ",
        number(color.red),
        number(color.green),
        number(color.blue)
    );
    for quad in &annotation.quads {
        let [top_left, top_right, bottom_left, bottom_right] = quad.points();
        content.push_str(&format!(
            "{} {} m {} {} l {} {} l {} {} l h f ",
            number(top_left.x - bounds.left),
            number(top_left.y - bounds.bottom),
            number(top_right.x - bounds.left),
            number(top_right.y - bounds.bottom),
            number(bottom_right.x - bounds.left),
            number(bottom_right.y - bounds.bottom),
            number(bottom_left.x - bounds.left),
            number(bottom_left.y - bounds.bottom)
        ));
    }
    content.push('Q');
    let stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "BBox" => vec![0.into(), 0.into(), bounds.width().into(), bounds.height().into()],
            "Resources" => dictionary! { "ExtGState" => dictionary! { "GS1" => graphics_state_id } },
        },
        content.into_bytes(),
    );
    document.add_object(stream)
}

fn add_opacity_state(document: &mut Document, opacity: f64) -> ObjectId {
    document.add_object(dictionary! {
        "Type" => "ExtGState",
        "ca" => opacity,
        "CA" => opacity,
    })
}

pub(crate) fn parse_annotation(
    document: &Document,
    page_index: usize,
    object_id: Option<ObjectId>,
    dictionary: &Dictionary,
    fallback_index: usize,
) -> PdfResult<Option<Annotation>> {
    let subtype = dictionary.get(b"Subtype").ok().and_then(|object| object.as_name().ok());
    let Some(subtype) = subtype else { return Ok(None) };
    let annotation_type = match subtype {
        b"FreeText" => AnnotationType::Text,
        b"Ink" => AnnotationType::Ink,
        b"Highlight" => AnnotationType::Highlight,
        _ => return Ok(None),
    };
    let bounds = parse_rectangle(dictionary.get(b"Rect").map_err(|_| {
        PdfError::AnnotationParse { message: "annotation is missing /Rect".to_string() }
    })?)?;
    let editor_id = parse_editor_id(document, dictionary, page_index, object_id, fallback_index)?;
    let style = parse_style(document, dictionary, annotation_type)?;
    let (position, content) = match annotation_type {
        AnnotationType::Text => {
            let text = dictionary
                .get(b"Contents")
                .ok()
                .and_then(|object| document.dereference(object).ok().map(|(_, value)| value))
                .and_then(|object| decode_text_string(object).ok())
                .unwrap_or_default();
            (PdfPoint { x: bounds.left, y: bounds.top }, AnnotationContent::Text { text })
        }
        AnnotationType::Ink => {
            let paths = parse_ink_paths(dictionary.get(b"InkList").map_err(|_| {
                PdfError::AnnotationParse {
                    message: "ink annotation is missing /InkList".to_string(),
                }
            })?)?;
            let position = paths
                .first()
                .and_then(|path| path.first())
                .copied()
                .unwrap_or(PdfPoint { x: bounds.left, y: bounds.bottom });
            (position, AnnotationContent::Ink { paths })
        }
        AnnotationType::Highlight => {
            let quads = parse_quads(dictionary.get(b"QuadPoints").map_err(|_| {
                PdfError::AnnotationParse {
                    message: "highlight annotation is missing /QuadPoints".to_string(),
                }
            })?)?;
            (
                quads
                    .first()
                    .map(|quad| quad.bottom_left)
                    .unwrap_or(PdfPoint { x: bounds.left, y: bounds.bottom }),
                AnnotationContent::Highlight { quads },
            )
        }
    };
    Ok(Some(Annotation {
        editor_id,
        page_index,
        annotation_type,
        position,
        bounds,
        style,
        content,
    }))
}

fn parse_editor_id(
    document: &Document,
    dictionary: &Dictionary,
    page_index: usize,
    object_id: Option<ObjectId>,
    fallback_index: usize,
) -> PdfResult<AnnotationId> {
    if let Some(editor_id) = explicit_editor_id(document, dictionary)? {
        return Ok(editor_id);
    }
    let fallback = match object_id {
        Some((number, generation)) => format!("imported-{page_index}-{number}-{generation}"),
        None => format!("imported-{page_index}-{fallback_index}"),
    };
    AnnotationId::new(fallback)
}

fn explicit_editor_id(
    document: &Document,
    dictionary: &Dictionary,
) -> PdfResult<Option<AnnotationId>> {
    let Some(object) = dictionary
        .get(b"NM")
        .ok()
        .and_then(|object| document.dereference(object).ok().map(|(_, value)| value))
    else {
        return Ok(None);
    };
    let text = decode_text_string(object).map_err(|_| PdfError::AnnotationParse {
        message: "annotation /NM is not a valid text string".to_string(),
    })?;
    AnnotationId::new(text).map(Some)
}

fn parse_style(
    document: &Document,
    dictionary: &Dictionary,
    annotation_type: AnnotationType,
) -> PdfResult<AnnotationStyle> {
    let color = dictionary
        .get(b"C")
        .ok()
        .and_then(|object| document.dereference(object).ok().map(|(_, value)| value))
        .map(parse_color)
        .transpose()?
        .unwrap_or(match annotation_type {
            AnnotationType::Highlight => PdfColor::YELLOW,
            _ => PdfColor::BLACK,
        });
    let opacity = dictionary
        .get(b"CA")
        .ok()
        .and_then(|object| document.dereference(object).ok().map(|(_, value)| value))
        .map(|object| object.as_float().map(f64::from))
        .transpose()
        .map_err(|_| PdfError::AnnotationParse {
            message: "annotation /CA is invalid".to_string(),
        })?
        .unwrap_or(1.0);
    let stroke_width = dictionary
        .get(b"BS")
        .and_then(Object::as_dict)
        .ok()
        .and_then(|dict| dict.get(b"W").ok())
        .and_then(|object| object.as_float().ok())
        .map(f64::from)
        .unwrap_or(2.0)
        .max(0.01);
    let font_size = dictionary
        .get(b"DA")
        .ok()
        .and_then(|object| document.dereference(object).ok().map(|(_, value)| value))
        .and_then(|object| object.as_str().ok())
        .and_then(parse_font_size)
        .unwrap_or(12.0);
    let style = AnnotationStyle { color, opacity, stroke_width, font_size };
    style.validate()?;
    Ok(style)
}

fn parse_color(object: &Object) -> PdfResult<PdfColor> {
    let values = object.as_array().map_err(|_| PdfError::AnnotationParse {
        message: "annotation /C is not an array".to_string(),
    })?;
    if values.len() < 3 {
        return Err(PdfError::AnnotationParse {
            message: "annotation /C has fewer than three components".to_string(),
        });
    }
    let color = PdfColor {
        red: f64::from(values[0].as_float().map_err(|_| PdfError::AnnotationParse {
            message: "annotation color is invalid".to_string(),
        })?),
        green: f64::from(values[1].as_float().map_err(|_| PdfError::AnnotationParse {
            message: "annotation color is invalid".to_string(),
        })?),
        blue: f64::from(values[2].as_float().map_err(|_| PdfError::AnnotationParse {
            message: "annotation color is invalid".to_string(),
        })?),
    };
    if !color.is_valid() {
        return Err(PdfError::AnnotationParse {
            message: "annotation color is outside 0..=1".to_string(),
        });
    }
    Ok(color)
}

fn parse_font_size(bytes: &[u8]) -> Option<f64> {
    let text = String::from_utf8_lossy(bytes);
    let tokens = text.split_whitespace().collect::<Vec<_>>();
    tokens
        .windows(2)
        .find_map(|window| (window[1] == "Tf").then(|| window[0].parse::<f64>().ok()).flatten())
}

fn parse_ink_paths(object: &Object) -> PdfResult<Vec<Vec<PdfPoint>>> {
    let paths = object.as_array().map_err(|_| PdfError::AnnotationParse {
        message: "/InkList is not an array".to_string(),
    })?;
    if paths.len() > MAX_INK_POINTS {
        return Err(PdfError::AnnotationParse {
            message: "ink path count exceeds the point limit".to_string(),
        });
    }
    let mut result = Vec::with_capacity(paths.len());
    let mut count = 0usize;
    for path in paths {
        let values = path.as_array().map_err(|_| PdfError::AnnotationParse {
            message: "ink path is not an array".to_string(),
        })?;
        if values.len() % 2 != 0 || values.len() < 4 {
            return Err(PdfError::AnnotationParse {
                message: "ink path has an invalid point count".to_string(),
            });
        }
        let point_count = values.len() / 2;
        if point_count > MAX_INK_POINTS - count {
            return Err(PdfError::AnnotationParse {
                message: "ink point limit exceeded".to_string(),
            });
        }
        let mut points = Vec::with_capacity(point_count);
        for pair in values.chunks_exact(2) {
            let point = PdfPoint {
                x: f64::from(pair[0].as_float().map_err(|_| PdfError::AnnotationParse {
                    message: "ink coordinate is invalid".to_string(),
                })?),
                y: f64::from(pair[1].as_float().map_err(|_| PdfError::AnnotationParse {
                    message: "ink coordinate is invalid".to_string(),
                })?),
            };
            if !point.is_finite() {
                return Err(PdfError::AnnotationParse {
                    message: "ink coordinate is non-finite".to_string(),
                });
            }
            points.push(point);
        }
        count += points.len();
        if count > MAX_INK_POINTS {
            return Err(PdfError::AnnotationParse {
                message: "ink point limit exceeded".to_string(),
            });
        }
        result.push(points);
    }
    Ok(result)
}

fn parse_quads(object: &Object) -> PdfResult<Vec<PdfQuad>> {
    let values = object.as_array().map_err(|_| PdfError::AnnotationParse {
        message: "/QuadPoints is not an array".to_string(),
    })?;
    if values.is_empty() || values.len() % 8 != 0 || values.len() / 8 > MAX_HIGHLIGHT_QUADS {
        return Err(PdfError::AnnotationParse {
            message: "highlight quad point count is invalid".to_string(),
        });
    }
    let mut quads = Vec::with_capacity(values.len() / 8);
    for values in values.chunks_exact(8) {
        let mut points = [0.0; 8];
        for (index, value) in values.iter().enumerate() {
            points[index] = f64::from(value.as_float().map_err(|_| PdfError::AnnotationParse {
                message: "highlight coordinate is invalid".to_string(),
            })?);
        }
        if !points.iter().all(|value| value.is_finite()) {
            return Err(PdfError::AnnotationParse {
                message: "highlight coordinate is non-finite".to_string(),
            });
        }
        quads.push(PdfQuad {
            top_left: PdfPoint { x: points[0], y: points[1] },
            top_right: PdfPoint { x: points[2], y: points[3] },
            bottom_left: PdfPoint { x: points[4], y: points[5] },
            bottom_right: PdfPoint { x: points[6], y: points[7] },
        });
    }
    Ok(quads)
}

fn parse_rectangle(object: &Object) -> PdfResult<PdfRectangle> {
    let values = object.as_array().map_err(|_| PdfError::AnnotationParse {
        message: "annotation /Rect is not an array".to_string(),
    })?;
    if values.len() != 4 {
        return Err(PdfError::AnnotationParse {
            message: "annotation /Rect must contain four numbers".to_string(),
        });
    }
    let numbers = values
        .iter()
        .map(|value| value.as_float().map(f64::from))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| PdfError::AnnotationParse {
            message: "annotation /Rect contains a non-number".to_string(),
        })?;
    let rect = PdfRectangle {
        left: numbers[0].min(numbers[2]),
        bottom: numbers[1].min(numbers[3]),
        right: numbers[0].max(numbers[2]),
        top: numbers[1].max(numbers[3]),
    };
    if ![rect.left, rect.bottom, rect.right, rect.top].iter().all(|value| value.is_finite())
        || rect.left >= rect.right
        || rect.bottom >= rect.top
    {
        return Err(PdfError::AnnotationParse {
            message: "annotation /Rect is empty or non-finite".to_string(),
        });
    }
    Ok(rect)
}

fn rectangle_object(rect: PdfRectangle) -> Object {
    vec![rect.left.into(), rect.bottom.into(), rect.right.into(), rect.top.into()].into()
}

fn color_object(color: PdfColor) -> Object {
    vec![color.red.into(), color.green.into(), color.blue.into()].into()
}

fn text_string(value: &str) -> Object {
    let mut bytes = vec![0xFE, 0xFF];
    bytes.extend(value.encode_utf16().flat_map(u16::to_be_bytes));
    Object::String(bytes, StringFormat::Hexadecimal)
}

fn number(value: f64) -> String {
    let value = if value == -0.0 { 0.0 } else { value };
    let mut output = format!("{value:.4}");
    while output.contains('.') && output.ends_with('0') {
        output.pop();
    }
    if output.ends_with('.') {
        output.pop();
    }
    output
}

fn pdf_literal(value: &str) -> String {
    let mut output = String::from("(");
    for byte in value.bytes() {
        match byte {
            b'(' | b')' | b'\\' => {
                output.push('\\');
                output.push(byte as char);
            }
            b'\n' => output.push_str("\\n"),
            b'\r' => output.push_str("\\r"),
            0x20..=0x7e => output.push(byte as char),
            _ => output.push('?'),
        }
    }
    output.push(')');
    output
}

pub(crate) fn annotation_entries(
    document: &Document,
    page_id: ObjectId,
) -> PdfResult<Vec<(Option<ObjectId>, Dictionary)>> {
    let page = document
        .get_dictionary(page_id)
        .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?;
    let entries = match page.get(b"Annots") {
        Ok(Object::Reference(id)) => document
            .get_object(*id)
            .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
            .as_array()
            .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?,
        Ok(Object::Array(entries)) => entries,
        Ok(_) => {
            return Err(PdfError::AnnotationParse {
                message: "page /Annots is not an array".to_string(),
            });
        }
        Err(_) => return Ok(Vec::new()),
    };
    let mut result = Vec::with_capacity(entries.len());
    for entry in entries {
        match entry {
            Object::Reference(id) => {
                if let Ok(dictionary) = document.get_dictionary(*id) {
                    result.push((Some(*id), dictionary.clone()));
                }
            }
            Object::Dictionary(dictionary) => result.push((None, dictionary.clone())),
            _ => {}
        }
    }
    Ok(result)
}

pub(crate) fn has_annotation_id(document: &Document, id: &AnnotationId) -> PdfResult<bool> {
    let mut seen_pages = HashSet::new();
    for (_, page_id) in document.get_pages() {
        if !seen_pages.insert(page_id) {
            continue;
        }
        for (_, dictionary) in annotation_entries(document, page_id)? {
            if explicit_editor_id(document, &dictionary)?.as_ref() == Some(id) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

pub(crate) fn append_annotation_reference(
    document: &mut Document,
    page_id: ObjectId,
    annotation_id: ObjectId,
) -> PdfResult<()> {
    let annots_id = {
        let page = document
            .get_dictionary(page_id)
            .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?;
        match page.get(b"Annots") {
            Ok(Object::Reference(id)) => {
                document
                    .get_object(*id)
                    .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
                    .as_array()
                    .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?;
                Some(*id)
            }
            Ok(Object::Array(_)) => Some((0, 0)),
            Ok(_) => {
                return Err(PdfError::AnnotationParse {
                    message: "page /Annots is not an array".to_string(),
                });
            }
            Err(_) => None,
        }
    };
    if let Some(annots_id) = annots_id {
        if annots_id == (0, 0) {
            document
                .get_dictionary_mut(page_id)
                .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
                .get_mut(b"Annots")
                .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
                .as_array_mut()
                .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
                .push(annotation_id.into());
            return Ok(());
        }
        document
            .get_object_mut(annots_id)
            .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
            .as_array_mut()
            .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
            .push(annotation_id.into());
    } else {
        document
            .get_dictionary_mut(page_id)
            .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
            .set("Annots", vec![annotation_id.into()]);
    }
    Ok(())
}

pub(crate) fn remove_annotation_entry(
    document: &mut Document,
    page_id: ObjectId,
    page_index: usize,
    editor_id: &AnnotationId,
) -> PdfResult<(bool, Option<ObjectId>)> {
    let (annots_id, entries) = {
        let page = document
            .get_dictionary(page_id)
            .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?;
        match page.get(b"Annots") {
            Ok(Object::Reference(id)) => {
                let entries = document
                    .get_object(*id)
                    .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
                    .as_array()
                    .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
                    .clone();
                (Some(*id), entries)
            }
            Ok(Object::Array(entries)) => (None, entries.clone()),
            Ok(_) => {
                return Err(PdfError::AnnotationParse {
                    message: "page /Annots is not an array".to_string(),
                });
            }
            Err(_) => return Ok((false, None)),
        }
    };
    let mut match_index = None;
    let mut indirect_annotation = None;
    for (index, entry) in entries.iter().enumerate() {
        let (object_id, dictionary) = match entry {
            Object::Reference(id) => (*id, document.get_dictionary(*id).ok()),
            Object::Dictionary(dictionary) => ((0, 0), Some(dictionary)),
            _ => continue,
        };
        let Some(dictionary) = dictionary else { continue };
        let Some(annotation) = parse_annotation(
            document,
            page_index,
            (object_id != (0, 0)).then_some(object_id),
            dictionary,
            index,
        )?
        else {
            continue;
        };
        if annotation.id() == editor_id {
            match_index = Some(index);
            indirect_annotation = (object_id != (0, 0)).then_some(object_id);
            break;
        }
    }
    let Some(index) = match_index else { return Ok((false, None)) };
    if let Some(annots_id) = annots_id {
        document
            .get_object_mut(annots_id)
            .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
            .as_array_mut()
            .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
            .remove(index);
    } else {
        document
            .get_dictionary_mut(page_id)
            .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
            .get_mut(b"Annots")
            .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
            .as_array_mut()
            .map_err(|error| PdfError::AnnotationParse { message: error.to_string() })?
            .remove(index);
    }
    Ok((true, indirect_annotation))
}
