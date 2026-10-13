use lopdf::{Document, Object, Stream, dictionary};
use modipdfy_core::{
    AnnotationContent, AnnotationId, AnnotationStyle, HighlightAnnotation, InkAnnotation, PdfColor,
    PdfDocument, PdfError, PdfPoint, PdfQuad, PdfRectangle, TextAnnotation,
};

fn annotation_fixture(include_signature: bool) -> Vec<u8> {
    let mut document = Document::with_version("1.7");
    let pages_id = document.new_object_id();
    let content_id =
        document.add_object(Stream::new(dictionary! {}, b"q 0 0 1 rg 10 10 50 50 re f Q".to_vec()));
    let existing_id = document.add_object(dictionary! {
        "Type" => "Annot",
        "Subtype" => "Text",
        "Rect" => vec![30.into(), 40.into(), 45.into(), 55.into()],
        "NM" => Object::string_literal("existing-note"),
        "Contents" => Object::string_literal("existing annotation"),
    });
    let page_id = document.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![10.into(), 20.into(), 210.into(), 320.into()],
        "CropBox" => vec![20.into(), 40.into(), 180.into(), 280.into()],
        "Rotate" => 90,
        "Contents" => content_id,
        "Annots" => vec![existing_id.into()],
    });
    document.objects.insert(
        pages_id,
        dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        }
        .into(),
    );
    let catalog_id = document.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    document.trailer.set("Root", catalog_id);
    if include_signature {
        document.add_object(dictionary! {
            "Type" => "Sig",
            "ByteRange" => vec![0.into(), 1.into(), 2.into(), 3.into()],
        });
    }
    let mut bytes = Vec::new();
    document.save_to(&mut bytes).expect("fixture should serialize");
    bytes
}

fn bounds() -> PdfRectangle {
    PdfRectangle { left: 40.0, bottom: 60.0, right: 120.0, top: 120.0 }
}

fn style() -> AnnotationStyle {
    AnnotationStyle {
        color: PdfColor { red: 0.2, green: 0.4, blue: 0.8 },
        opacity: 0.65,
        stroke_width: 3.0,
        font_size: 14.0,
    }
}

fn text_annotation() -> TextAnnotation {
    TextAnnotation {
        editor_id: AnnotationId::new("text-1").expect("valid id"),
        page_index: 0,
        position: PdfPoint { x: 40.0, y: 120.0 },
        bounds: bounds(),
        style: style(),
        text: "Hello from ModiPDFy".to_string(),
    }
}

fn ink_annotation() -> InkAnnotation {
    InkAnnotation {
        editor_id: AnnotationId::new("ink-1").expect("valid id"),
        page_index: 0,
        position: PdfPoint { x: 60.0, y: 80.0 },
        bounds: PdfRectangle { left: 60.0, bottom: 80.0, right: 100.0, top: 110.0 },
        style: style(),
        paths: vec![vec![
            PdfPoint { x: 60.0, y: 80.0 },
            PdfPoint { x: 80.0, y: 100.0 },
            PdfPoint { x: 100.0, y: 90.0 },
        ]],
    }
}

fn highlight_annotation() -> HighlightAnnotation {
    HighlightAnnotation {
        editor_id: AnnotationId::new("highlight-1").expect("valid id"),
        page_index: 0,
        position: PdfPoint { x: 50.0, y: 150.0 },
        bounds: PdfRectangle { left: 50.0, bottom: 150.0, right: 160.0, top: 180.0 },
        style: AnnotationStyle { color: PdfColor::YELLOW, opacity: 0.4, ..style() },
        quads: vec![PdfQuad {
            top_left: PdfPoint { x: 50.0, y: 180.0 },
            top_right: PdfPoint { x: 160.0, y: 180.0 },
            bottom_left: PdfPoint { x: 50.0, y: 150.0 },
            bottom_right: PdfPoint { x: 160.0, y: 150.0 },
        }],
    }
}

