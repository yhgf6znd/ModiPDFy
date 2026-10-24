use std::panic::{AssertUnwindSafe, catch_unwind};

use lopdf::{Document, LoadOptions};

use crate::{
    Annotation, AnnotationId, DocumentMetadata, HighlightAnnotation, InkAnnotation, PageDimensions,
    PageInfo, PdfError, PdfObjectId, PdfObjectInfo, PdfResult, SignatureAnnotation, TextAnnotation,
    annotation, inspect, metadata, page, serialization,
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
/// The source bytes are retained on load and are never mutated. Until a future core editing
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

    /// Take ownership of PDF bytes and load them without a second source-byte copy.
    ///
    /// This is the preferred entry point for adapters that already own a byte buffer, such as
    /// the WASM boundary after converting a JavaScript `Uint8Array` once.
    pub fn from_owned_bytes(bytes: Vec<u8>) -> PdfResult<Self> {
        Self::from_owned_bytes_with_options(bytes, DocumentLoadOptions::default())
    }

    /// Load a PDF from bytes using explicit parser and resource limits.
    pub fn from_bytes_with_options(bytes: &[u8], options: DocumentLoadOptions) -> PdfResult<Self> {
        let document = Self::parse_bytes(bytes, options)?;
        Ok(Self { document, source_bytes: bytes.to_vec(), dirty: false })
    }

    /// Take ownership of PDF bytes and load them with explicit parser and resource limits.
    pub fn from_owned_bytes_with_options(
        bytes: Vec<u8>,
        options: DocumentLoadOptions,
    ) -> PdfResult<Self> {
        let document = Self::parse_bytes(&bytes, options)?;
        Ok(Self { document, source_bytes: bytes, dirty: false })
    }

    fn parse_bytes(bytes: &[u8], options: DocumentLoadOptions) -> PdfResult<Document> {
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

        Ok(parsed)
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
    /// An untouched document returns a copy of its original input. Future core editing operations
    /// can use the crate-private mutation hook and will serialize through lopdf. The retained
    /// source buffer is released after a successful rewrite.
    pub fn save_to_bytes(&mut self) -> PdfResult<Vec<u8>> {
        if !self.dirty {
            return Ok(self.source_bytes.clone());
        }
        self.ensure_editable("rewrite")?;
        let bytes = serialization::serialize(&mut self.document)?;
        self.source_bytes = Vec::new();
        Ok(bytes)
    }

    /// Add a native PDF FreeText annotation and return its editor identifier.
    pub fn add_text_annotation(&mut self, annotation: TextAnnotation) -> PdfResult<AnnotationId> {
        self.ensure_editable("edit")?;
        let page = self.page_info(annotation.page_index)?;
        annotation::validate_text(&annotation, &page)?;
        self.ensure_unique_annotation_id(&annotation.editor_id)?;
        let object = annotation::build_text_object(&mut self.document, &annotation, page.object_id);
        let object_id = self.document.add_object(object);
        if let Err(error) =
            annotation::append_annotation_reference(&mut self.document, page.object_id, object_id)
        {
            let _ = self.document.remove_object(&object_id);
            return Err(error);
        }
        self.dirty = true;
        Ok(annotation.editor_id)
    }

    /// Add a native PDF Ink annotation and return its editor identifier.
    pub fn add_ink_annotation(&mut self, annotation: InkAnnotation) -> PdfResult<AnnotationId> {
        self.ensure_editable("edit")?;
        let page = self.page_info(annotation.page_index)?;
        annotation::validate_ink(&annotation, &page)?;
        self.ensure_unique_annotation_id(&annotation.editor_id)?;
        let object = annotation::build_ink_object(&mut self.document, &annotation, page.object_id);
        let object_id = self.document.add_object(object);
        if let Err(error) =
            annotation::append_annotation_reference(&mut self.document, page.object_id, object_id)
        {
            let _ = self.document.remove_object(&object_id);
            return Err(error);
        }
        self.dirty = true;
        Ok(annotation.editor_id)
    }

    /// Add a visual handwritten signature as a native PDF Ink annotation.
    pub fn add_signature_annotation(
        &mut self,
        annotation: SignatureAnnotation,
    ) -> PdfResult<AnnotationId> {
        self.ensure_editable("edit")?;
        let page = self.page_info(annotation.page_index)?;
        annotation::validate_signature(&annotation, &page)?;
        if !annotation.editor_id.as_str().starts_with("signature-") {
            return Err(PdfError::InvalidAnnotationContent {
                message: "signature IDs must use the signature- prefix".to_string(),
            });
        }
        self.ensure_unique_annotation_id(&annotation.editor_id)?;
        let object =
            annotation::build_signature_object(&mut self.document, &annotation, page.object_id);
        let object_id = self.document.add_object(object);
        if let Err(error) =
            annotation::append_annotation_reference(&mut self.document, page.object_id, object_id)
        {
            let _ = self.document.remove_object(&object_id);
            return Err(error);
        }
        self.dirty = true;
        Ok(annotation.editor_id)
    }

    /// Add a native PDF Highlight annotation with standards-compliant QuadPoints.
    pub fn add_highlight_annotation(
        &mut self,
        annotation: HighlightAnnotation,
    ) -> PdfResult<AnnotationId> {
        self.ensure_editable("edit")?;
        let page = self.page_info(annotation.page_index)?;
        annotation::validate_highlight(&annotation, &page)?;
        self.ensure_unique_annotation_id(&annotation.editor_id)?;
        let object =
            annotation::build_highlight_object(&mut self.document, &annotation, page.object_id);
        let object_id = self.document.add_object(object);
        if let Err(error) =
            annotation::append_annotation_reference(&mut self.document, page.object_id, object_id)
        {
            let _ = self.document.remove_object(&object_id);
            return Err(error);
        }
        self.dirty = true;
        Ok(annotation.editor_id)
    }

    /// Remove one editor-owned or imported supported annotation by its `/NM` ID.
    pub fn remove_annotation(&mut self, editor_id: &AnnotationId) -> PdfResult<()> {
        self.ensure_editable("edit")?;
        let page_ids = self.document.get_pages().into_values().collect::<Vec<_>>();
        for (page_index, page_id) in page_ids.into_iter().enumerate() {
            let (removed, object_id) = annotation::remove_annotation_entry(
                &mut self.document,
                page_id,
                page_index,
                editor_id,
            )?;
            if removed {
                if let Some(object_id) = object_id {
                    self.document.remove_object(&object_id).map_err(|error| {
                        PdfError::AnnotationParse { message: error.to_string() }
                    })?;
                }
                self.dirty = true;
                return Ok(());
            }
        }
        Err(PdfError::AnnotationNotFound { editor_id: editor_id.to_string() })
    }

    /// List supported native annotations in page order without flattening page content.
    pub fn list_annotations(&self) -> PdfResult<Vec<Annotation>> {
        let mut annotations = Vec::new();
        let mut ids = std::collections::HashSet::new();
        for (page_number, page_id) in self.document.get_pages() {
            for (fallback_index, (object_id, dictionary)) in
                annotation::annotation_entries(&self.document, page_id)?.into_iter().enumerate()
            {
                let Some(annotation) = annotation::parse_annotation(
                    &self.document,
                    page_number as usize - 1,
                    object_id,
                    &dictionary,
                    fallback_index,
                )?
                else {
                    continue;
                };
                if !ids.insert(annotation.editor_id.clone()) {
                    return Err(PdfError::DuplicateAnnotationId {
                        editor_id: annotation.editor_id.to_string(),
                    });
                }
                annotations.push(annotation);
            }
        }
        Ok(annotations)
    }

    fn ensure_unique_annotation_id(&self, editor_id: &AnnotationId) -> PdfResult<()> {
        if annotation::has_annotation_id(&self.document, editor_id)? {
            return Err(PdfError::DuplicateAnnotationId { editor_id: editor_id.to_string() });
        }
        Ok(())
    }

    fn ensure_editable(&self, operation: &'static str) -> PdfResult<()> {
        if self.metadata().signature_count > 0 {
            return Err(PdfError::SignedDocument { operation });
        }
        Ok(())
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
