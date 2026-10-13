use lopdf::{Document, Object, decode_text_string};

/// A non-fatal condition callers should understand before saving or editing a document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PdfWarning {
    /// One or more PDF signature dictionaries or signature fields were detected.
    SignaturesDetected { count: usize },
    /// Rewriting a signed document must not be presented as preserving its validity.
    SignatureValidityNotGuaranteed,
    /// The document was encrypted or remains encrypted.
    EncryptedDocument,
    /// The document contains a `/Prev` trailer entry indicating an incremental history.
    IncrementalUpdatesDetected,
}

/// Metadata and safety signals collected from a loaded PDF.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentMetadata {
    /// PDF specification version reported by lopdf.
    pub version: String,
    /// Optional title from the document information dictionary.
    pub title: Option<String>,
    /// Optional author from the document information dictionary.
    pub author: Option<String>,
    /// Optional subject from the document information dictionary.
    pub subject: Option<String>,
    /// Optional keywords from the document information dictionary.
    pub keywords: Option<String>,
    /// Optional creator application from the document information dictionary.
    pub creator: Option<String>,
    /// Optional producer application from the document information dictionary.
    pub producer: Option<String>,
    /// Number of pages in document order.
    pub page_count: usize,
    /// Whether the currently loaded document is still encrypted.
    pub encrypted: bool,
    /// Whether the original input declared encryption.
    pub was_encrypted: bool,
    /// Number of signature dictionaries or fields detected.
    pub signature_count: usize,
    /// Whether the trailer indicates an incremental update chain.
    pub has_incremental_updates: bool,
    /// Non-fatal safety and interoperability warnings.
    pub warnings: Vec<PdfWarning>,
}

pub(crate) fn metadata(document: &Document) -> DocumentMetadata {
    let info = document.trailer.get(b"Info").ok().and_then(|object| match object {
        Object::Reference(id) => document.get_dictionary(*id).ok(),
        Object::Dictionary(dictionary) => Some(dictionary),
        _ => None,
    });

    let signature_count =
        document.objects.values().filter(|object| is_signature_object(object)).count();
    let encrypted = document.is_encrypted();
    let was_encrypted = document.was_encrypted();
    let has_incremental_updates = document.trailer.has(b"Prev");

    let mut warnings = Vec::new();
    if signature_count > 0 {
        warnings.push(PdfWarning::SignaturesDetected { count: signature_count });
        warnings.push(PdfWarning::SignatureValidityNotGuaranteed);
    }
    if encrypted || was_encrypted {
        warnings.push(PdfWarning::EncryptedDocument);
    }
    if has_incremental_updates {
        warnings.push(PdfWarning::IncrementalUpdatesDetected);
    }

    DocumentMetadata {
        version: document.version.clone(),
        title: info.and_then(|dictionary| text_field(document, dictionary, b"Title")),
        author: info.and_then(|dictionary| text_field(document, dictionary, b"Author")),
        subject: info.and_then(|dictionary| text_field(document, dictionary, b"Subject")),
        keywords: info.and_then(|dictionary| text_field(document, dictionary, b"Keywords")),
        creator: info.and_then(|dictionary| text_field(document, dictionary, b"Creator")),
        producer: info.and_then(|dictionary| text_field(document, dictionary, b"Producer")),
        page_count: document.get_pages().len(),
        encrypted,
        was_encrypted,
        signature_count,
        has_incremental_updates,
        warnings,
    }
}

fn text_field(document: &Document, dictionary: &lopdf::Dictionary, key: &[u8]) -> Option<String> {
    let object = dictionary.get(key).ok()?;
    let (_, resolved) = document.dereference(object).ok()?;
    decode_text_string(resolved).ok()
}

fn is_signature_object(object: &Object) -> bool {
    let dictionary = match object {
        Object::Dictionary(dictionary) => dictionary,
        Object::Stream(stream) => &stream.dict,
        _ => return false,
    };

    let signature_type = dictionary
        .get(b"Type")
        .ok()
        .and_then(|object| object.as_name().ok())
        .is_some_and(|name| name == b"Sig");
    let signature_field = dictionary
        .get(b"FT")
        .ok()
        .and_then(|object| object.as_name().ok())
        .is_some_and(|name| name == b"Sig");
    signature_type || signature_field || dictionary.has(b"ByteRange")
}