#[test]
fn adds_reopens_and_inspects_native_annotation_objects() {
    let source = annotation_fixture(false);
    let mut document = PdfDocument::from_bytes(&source).expect("fixture loads");
    let original_content = {
        let page_id = document.page_info(0).expect("page exists").object_id;
        let raw = lopdf::Document::load_mem(&source).expect("source reopens");
        raw.get_page_content(page_id)
    };

    document.add_text_annotation(text_annotation()).expect("text adds");
    document.add_ink_annotation(ink_annotation()).expect("ink adds");
    document.add_highlight_annotation(highlight_annotation()).expect("highlight adds");

    let annotations = document.list_annotations().expect("annotations list");
    assert_eq!(annotations.len(), 3);
    assert!(
        annotations
            .iter()
            .any(|annotation| matches!(annotation.content, AnnotationContent::Text { .. }))
    );
    assert!(
        annotations
            .iter()
            .any(|annotation| matches!(annotation.content, AnnotationContent::Ink { .. }))
    );
    assert!(
        annotations
            .iter()
            .any(|annotation| matches!(annotation.content, AnnotationContent::Highlight { .. }))
    );

    let saved = document.save_to_bytes().expect("annotated PDF saves");
    let reopened_core = PdfDocument::from_bytes(&saved).expect("annotated PDF reopens in core");
    assert_eq!(reopened_core.list_annotations().expect("reopened annotations").len(), 3);
    assert_eq!(
        reopened_core.page_info(0).expect("rotated page exists").dimensions.rotation_degrees,
        90
    );

    let reopened = Document::load_mem(&saved).expect("annotated PDF reopens in lopdf");
    let page_id = reopened.get_pages().get(&1).copied().expect("page id");
    let page = reopened.get_dictionary(page_id).expect("page dictionary");
    let entries = page.get(b"Annots").expect("annots entry").as_array().expect("annots array");
    assert_eq!(entries.len(), 4, "existing annotation must remain");
    let mut subtypes = Vec::new();
    for entry in entries {
        let annotation_id = entry.as_reference().expect("annotation is indirect");
        let dictionary = reopened.get_dictionary(annotation_id).expect("annotation dictionary");
        subtypes.push(
            dictionary.get(b"Subtype").expect("subtype").as_name().expect("subtype name").to_vec(),
        );
        if matches!(
            dictionary.get(b"Subtype").and_then(Object::as_name).ok(),
            Some(b"FreeText" | b"Ink" | b"Highlight")
        ) {
            assert!(
                dictionary.get(b"AP").and_then(Object::as_dict).is_ok(),
                "editor annotations have AP dictionaries"
            );
            let appearance = dictionary
                .get(b"AP")
                .expect("appearance")
                .as_dict()
                .expect("appearance dictionary")
                .get(b"N")
                .expect("normal appearance")
                .as_reference()
                .expect("appearance stream reference");
            let appearance_stream = reopened
                .get_object(appearance)
                .expect("appearance object")
                .as_stream()
                .expect("appearance stream");
            assert!(String::from_utf8_lossy(&appearance_stream.content).contains("/GS1 gs"));
        }
        if dictionary.get(b"Subtype").and_then(Object::as_name).ok()
            == Some(b"Highlight".as_slice())
        {
            let quad_points = dictionary
                .get(b"QuadPoints")
                .expect("quad points")
                .as_array()
                .expect("quad point array");
            assert_eq!(quad_points.len(), 8);
            let rect = dictionary.get(b"Rect").expect("rect").as_array().expect("rect array");
            assert_eq!(rect[0].as_float().expect("left"), 50.0);
            assert_eq!(rect[1].as_float().expect("bottom"), 150.0);
        }
    }
    assert!(subtypes.iter().any(|subtype| subtype == b"FreeText"));
    assert!(subtypes.iter().any(|subtype| subtype == b"Ink"));
    assert!(subtypes.iter().any(|subtype| subtype == b"Highlight"));
    assert_eq!(
        reopened.get_page_content(page_id),
        original_content,
        "page content must be preserved"
    );
}

#[test]
fn removes_only_the_requested_annotation() {
    let mut document = PdfDocument::from_bytes(&annotation_fixture(false)).expect("fixture loads");
    document.add_text_annotation(text_annotation()).expect("text adds");
    document.add_ink_annotation(ink_annotation()).expect("ink adds");
    let id = AnnotationId::new("text-1").expect("valid id");
    document.remove_annotation(&id).expect("text removes");
    let annotations = document.list_annotations().expect("annotations list");
    assert_eq!(annotations.len(), 1);
    assert_eq!(annotations[0].editor_id.as_str(), "ink-1");
    assert!(matches!(document.remove_annotation(&id), Err(PdfError::AnnotationNotFound { .. })));
}

#[test]
fn rejects_bad_annotation_input_and_duplicate_ids() {
    assert!(matches!(AnnotationId::new(""), Err(PdfError::InvalidAnnotationId { .. })));
    let mut document = PdfDocument::from_bytes(&annotation_fixture(false)).expect("fixture loads");
    let mut invalid = text_annotation();
    invalid.text.clear();
    assert!(matches!(
        document.add_text_annotation(invalid),
        Err(PdfError::InvalidAnnotationContent { .. })
    ));
    document.add_text_annotation(text_annotation()).expect("text adds");
    assert!(matches!(
        document.add_text_annotation(text_annotation()),
        Err(PdfError::DuplicateAnnotationId { .. })
    ));
    let mut unsupported_conflict = text_annotation();
    unsupported_conflict.editor_id = AnnotationId::new("existing-note").expect("valid id");
    assert!(matches!(
        document.add_text_annotation(unsupported_conflict),
        Err(PdfError::DuplicateAnnotationId { .. })
    ));
    let mut invalid_ink = ink_annotation();
    invalid_ink.paths = vec![vec![PdfPoint { x: 0.0, y: 0.0 }]];
    assert!(matches!(
        document.add_ink_annotation(invalid_ink),
        Err(PdfError::InvalidAnnotationContent { .. })
    ));
    let mut invalid_highlight = highlight_annotation();
    invalid_highlight.quads.clear();
    assert!(matches!(
        document.add_highlight_annotation(invalid_highlight),
        Err(PdfError::InvalidAnnotationContent { .. })
    ));
}

#[test]
fn signed_documents_are_not_mutated() {
    let mut document = PdfDocument::from_bytes(&annotation_fixture(true)).expect("fixture loads");
    assert!(matches!(
        document.add_text_annotation(text_annotation()),
        Err(PdfError::SignedDocument { operation: "edit" })
    ));
}
