import assert from 'node:assert/strict';
import test from 'node:test';
import { history, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';

test('editor history exposes undo and redo availability', () => {
  let state = EditorState.create({ doc: 'one', extensions: [history()] });
  const view = {
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
  };
  view.dispatch({ changes: { from: 3, insert: ' two' } });
  assert.equal(undoDepth(state), 1);
  assert.equal(redoDepth(state), 0);
  assert.equal(undo(view), true);
  assert.equal(state.doc.toString(), 'one');
  assert.equal(undoDepth(state), 0);
  assert.equal(redoDepth(state), 1);
  assert.equal(redo(view), true);
  assert.equal(state.doc.toString(), 'one two');
});
