use lopdf::{
    Document, EncryptionState, EncryptionVersion, Object, Permissions, Stream, dictionary,
};
use modipdfy_core::{
    AnnotationContent, AnnotationId, AnnotationStyle, HighlightAnnotation, InkAnnotation, PdfColor,
    PdfDocument, PdfError, PdfPoint, PdfQuad, PdfRectangle, SignatureAnnotation, SignatureStroke,
    TextAnnotation,
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

fn shared_annotation_fixture() -> Vec<u8> {
    let mut document = Document::with_version("1.7");
    let pages_id = document.new_object_id();
    let annotation_id = document.add_object(dictionary! {
        "Type" => "Annot",
        "Subtype" => "FreeText",
        "Rect" => vec![30.into(), 40.into(), 45.into(), 55.into()],
        "NM" => Object::string_literal("shared-note"),
        "Contents" => Object::string_literal("shared annotation"),
    });
    let annots_id = document.add_object(vec![annotation_id.into()]);
    let page_one = document.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        "Annots" => annots_id,
    });
    let page_two = document.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        "Annots" => annots_id,
    });
    document.objects.insert(
        pages_id,
        dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_one.into(), page_two.into()],
            "Count" => 2,
        }
        .into(),
    );
    let catalog_id = document.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    document.trailer.set("Root", catalog_id);
    let mut bytes = Vec::new();
    document.save_to(&mut bytes).expect("shared fixture should serialize");
    bytes
}

