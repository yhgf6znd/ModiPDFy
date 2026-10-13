use lopdf::{Object, ObjectId};

use crate::{PdfError, PdfResult};

/// Public alias for lopdf's stable object identifier shape.
pub type PdfObjectId = ObjectId;

/// The top-level lopdf object kind for an indirect object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfObjectKind {
    Null,
    Boolean,
    Integer,
    Real,
    Name,
    String,
    Array,
    Dictionary,
    Stream,
    Reference,
}

/// Safe summary information for one PDF object.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdfObjectInfo {
    /// The inspected indirect object identifier.
    pub object_id: PdfObjectId,
    /// The top-level PDF object kind after lopdf dereferencing.
    pub kind: PdfObjectKind,
    /// The `/Type` name when the object is a dictionary or stream dictionary.
    pub pdf_type: Option<String>,
    /// Number of direct child entries, or stream content bytes for streams.
    pub item_count: usize,
}

pub(crate) fn inspect(
    document: &lopdf::Document,
    object_id: PdfObjectId,
) -> PdfResult<PdfObjectInfo> {
    let object =
        document.get_object(object_id).map_err(|_| PdfError::ObjectNotFound { object_id })?;
    let (kind, pdf_type, item_count) = match object {
        Object::Null => (PdfObjectKind::Null, None, 0),
        Object::Boolean(_) => (PdfObjectKind::Boolean, None, 0),
        Object::Integer(_) => (PdfObjectKind::Integer, None, 0),
        Object::Real(_) => (PdfObjectKind::Real, None, 0),
        Object::Name(_) => (PdfObjectKind::Name, None, 0),
        Object::String(_, _) => (PdfObjectKind::String, None, 0),
        Object::Array(values) => (PdfObjectKind::Array, None, values.len()),
        Object::Dictionary(dictionary) => {
            (PdfObjectKind::Dictionary, type_name(dictionary), dictionary.len())
        }
        Object::Stream(stream) => {
            (PdfObjectKind::Stream, type_name(&stream.dict), stream.content.len())
        }
        Object::Reference(_) => (PdfObjectKind::Reference, None, 0),
    };

    Ok(PdfObjectInfo { object_id, kind, pdf_type, item_count })
}

fn type_name(dictionary: &lopdf::Dictionary) -> Option<String> {
    dictionary
        .get(b"Type")
        .ok()
        .and_then(|object| object.as_name().ok())
        .map(|name| String::from_utf8_lossy(name).into_owned())
}
