import {
  CommandHistory,
  makeAddCommand,
  makeRemoveCommand,
  makeUpdateCommand,
  invertCommand as historyInvertCommand,
} from "./history.js";

export const AnnotationType = Object.freeze({
  TEXT: "Text",
  INK: "Ink",
  SIGNATURE: "Signature",
  HIGHLIGHT: "Highlight",
});

export const Tool = Object.freeze({
  SELECT: "select",
  TEXT: "text",
  PEN: "pen",
  HIGHLIGHT: "highlight",
  SIGNATURE: "signature",
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
  constructor({ onChange = () => {}, onCommand = () => {}, historyCapacity = 200 } = {}) {
    this.annotations = new Map();
    this.previews = new Map();
    this.commandHistory = new CommandHistory({ capacity: historyCapacity, onChange: () => this.#emit() });
    this.onChange = onChange;
    this.onCommand = onCommand;
  }

  replaceAll(annotations) {
    this.annotations = new Map(annotations.map((annotation) => [annotation.editorId, cloneAnnotation(annotation)]));
    this.previews.clear();
    this.commandHistory.clear();
    this.#emit();
  }

  get(editorId) {
    return this.previews.get(editorId) ?? this.annotations.get(editorId);
  }

  values() {
    return [...this.annotations.keys()].map((editorId) => this.get(editorId)).filter(Boolean);
  }

  /** Return only committed values; transient pointer previews are never exportable. */
  committedValues() {
    return [...this.annotations.values()];
  }

  valuesForPage(pageIndex) {
    return this.values().filter((annotation) => annotation.pageIndex === pageIndex);
  }

  get history() {
    return this.commandHistory.history;
  }

  get redoStack() {
    return this.commandHistory.redoStack;
  }

  get canUndo() {
    return this.commandHistory.canUndo;
  }

  get canRedo() {
    return this.commandHistory.canRedo;
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

  commitAdd(annotation, operation) {
    if (!annotation?.editorId || this.annotations.has(annotation.editorId)) return null;
    const command = makeAddCommand(annotation, operation);
    this.#dispatch(command);
    return command;
  }

  commitUpdate(before, after, operation) {
    if (!before?.editorId || !after?.editorId || before.editorId !== after.editorId || !this.annotations.has(before.editorId)) return null;
    const command = makeUpdateCommand(before, after, operation);
    if (!command || JSON.stringify(before) === JSON.stringify(after)) return null;
    this.#dispatch(command);
    return command;
  }

  commitRemove(annotation, operation) {
    if (!annotation?.editorId || !this.annotations.has(annotation.editorId)) return null;
    const command = makeRemoveCommand(annotation, operation);
    this.#dispatch(command);
    return command;
  }

  undo() {
    const result = this.commandHistory.undo();
    if (!result) return null;
    const { command, inverse } = result;
    this.#applyCommand(inverse);
    this.#emit();
    return { command, inverse };
  }

  redo() {
    const command = this.commandHistory.redo();
    if (!command) return null;
    this.#applyCommand(command);
    this.#emit();
    return command;
  }

  restoreRedo(command) {
    this.commandHistory.restoreRedo(command);
    this.#emit();
  }

  restoreUndo(command) {
    this.commandHistory.restoreUndo(command);
    this.#emit();
  }

  restoreCommand(command) {
    this.#applyCommand(command);
    this.#emit();
  }

  #dispatch(command) {
    this.#applyCommand(command);
    this.#emit();
    const persistence = this.onCommand(command);
    if (persistence && typeof persistence.then === "function") {
      void persistence.then(() => this.commandHistory.commit(command)).catch(() => {});
    } else {
      this.commandHistory.commit(command);
    }
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
  return historyInvertCommand(command);
}
