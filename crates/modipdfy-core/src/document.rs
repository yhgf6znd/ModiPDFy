use std::panic::{AssertUnwindSafe, catch_unwind};

use lopdf::{Document, LoadOptions};

use crate::{
    DocumentMetadata, PageDimensions, PageInfo, PdfError, PdfObjectId, PdfObjectInfo, PdfResult,
    inspect, metadata, page, serialization,
};

/// Default maximum input size for one in-memory PDF document.
pub const DEFAULT_MAX_INPUT_BYTES: usize = 128 * 1024 * 1024;
/// Default maximum decompressed size for an individual PDF stream.
pub const DEFAULT_MAX_DECOMPRESSED_STREAM_BYTES: usize = 256 * 1024 * 1024;

/// Defensive limits for loading an untrusted in-memory PDF.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DocumentLoadOptions {
    /// Maximum source byte length accepted by the engine.
    pub max_input_bytes: usize,
    /// Maximum decompressed size of one lopdf stream.
    pub max_decompressed_stream_bytes: usize,
    /// Whether lopdf should reject leniently recoverable PDF syntax.
    pub strict: bool,
}

impl Default for DocumentLoadOptions {
    fn default() -> Self {
        Self {
            max_input_bytes: DEFAULT_MAX_INPUT_BYTES,
            max_decompressed_stream_bytes: DEFAULT_MAX_DECOMPRESSED_STREAM_BYTES,
            strict: false,
        }
    }
}

/// An in-memory PDF document owned by the native core.
///
/// The source bytes are copied on load and are never mutated. Until a future core editing
/// operation marks the document dirty, saving returns those original bytes unchanged. This
/// avoids an unnecessary rewrite and is especially important for signed or incrementally
/// updated documents.
pub struct PdfDocument {
    document: Document,
    source_bytes: Vec<u8>,
    dirty: bool,
}

impl PdfDocument {
    /// Load a PDF from a byte slice without filesystem access.
    pub fn from_bytes(bytes: &[u8]) -> PdfResult<Self> {
        Self::from_bytes_with_options(bytes, DocumentLoadOptions::default())
    }

    /// Load a PDF from bytes using explicit parser and resource limits.
    pub fn from_bytes_with_options(bytes: &[u8], options: DocumentLoadOptions) -> PdfResult<Self> {
        if bytes.is_empty() {
            return Err(PdfError::EmptyInput);
        }
        if bytes.len() > options.max_input_bytes {
            return Err(PdfError::InputTooLarge {
                actual: bytes.len(),
                maximum: options.max_input_bytes,
            });
        }

        let load_options = LoadOptions {
            strict: options.strict,
            max_decompressed_size: Some(options.max_decompressed_stream_bytes),
            ..LoadOptions::default()
        };
        let parsed =
            catch_unwind(AssertUnwindSafe(|| Document::load_mem_with_options(bytes, load_options)))
                .map_err(|_| PdfError::ParserPanicked)?
                .map_err(|error| PdfError::MalformedPdf { message: error.to_string() })?;

        Ok(Self { document: parsed, source_bytes: bytes.to_vec(), dirty: false })
    }

    /// Return the number of pages in document order.
    pub fn page_count(&self) -> usize {
        self.document.get_pages().len()
    }

    /// Return the dimensions and effective boxes for a zero-based page index.
    pub fn page_dimensions(&self, page_index: usize) -> PdfResult<PageDimensions> {
        Ok(self.page_info(page_index)?.dimensions)
    }

    /// Return detailed information for a zero-based page index.
    pub fn page_info(&self, page_index: usize) -> PdfResult<PageInfo> {
        page::page_info(&self.document, page_index)
    }

    /// Extract document information and safety warnings.
    pub fn metadata(&self) -> DocumentMetadata {
        metadata::metadata(&self.document)
    }

    /// Return the number of indirect objects currently held by lopdf.
    pub fn object_count(&self) -> usize {
        self.document.objects.len()
    }

    /// Inspect one indirect object without exposing its contents to the caller.
    pub fn inspect_object(&self, object_id: PdfObjectId) -> PdfResult<PdfObjectInfo> {
        inspect::inspect(&self.document, object_id)
    }

    /// Return whether a future editing operation has changed the parsed document.
    pub fn has_unsaved_changes(&self) -> bool {
        self.dirty
    }

    /// Serialize the document to new bytes without filesystem access.
    ///
    /// An untouched document returns a copy of its original input. Future core editing
    /// operations can use the crate-private mutation hook and will then serialize through
    /// lopdf while retaining the original input in this object.
    pub fn save_to_bytes(&mut self) -> PdfResult<Vec<u8>> {
        if !self.dirty {
            return Ok(self.source_bytes.clone());
        }
        serialization::serialize(&mut self.document)
    }

    // Reserved for future core editing operations. Keeping the dirty transition here prevents
    // a future mutator from accidentally returning the untouched source bytes.
    #[allow(dead_code)]
    pub(crate) fn document_mut(&mut self) -> &mut Document {
        self.dirty = true;
        &mut self.document
    }
}

#[cfg(test)]
mod tests {
    use lopdf::{Document as LopdfDocument, dictionary};

    use super::PdfDocument;

    fn fixture() -> Vec<u8> {
        let mut source = LopdfDocument::with_version("1.4");
        let pages_id = source.new_object_id();
        let page_id = source.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        });
        source.objects.insert(
            pages_id,
            dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1,
            }
            .into(),
        );
        let catalog_id = source.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        source.trailer.set("Root", catalog_id);

        let mut bytes = Vec::new();
        source.save_to(&mut bytes).expect("generated fixture should serialize");
        bytes
    }

    #[test]
    fn dirty_save_serializes_through_lopdf_and_reopens() {
        let mut document = PdfDocument::from_bytes(&fixture()).expect("fixture loads");
        document.document_mut().version = "1.7".to_string();

        let saved = document.save_to_bytes().expect("dirty document serializes");
        let reopened = PdfDocument::from_bytes(&saved).expect("serialized document reopens");

        assert!(document.has_unsaved_changes());
        assert_eq!(reopened.metadata().version, "1.7");
        assert_eq!(reopened.page_count(), 1);
    }
}
