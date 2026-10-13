use std::fmt::{Display, Formatter};

use crate::PdfObjectId;

/// The result type used by the native PDF engine.
pub type PdfResult<T> = Result<T, PdfError>;

/// Structured failures returned by PDF loading, inspection, and serialization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PdfError {
    /// No bytes were supplied.
    EmptyInput,
    /// The input exceeded the configured in-memory input limit.
    InputTooLarge { actual: usize, maximum: usize },
    /// The PDF parser rejected the input.
    MalformedPdf { message: String },
    /// The parser panicked while processing untrusted input.
    ParserPanicked,
    /// A page index was not present in the document.
    PageIndexOutOfRange { index: usize, page_count: usize },
    /// A page tree could not provide a required inherited attribute.
    MissingPageAttribute { page_index: usize, attribute: &'static str },
    /// A page attribute was present but had an invalid shape or value.
    InvalidPageAttribute { page_index: usize, attribute: &'static str },
    /// The page tree contained an invalid reference cycle or object.
    InvalidPageTree { page_index: usize, message: String },
    /// An object identifier was not present in the parsed document.
    ObjectNotFound { object_id: PdfObjectId },
    /// An object could not be inspected safely.
    ObjectInspection { object_id: PdfObjectId, message: String },
    /// The document could not be serialized.
    Serialization { message: String },
    /// An editor identifier is missing, malformed, or too long.
    InvalidAnnotationId { value: String },
    /// Annotation geometry contains invalid values or lies outside the page.
    InvalidAnnotationGeometry { message: String },
    /// Annotation style contains an unsupported or unsafe value.
    InvalidAnnotationStyle,
    /// Annotation-specific payload is empty, malformed, or over its limit.
    InvalidAnnotationContent { message: String },
    /// An existing annotation already uses the requested editor identifier.
    DuplicateAnnotationId { editor_id: String },
    /// An annotation could not be decoded from a native PDF dictionary.
    AnnotationParse { message: String },
    /// The requested editor identifier does not exist.
    AnnotationNotFound { editor_id: String },
    /// Editing or rewriting would invalidate a detected document signature.
    SignedDocument { operation: &'static str },
}

impl Display for PdfError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyInput => formatter.write_str("PDF input is empty"),
            Self::InputTooLarge { actual, maximum } => {
                write!(formatter, "PDF input is {actual} bytes; maximum is {maximum} bytes")
            }
            Self::MalformedPdf { message } => write!(formatter, "malformed PDF: {message}"),
            Self::ParserPanicked => formatter.write_str("PDF parser failed while reading input"),
            Self::PageIndexOutOfRange { index, page_count } => {
                write!(formatter, "page index {index} is out of range for {page_count} pages")
            }
            Self::MissingPageAttribute { page_index, attribute } => {
                write!(formatter, "page {page_index} is missing /{attribute}")
            }
            Self::InvalidPageAttribute { page_index, attribute } => {
                write!(formatter, "page {page_index} has an invalid /{attribute}")
            }
            Self::InvalidPageTree { page_index, message } => {
                write!(formatter, "page {page_index} has an invalid page tree: {message}")
            }
            Self::ObjectNotFound { object_id } => {
                write!(formatter, "PDF object {} {} R was not found", object_id.0, object_id.1)
            }
            Self::ObjectInspection { object_id, message } => write!(
                formatter,
                "could not inspect PDF object {} {} R: {message}",
                object_id.0, object_id.1
            ),
            Self::Serialization { message } => {
                write!(formatter, "could not serialize PDF: {message}")
            }
            Self::InvalidAnnotationId { value } => {
                write!(formatter, "invalid annotation editor id: {value:?}")
            }
            Self::InvalidAnnotationGeometry { message } => {
                write!(formatter, "invalid annotation geometry: {message}")
            }
            Self::InvalidAnnotationStyle => formatter.write_str("invalid annotation style"),
            Self::InvalidAnnotationContent { message } => {
                write!(formatter, "invalid annotation content: {message}")
            }
            Self::DuplicateAnnotationId { editor_id } => {
                write!(formatter, "annotation editor id already exists: {editor_id}")
            }
            Self::AnnotationParse { message } => {
                write!(formatter, "could not parse annotation: {message}")
            }
            Self::AnnotationNotFound { editor_id } => {
                write!(formatter, "annotation editor id was not found: {editor_id}")
            }
            Self::SignedDocument { operation } => {
                write!(formatter, "cannot {operation} a document containing a PDF signature")
            }
        }
    }
}

impl std::error::Error for PdfError {}
