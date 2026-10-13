use std::collections::HashSet;

use lopdf::{Document, Object, ObjectId};

use crate::{PdfError, PdfResult};

/// A rectangle expressed in PDF user-space points.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PdfRectangle {
    /// Lower-left x coordinate.
    pub left: f64,
    /// Lower-left y coordinate.
    pub bottom: f64,
    /// Upper-right x coordinate.
    pub right: f64,
    /// Upper-right y coordinate.
    pub top: f64,
}

impl PdfRectangle {
    /// Return the positive physical width of the rectangle.
    pub fn width(self) -> f64 {
        (self.right - self.left).abs()
    }

    /// Return the positive physical height of the rectangle.
    pub fn height(self) -> f64 {
        (self.top - self.bottom).abs()
    }
}

/// Dimensions and page-box information for one PDF page.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageDimensions {
    /// The inherited or page-local media box.
    pub media_box: PdfRectangle,
    /// The inherited crop box, or the media box when no crop box is supplied.
    pub crop_box: PdfRectangle,
    /// The effective crop-box width in PDF points.
    pub width: f64,
    /// The effective crop-box height in PDF points.
    pub height: f64,
    /// The page rotation normalized to the range 0..360.
    pub rotation_degrees: i32,
}

/// Page information that is safe to expose to callers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageInfo {
    /// Zero-based page index.
    pub index: usize,
    /// The underlying lopdf page object identifier.
    pub object_id: ObjectId,
    /// Page dimensions and effective boxes.
    pub dimensions: PageDimensions,
}

pub(crate) fn page_info(document: &Document, index: usize) -> PdfResult<PageInfo> {
    let page_ids: Vec<ObjectId> = document.get_pages().values().copied().collect();
    let page_count = page_ids.len();
    let object_id =
        page_ids.get(index).copied().ok_or(PdfError::PageIndexOutOfRange { index, page_count })?;

    let dimensions = page_dimensions(document, index, object_id)?;
    Ok(PageInfo { index, object_id, dimensions })
}

pub(crate) fn page_dimensions(
    document: &Document,
    page_index: usize,
    page_id: ObjectId,
) -> PdfResult<PageDimensions> {
    let media_box = inherited_box(document, page_index, page_id, b"MediaBox", "MediaBox")?
        .ok_or(PdfError::MissingPageAttribute { page_index, attribute: "MediaBox" })?;
    let crop_box =
        inherited_box(document, page_index, page_id, b"CropBox", "CropBox")?.unwrap_or(media_box);
    let rotation =
        inherited_number(document, page_index, page_id, b"Rotate", "Rotate")?.unwrap_or(0.0);

    let rotation_degrees = normalize_rotation(rotation, page_index)?;
    let width = crop_box.width();
    let height = crop_box.height();
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(PdfError::InvalidPageAttribute { page_index, attribute: "CropBox" });
    }

    Ok(PageDimensions { media_box, crop_box, width, height, rotation_degrees })
}

fn inherited_box(
    document: &Document,
    page_index: usize,
    page_id: ObjectId,
    key: &'static [u8],
    attribute: &'static str,
) -> PdfResult<Option<PdfRectangle>> {
    let object = inherited_object(document, page_index, page_id, key)?;
    object.map(|value| parse_box(value, page_index, attribute)).transpose()
}

fn inherited_number(
    document: &Document,
    page_index: usize,
    page_id: ObjectId,
    key: &'static [u8],
    attribute: &'static str,
) -> PdfResult<Option<f64>> {
    let Some(object) = inherited_object(document, page_index, page_id, key)? else {
        return Ok(None);
    };

    let value = object
        .as_float()
        .map(f64::from)
        .map_err(|_| PdfError::InvalidPageAttribute { page_index, attribute })?;
    if !value.is_finite() {
        return Err(PdfError::InvalidPageAttribute { page_index, attribute });
    }
    Ok(Some(value))
}

fn inherited_object(
    document: &Document,
    page_index: usize,
    page_id: ObjectId,
    key: &'static [u8],
) -> PdfResult<Option<Object>> {
    let mut current_id = Some(page_id);
    let mut seen = HashSet::new();

    for _ in 0..128 {
        let Some(object_id) = current_id else {
            return Ok(None);
        };
        if !seen.insert(object_id) {
            return Err(PdfError::InvalidPageTree {
                page_index,
                message: "parent cycle detected".to_string(),
            });
        }

        let page = document.get_dictionary(object_id).map_err(|_| PdfError::InvalidPageTree {
            page_index,
            message: "page object is not a dictionary".to_string(),
        })?;

        if let Ok(value) = page.get(key) {
            let (_, resolved) =
                document.dereference(value).map_err(|_| PdfError::InvalidPageTree {
                    page_index,
                    message: "page attribute reference could not be resolved".to_string(),
                })?;
            return Ok(Some(resolved.clone()));
        }

        current_id = page.get(b"Parent").ok().and_then(|parent| parent.as_reference().ok());
    }

    Err(PdfError::InvalidPageTree {
        page_index,
        message: "parent chain exceeded the reference depth limit".to_string(),
    })
}

fn parse_box(
    object: Object,
    page_index: usize,
    attribute: &'static str,
) -> PdfResult<PdfRectangle> {
    let values =
        object.as_array().map_err(|_| PdfError::InvalidPageAttribute { page_index, attribute })?;
    if values.len() != 4 {
        return Err(PdfError::InvalidPageAttribute { page_index, attribute });
    }

    let numbers = values
        .iter()
        .map(Object::as_float)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| PdfError::InvalidPageAttribute { page_index, attribute })?;
    let rectangle = PdfRectangle {
        left: f64::from(numbers[0]),
        bottom: f64::from(numbers[1]),
        right: f64::from(numbers[2]),
        top: f64::from(numbers[3]),
    };
    if [rectangle.left, rectangle.bottom, rectangle.right, rectangle.top]
        .iter()
        .any(|value| !value.is_finite())
        || rectangle.width() <= 0.0
        || rectangle.height() <= 0.0
    {
        return Err(PdfError::InvalidPageAttribute { page_index, attribute });
    }
    Ok(rectangle)
}

fn normalize_rotation(value: f64, page_index: usize) -> PdfResult<i32> {
    if !value.is_finite()
        || value.fract() != 0.0
        || value < f64::from(i32::MIN)
        || value > f64::from(i32::MAX)
    {
        return Err(PdfError::InvalidPageAttribute { page_index, attribute: "Rotate" });
    }
    let rotation = value as i32;
    Ok(rotation.rem_euclid(360))
}
