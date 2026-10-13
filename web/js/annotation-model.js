const MAX_HISTORY = 200;

export const AnnotationType = Object.freeze({
  TEXT: "Text",
  INK: "Ink",
  HIGHLIGHT: "Highlight",
});

export const Tool = Object.freeze({
  SELECT: "select",
  TEXT: "text",
  PEN: "pen",
  HIGHLIGHT: "highlight",
  ERASER: "eraser",
});

export function cloneAnnotation(annotation) {
  return JSON.parse(JSON.stringify(annotation));
}

export function createEditorId() {
  if (globalThis.crypto?.randomUUID) {
    return `editor-${globalThis.crypto.randomUUID()}`;
  }
  return `editor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeStyle({ color = { red: 0, green: 0, blue: 0 }, opacity = 1, strokeWidth = 2, fontSize = 12 } = {}) {
  return {
    color: { red: color.red, green: color.green, blue: color.blue },
    opacity,
    strokeWidth,
    fontSize,
  };
}

export function makeBounds(left, bottom, right, top) {
  return {
    left: Math.min(left, right),
    bottom: Math.min(bottom, top),
    right: Math.max(left, right),
    top: Math.max(bottom, top),
  };
}

export function annotationContent(annotation) {
  return annotation.content;
}

/**
 * Browser-side projection and command history for Rust-backed annotations.
 * Preview values never enter history and are cleared when a pointer gesture ends.
 */
export class AnnotationStore {
  constructor({ onChange = () => {}, onCommand = () => {} } = {}) {
    this.annotations = new Map();
    this.previews = new Map();
    this.history = [];
    this.redoStack = [];
    this.onChange = onChange;
    this.onCommand = onCommand;
  }

  replaceAll(annotations) {
    this.annotations = new Map(annotations.map((annotation) => [annotation.editorId, cloneAnnotation(annotation)]));
    this.previews.clear();
    this.history = [];
    this.redoStack = [];
    this.#emit();
  }

  get(editorId) {
    return this.previews.get(editorId) ?? this.annotations.get(editorId);
  }

  values() {
    return [...this.annotations.keys()].map((editorId) => this.get(editorId)).filter(Boolean);
  }

  valuesForPage(pageIndex) {
    return this.values().filter((annotation) => annotation.pageIndex === pageIndex);
  }

  setPreview(editorId, annotation) {
    if (!this.annotations.has(editorId)) {
      return;
    }
    this.previews.set(editorId, cloneAnnotation(annotation));
    this.#emit();
  }

  clearPreview(editorId) {
    if (this.previews.delete(editorId)) {
      this.#emit();
    }
  }

  commitAdd(annotation) {
    const command = { type: "add", annotation: cloneAnnotation(annotation) };
    this.#applyCommand(command);
    this.#record(command);
    this.onCommand(command);
    return command;
  }

  commitUpdate(before, after) {
    const command = { type: "update", before: cloneAnnotation(before), after: cloneAnnotation(after) };
    this.#applyCommand(command);
    this.#record(command);
    this.onCommand(command);
    return command;
  }

  commitRemove(annotation) {
    const command = { type: "remove", annotation: cloneAnnotation(annotation) };
    this.#applyCommand(command);
    this.#record(command);
    this.onCommand(command);
    return command;
  }

  undo() {
    const command = this.history.pop();
    if (!command) {
      return null;
    }
    const inverse = invertCommand(command);
    this.#applyCommand(inverse);
    this.redoStack.push(command);
    this.#emit();
    return { command, inverse };
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) {
      return null;
    }
    this.#applyCommand(command);
    this.history.push(command);
    this.#emit();
    return command;
  }

  restoreCommand(command) {
    this.#applyCommand(command);
    this.#emit();
  }

  #record(command) {
    this.history.push(command);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
    this.redoStack = [];
    this.#emit();
  }

  #applyCommand(command) {
    if (command.type === "add") {
      this.annotations.set(command.annotation.editorId, cloneAnnotation(command.annotation));
      this.previews.delete(command.annotation.editorId);
    } else if (command.type === "update") {
      this.annotations.set(command.after.editorId, cloneAnnotation(command.after));
      this.previews.delete(command.after.editorId);
    } else if (command.type === "remove") {
      this.annotations.delete(command.annotation.editorId);
      this.previews.delete(command.annotation.editorId);
    }
  }

  #emit() {
    this.onChange(this.values());
  }
}

export function invertCommand(command) {
  if (command.type === "add") {
    return { type: "remove", annotation: cloneAnnotation(command.annotation) };
  }
  if (command.type === "remove") {
    return { type: "add", annotation: cloneAnnotation(command.annotation) };
  }
  return { type: "update", before: cloneAnnotation(command.after), after: cloneAnnotation(command.before) };
}