fn encrypted_fixture() -> Vec<u8> {
    let mut document = Document::load_mem(&annotation_fixture(false)).expect("source loads");
    let id = vec![0x42u8; 16];
    document
        .trailer
        .set("ID", vec![Object::string_literal(id.clone()), Object::string_literal(id)]);
    let state = EncryptionState::try_from(EncryptionVersion::V2 {
        document: &mut document,
        owner_password: "owner",
        user_password: "",
        key_length: 128,
        permissions: Permissions::PRINTABLE,
    })
    .expect("encryption state builds");
    document.encrypt(&state).expect("document encrypts");
    let mut bytes = Vec::new();
    document.save_to(&mut bytes).expect("encrypted fixture saves");
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
    assert!(annotations.iter().all(|annotation| annotation.page_index == 0));
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
        if dictionary.get(b"Subtype").and_then(Object::as_name).ok() != Some(b"Text".as_slice()) {
            assert_eq!(
                dictionary
                    .get(b"P")
                    .expect("page association")
                    .as_reference()
                    .expect("page reference"),
                page_id,
                "editor annotations must point back to their page"
            );
        }
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
fn removing_shared_annotations_uses_copy_on_write() {
    let source = shared_annotation_fixture();
    let mut document = PdfDocument::from_bytes(&source).expect("shared fixture loads");
    let id = AnnotationId::new("shared-note").expect("valid id");

    document.remove_annotation(&id).expect("shared annotation removes from first page");
    let saved = document.save_to_bytes().expect("shared fixture saves");
    let reopened = Document::load_mem(&saved).expect("shared fixture reopens");
    let pages = reopened.get_pages();
    assert_eq!(pages.len(), 2);

    let first_page = reopened.get_dictionary(pages[&1]).expect("first page");
    let first_annots = first_page.get(b"Annots").expect("first page annotations");
    assert!(matches!(first_annots, Object::Array(entries) if entries.is_empty()));

    let second_page = reopened.get_dictionary(pages[&2]).expect("second page");
    let shared_annots = second_page
        .get(b"Annots")
        .expect("second page annotations")
        .as_reference()
        .expect("second page retains shared annotation array");
    let entries = reopened
        .get_object(shared_annots)
        .expect("shared annotation array")
        .as_array()
        .expect("shared annotation entries");
    assert_eq!(entries.len(), 1);
    let annotation_id = entries[0].as_reference().expect("annotation object reference");
    assert!(reopened.get_dictionary(annotation_id).is_ok(), "shared annotation object was deleted");
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

#[test]
fn encrypted_documents_are_not_mutated() {
    let source = encrypted_fixture();
    let mut document =
        PdfDocument::from_bytes(&source).expect("encrypted fixture loads with empty user password");
    assert!(document.metadata().was_encrypted);
    assert!(matches!(
        document.add_text_annotation(text_annotation()),
        Err(PdfError::EncryptedDocument { operation: "edit" })
    ));
    assert_eq!(document.save_to_bytes().expect("untouched encrypted bytes return"), source);
}

#[test]
fn visual_signature_is_native_ink_and_preserves_page_content() {
    let source = annotation_fixture(false);
    let original_content = {
        let raw = Document::load_mem(&source).expect("source reopens");
        let page_id = raw.get_pages().get(&1).copied().expect("page id");
        raw.get_page_content(page_id)
    };
    let mut document = PdfDocument::from_bytes(&source).expect("fixture loads");
    let mut ink = ink_annotation();
    ink.editor_id = AnnotationId::new("signature-1").expect("valid signature id");
    let signature = SignatureAnnotation {
        editor_id: ink.editor_id,
        page_index: ink.page_index,
        position: ink.position,
        bounds: ink.bounds,
        style: ink.style,
        strokes: vec![
            SignatureStroke { points: ink.paths[0].clone(), style: ink.style },
            SignatureStroke {
                points: vec![
                    PdfPoint { x: 65.0, y: 85.0 },
                    PdfPoint { x: 85.0, y: 105.0 },
                    PdfPoint { x: 95.0, y: 95.0 },
                ],
                style: AnnotationStyle {
                    color: PdfColor { red: 0.8, green: 0.1, blue: 0.2 },
                    stroke_width: 5.0,
                    ..ink.style
                },
            },
        ],
    };
    let mut ordinary_ink = ink_annotation();
    ordinary_ink.editor_id = AnnotationId::new("signature-ordinary-ink").expect("valid id");
    document.add_ink_annotation(ordinary_ink).expect("ordinary ink adds");
    document.add_signature_annotation(signature).expect("signature adds");

    let listed = document.list_annotations().expect("signature lists");
    assert_eq!(listed.len(), 2);
    let listed_signature = listed
        .iter()
        .find(|annotation| annotation.editor_id.as_str() == "signature-1")
        .expect("signature listing");
    assert!(
        listed.iter().any(|annotation| annotation.editor_id.as_str() == "signature-ordinary-ink"
            && annotation.annotation_type == modipdfy_core::AnnotationType::Ink)
    );
    match &listed_signature.content {
        AnnotationContent::Signature { strokes } => {
            assert_eq!(strokes.len(), 2);
            assert_eq!(strokes[1].style.stroke_width, 5.0);
            assert!((strokes[1].style.color.red - 0.8).abs() < 0.001);
        }
        other => panic!("expected signature content, got {other:?}"),
    }

    let saved = document.save_to_bytes().expect("signature saves");
    let reopened_core = PdfDocument::from_bytes(&saved).expect("signature reopens");
    let reopened_signature = reopened_core
        .list_annotations()
        .expect("reopened signature")
        .into_iter()
        .find(|annotation| annotation.editor_id.as_str() == "signature-1")
        .expect("reopened signature listing");
    match &reopened_signature.content {
        AnnotationContent::Signature { strokes } => assert_eq!(strokes[1].style.stroke_width, 5.0),
        other => panic!("expected reopened signature content, got {other:?}"),
    }
    let reopened = Document::load_mem(&saved).expect("saved PDF reopens");
    let page_id = reopened.get_pages().get(&1).copied().expect("page id");
    let entries = reopened
        .get_dictionary(page_id)
        .expect("page dictionary")
        .get(b"Annots")
        .expect("annots")
        .as_array()
        .expect("annots array");
    let signature_id = entries
        .iter()
        .map(|entry| entry.as_reference().expect("annotation reference"))
        .map(|id| reopened.get_dictionary(id).expect("annotation dictionary"))
        .find(|dictionary| {
            dictionary.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Ink")
        })
        .expect("signature annotation");
    assert_eq!(signature_id.get(b"Subtype").expect("subtype").as_name().expect("name"), b"Ink");
    assert!(signature_id.get(b"InkList").is_ok());
    assert_eq!(reopened.get_page_content(page_id), original_content);
}
