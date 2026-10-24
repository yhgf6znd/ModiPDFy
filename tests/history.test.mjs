import assert from "node:assert/strict";
import test from "node:test";

import {
  CommandHistory,
  CommandOperation,
  makeAddCommand,
  makeRemoveCommand,
  makeUpdateCommand,
} from "../web/js/history.js";
import { AnnotationStore } from "../web/js/annotation-model.js";

const annotation = (id, extra = {}) => ({
  editorId: id,
  pageIndex: 0,
  annotationType: "Text",
  position: { x: 10, y: 20 },
  bounds: { left: 10, bottom: 10, right: 100, top: 40 },
  style: { color: { red: 0, green: 0, blue: 0 }, opacity: 1, strokeWidth: 2, fontSize: 12 },
  content: { text: "note" },
  ...extra,
});

test("single undo and redo round-trip one logical command", () => {
  const history = new CommandHistory();
  const command = makeAddCommand(annotation("one"));
  history.commit(command);
  assert.equal(history.size, 1);
  assert.deepEqual(history.undo().command, command);
  assert.equal(history.canUndo, false);
  assert.deepEqual(history.redo(), command);
  assert.equal(history.canUndo, true);
});

test("multiple undo operations run in reverse commit order", () => {
  const history = new CommandHistory();
  const first = makeAddCommand(annotation("first"));
  const second = makeAddCommand(annotation("second"));
  history.commit(first);
  history.commit(second);
  assert.equal(history.undo().command.annotation.editorId, "second");
  assert.equal(history.undo().command.annotation.editorId, "first");
  assert.equal(history.canRedo, true);
});

test("new commits clear the redo branch", () => {
  const history = new CommandHistory();
  history.commit(makeAddCommand(annotation("one")));
  history.commit(makeAddCommand(annotation("two")));
  history.undo();
  history.commit(makeAddCommand(annotation("branch")));
  assert.equal(history.canRedo, false);
  assert.equal(history.history.at(-1).annotation.editorId, "branch");
});

test("delete inverse restores the exact annotation without a PDF copy", () => {
  const history = new CommandHistory();
  const removed = annotation("deleted");
  const command = makeRemoveCommand(removed, CommandOperation.DELETE_ANNOTATION);
  history.commit(command);
  const { inverse } = history.undo();
  assert.equal(inverse.type, "add");
  assert.deepEqual(inverse.annotation, removed);
  assert.equal(inverse.operation, CommandOperation.ADD_ANNOTATION);
});

test("move, resize, text, properties, and signature commands retain semantic operations", () => {
  const history = new CommandHistory();
  const before = annotation("signature", { annotationType: "Signature" });
  const after = { ...before, bounds: { ...before.bounds, right: 140 } };
  for (const operation of [
    CommandOperation.MOVE_ANNOTATION,
    CommandOperation.RESIZE_ANNOTATION,
    CommandOperation.EDIT_TEXT,
    CommandOperation.CHANGE_PROPERTIES,
    CommandOperation.ADD_SIGNATURE,
    CommandOperation.DELETE_SIGNATURE,
    CommandOperation.MOVE_SIGNATURE,
    CommandOperation.RESIZE_SIGNATURE,
  ]) {
    history.commit(makeUpdateCommand(before, after, operation));
  }
  assert.deepEqual(history.history.map((command) => command.operation), [
    CommandOperation.MOVE_ANNOTATION,
    CommandOperation.RESIZE_ANNOTATION,
    CommandOperation.EDIT_TEXT,
    CommandOperation.CHANGE_PROPERTIES,
    CommandOperation.ADD_SIGNATURE,
    CommandOperation.DELETE_SIGNATURE,
    CommandOperation.MOVE_SIGNATURE,
    CommandOperation.RESIZE_SIGNATURE,
  ]);
});

test("empty and no-op history operations do not create entries", () => {
  const history = new CommandHistory();
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
  assert.equal(history.commit(makeUpdateCommand(annotation("same"), annotation("same"))), null);
  assert.equal(history.size, 0);
});

test("capacity evicts the oldest command and bounds memory", () => {
  const history = new CommandHistory({ capacity: 2 });
  history.commit(makeAddCommand(annotation("one")));
  history.commit(makeAddCommand(annotation("two")));
  history.commit(makeAddCommand(annotation("three")));
  assert.equal(history.size, 2);
  assert.deepEqual(history.history.map((command) => command.annotation.editorId), ["two", "three"]);
});

test("history entries are defensively cloned and restoration detects corruption", () => {
  const history = new CommandHistory();
  const command = makeAddCommand(annotation("safe"));
  history.commit(command);
  const exposed = history.history;
  exposed[0].annotation.editorId = "mutated";
  assert.equal(history.history[0].annotation.editorId, "safe");
  const undone = history.undo();
  assert.throws(() => history.restoreUndo(makeAddCommand(annotation("wrong"))), /corrupted/);
  history.restoreUndo(undone.command);
  assert.equal(history.history[0].annotation.editorId, "safe");
});

test("replacing a document clears the editing session history", () => {
  const store = new AnnotationStore();
  store.commitAdd(annotation("old-document"));
  assert.equal(store.canUndo, true);
  store.replaceAll([annotation("new-document")]);
  assert.equal(store.canUndo, false);
  assert.equal(store.canRedo, false);
  assert.equal(store.values()[0].editorId, "new-document");
});
