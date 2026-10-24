const DEFAULT_CAPACITY = 200;

export const CommandOperation = Object.freeze({
  ADD_ANNOTATION: "add-annotation",
  DELETE_ANNOTATION: "delete-annotation",
  MOVE_ANNOTATION: "move-annotation",
  RESIZE_ANNOTATION: "resize-annotation",
  EDIT_TEXT: "edit-text",
  CHANGE_PROPERTIES: "change-properties",
  ADD_SIGNATURE: "add-signature",
  DELETE_SIGNATURE: "delete-signature",
  MOVE_SIGNATURE: "move-signature",
  RESIZE_SIGNATURE: "resize-signature",
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function annotationOperation(annotation, add = true) {
  return add && annotation?.annotationType === "Signature"
    ? CommandOperation.ADD_SIGNATURE
    : add ? CommandOperation.ADD_ANNOTATION : annotation?.annotationType === "Signature"
      ? CommandOperation.DELETE_SIGNATURE
      : CommandOperation.DELETE_ANNOTATION;
}

export function makeAddCommand(annotation, operation = annotationOperation(annotation, true)) {
  return { type: "add", operation, annotation: clone(annotation) };
}

export function makeRemoveCommand(annotation, operation = annotationOperation(annotation, false)) {
  return { type: "remove", operation, annotation: clone(annotation) };
}

export function makeUpdateCommand(before, after, operation = CommandOperation.CHANGE_PROPERTIES) {
  return { type: "update", operation, before: clone(before), after: clone(after) };
}

export function invertCommand(command) {
  if (command.type === "add") return makeRemoveCommand(command.annotation, inverseOperation(command.operation));
  if (command.type === "remove") return makeAddCommand(command.annotation, inverseOperation(command.operation));
  return makeUpdateCommand(command.after, command.before, inverseOperation(command.operation));
}

function inverseOperation(operation) {
  const inverse = {
    [CommandOperation.ADD_ANNOTATION]: CommandOperation.DELETE_ANNOTATION,
    [CommandOperation.DELETE_ANNOTATION]: CommandOperation.ADD_ANNOTATION,
    [CommandOperation.ADD_SIGNATURE]: CommandOperation.DELETE_SIGNATURE,
    [CommandOperation.DELETE_SIGNATURE]: CommandOperation.ADD_SIGNATURE,
    [CommandOperation.MOVE_ANNOTATION]: CommandOperation.MOVE_ANNOTATION,
    [CommandOperation.RESIZE_ANNOTATION]: CommandOperation.RESIZE_ANNOTATION,
    [CommandOperation.MOVE_SIGNATURE]: CommandOperation.MOVE_SIGNATURE,
    [CommandOperation.RESIZE_SIGNATURE]: CommandOperation.RESIZE_SIGNATURE,
    [CommandOperation.EDIT_TEXT]: CommandOperation.EDIT_TEXT,
    [CommandOperation.CHANGE_PROPERTIES]: CommandOperation.CHANGE_PROPERTIES,
  };
  return inverse[operation] ?? CommandOperation.CHANGE_PROPERTIES;
}

/** Bounded logical command history. It has no rendering, PDF, or DOM dependency. */
export class CommandHistory {
  constructor({ capacity = DEFAULT_CAPACITY, onChange = () => {} } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("History capacity must be a positive integer.");
    this.capacity = capacity;
    this.onChange = onChange;
    this.#past = [];
    this.#future = [];
  }

  #past;
  #future;

  get canUndo() {
    return this.#past.length > 0;
  }

  get canRedo() {
    return this.#future.length > 0;
  }

  get size() {
    return this.#past.length;
  }

  get history() {
    return this.#past.map(clone);
  }

  get redoStack() {
    return this.#future.map(clone).reverse();
  }

  clear() {
    this.#past = [];
    this.#future = [];
    this.onChange();
  }

  commit(command) {
    const normalized = clone(command);
    if (normalized.type === "update" && equal(normalized.before, normalized.after)) return null;
    if (!["add", "remove", "update"].includes(normalized.type)) throw new TypeError("Unknown history command type.");
    if ((normalized.type === "add" || normalized.type === "remove") && !normalized.annotation) throw new TypeError("Annotation command is missing its annotation.");
    if (normalized.type === "update" && (!normalized.before || !normalized.after)) throw new TypeError("Update command is missing its states.");
    this.#past.push(normalized);
    if (this.#past.length > this.capacity) this.#past.shift();
    this.#future = [];
    this.onChange();
    return clone(normalized);
  }

  undo() {
    const command = this.#past.pop();
    if (!command) return null;
    this.#future.push(command);
    this.onChange();
    return { command: clone(command), inverse: invertCommand(command) };
  }

  redo() {
    const command = this.#future.pop();
    if (!command) return null;
    this.#past.push(command);
    this.onChange();
    return clone(command);
  }

  restoreUndo(command) {
    const pending = this.#future.pop();
    if (!pending || !equal(pending, command)) {
      if (pending) this.#future.push(pending);
      throw new Error("History undo restoration order was corrupted.");
    }
    this.#past.push(clone(command));
    this.#trimPast();
    this.onChange();
  }

  restoreRedo(command) {
    const pending = this.#past.pop();
    if (!pending || !equal(pending, command)) {
      if (pending) this.#past.push(pending);
      throw new Error("History redo restoration order was corrupted.");
    }
    this.#future.push(clone(command));
    this.onChange();
  }

  #trimPast() {
    while (this.#past.length > this.capacity) this.#past.shift();
  }
}

export { DEFAULT_CAPACITY as MAX_HISTORY };
