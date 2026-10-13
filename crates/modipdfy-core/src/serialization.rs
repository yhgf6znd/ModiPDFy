use lopdf::Document;

use crate::{PdfError, PdfResult};

pub(crate) fn serialize(document: &mut Document) -> PdfResult<Vec<u8>> {
    let mut bytes = Vec::new();
    document
        .save_to(&mut bytes)
        .map_err(|error| PdfError::Serialization { message: error.to_string() })?;
    Ok(bytes)
}
