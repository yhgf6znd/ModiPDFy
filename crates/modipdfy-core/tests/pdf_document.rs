use lopdf::{Document, Object, dictionary};
use modipdfy_core::{PdfDocument, PdfError, PdfObjectKind, PdfWarning};

fn fixture(page_sizes: &[(i64, i64)], title: Option<&str>) -> Vec<u8> {
    fixture_with_signature(page_sizes, title, false)
}

fn fixture_with_signature(
    page_sizes: &[(i64, i64)],
    title: Option<&str>,
    include_signature: bool,
) -> Vec<u8> {
    let mut document = Document::with_version("1.7");
    let pages_id = document.new_object_id();
    let kids = page_sizes
        .iter()
        .map(|(width, height)| {
            document
                .add_object(dictionary! {
                    "Type" => "Page",
                    "Parent" => pages_id,
                    "MediaBox" => vec![0.into(), 0.into(), (*width).into(), (*height).into()],
                })
                .into()
        })
        .collect::<Vec<Object>>();

    document.objects.insert(
        pages_id,
        dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => page_sizes.len() as i64,
        }
        .into(),
    );
    let catalog_id = document.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    document.trailer.set("Root", catalog_id);

    if let Some(title) = title {
        let info_id = document.add_object(dictionary! {
            "Title" => Object::string_literal(title),
            "Author" => Object::string_literal("ModiPDFy test fixture"),
        });
        document.trailer.set("Info", info_id);
    }
    if include_signature {
        document.add_object(dictionary! {
            "Type" => "Sig",
            "ByteRange" => vec![0.into(), 1.into(), 2.into(), 3.into()],
        });
    }

    let mut bytes = Vec::new();
    document.save_to(&mut bytes).expect("generated fixture should serialize");
    bytes
}

#[test]
fn loads_valid_single_page_pdf() {
    let document = PdfDocument::from_bytes(&fixture(&[(612, 792)], None)).expect("fixture loads");

    assert_eq!(document.page_count(), 1);
    assert_eq!(document.page_dimensions(0).expect("page exists").width, 612.0);
    assert_eq!(document.page_dimensions(0).expect("page exists").height, 792.0);
}

#[test]
fn loads_multipage_pdf_in_original_order() {
    let document =
        PdfDocument::from_bytes(&fixture(&[(200, 300), (400, 500)], None)).expect("fixture loads");

    assert_eq!(document.page_count(), 2);
    assert_eq!(document.page_dimensions(0).expect("first page exists").width, 200.0);
    assert_eq!(document.page_dimensions(1).expect("second page exists").height, 500.0);
}

#[test]
fn rejects_invalid_pdf_without_panicking() {
    let result = std::panic::catch_unwind(|| PdfDocument::from_bytes(b"not a PDF"));

    assert!(result.is_ok(), "malformed input must not panic");
    let parse_result = result.expect("catch_unwind returned");
    assert!(matches!(parse_result, Err(PdfError::MalformedPdf { .. } | PdfError::ParserPanicked)));
}

#[test]
fn rejects_empty_input() {
    assert!(matches!(PdfDocument::from_bytes(&[]), Err(PdfError::EmptyInput)));
}

#[test]
fn validates_page_indices() {
    let document = PdfDocument::from_bytes(&fixture(&[(612, 792)], None)).expect("fixture loads");

    assert_eq!(
        document.page_dimensions(1),
        Err(PdfError::PageIndexOutOfRange { index: 1, page_count: 1 })
    );
}

#[test]
fn saves_and_reopens_without_mutating_source_bytes() {
    let source = fixture(&[(612, 792)], None);
    let mut document = PdfDocument::from_bytes(&source).expect("fixture loads");
    let saved = document.save_to_bytes().expect("untouched fixture saves");

    assert_eq!(saved, source);
    assert!(!document.has_unsaved_changes());
    let reopened = PdfDocument::from_bytes(&saved).expect("saved fixture reopens");
    assert_eq!(reopened.page_count(), 1);
}

#[test]
fn preserves_page_dimensions() {
    let source = fixture(&[(595, 842), (842, 595)], None);
    let mut document = PdfDocument::from_bytes(&source).expect("fixture loads");
    let saved = document.save_to_bytes().expect("fixture saves");
    let reopened = PdfDocument::from_bytes(&saved).expect("saved fixture reopens");

    assert_eq!(reopened.page_dimensions(0).expect("first page exists").width, 595.0);
    assert_eq!(reopened.page_dimensions(0).expect("first page exists").height, 842.0);
    assert_eq!(reopened.page_dimensions(1).expect("second page exists").width, 842.0);
    assert_eq!(reopened.page_dimensions(1).expect("second page exists").height, 595.0);
}

#[test]
fn extracts_document_metadata() {
    let document = PdfDocument::from_bytes(&fixture(&[(612, 792)], Some("Fixture title")))
        .expect("fixture loads");
    let metadata = document.metadata();

    assert_eq!(metadata.version, "1.7");
    assert_eq!(metadata.title.as_deref(), Some("Fixture title"));
    assert_eq!(metadata.author.as_deref(), Some("ModiPDFy test fixture"));
    assert_eq!(metadata.page_count, 1);
}

#[test]
fn inspects_page_objects() {
    let document = PdfDocument::from_bytes(&fixture(&[(612, 792)], None)).expect("fixture loads");
    let page = document.page_info(0).expect("page exists");
    let object = document.inspect_object(page.object_id).expect("page object inspects");

    assert_eq!(object.kind, PdfObjectKind::Dictionary);
    assert_eq!(object.pdf_type.as_deref(), Some("Page"));
}

#[test]
fn reports_detected_signature_warning() {
    let source = fixture_with_signature(&[(612, 792)], None, true);
    let document = PdfDocument::from_bytes(&source).expect("fixture loads leniently");

    assert!(document.metadata().warnings.contains(&PdfWarning::SignaturesDetected { count: 1 }));
}
