import React, { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { languageExtension } from './editor-language.mjs';
import { useCtrlWheelZoom } from './wheel-zoom.jsx';
import { clampZoom } from './zoom.mjs';

const amadeusTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--dsw-alias-label-primary)', backgroundColor: 'var(--dsw-alias-bg-base)' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: 'var(--amadeus-editor-font-size, 13px)' },
  '.cm-content': { caretColor: 'var(--dsw-alias-label-primary)', padding: '10px 0' },
  '.cm-gutters': { backgroundColor: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-caption)', borderRight: '.5px solid var(--dsw-alias-border-l4)' },
  '.cm-activeLine,.cm-activeLineGutter': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-button-primary-fill) 22%, transparent) !important' },
});

export function CodeEditor({ path, value, onChange, onSave, scrollportRef, historyRef, onHistoryChange, fontSize, onFontSizeChange, wrap = true, hidden = false, reveal }) {
  const holder = useRef(), viewRef = useRef(), wrapCompartment = useRef(), current = useRef(value), callbacks = useRef({ onChange, onSave });
  const historyState = useRef({ canUndo: false, canRedo: false });
  useCtrlWheelZoom(holder, delta => onFontSizeChange(currentSize => clampZoom(currentSize + delta * 10, 9, 32)));
  callbacks.current = { onChange, onSave, onHistoryChange };

  useEffect(() => {
    let disposed = false;
    (async () => {
      const language = await languageExtension(path);
      if (disposed) return;
      const saveKey = { key: 'Mod-s', preventDefault: true, run() { void callbacks.current.onSave(); return true; } };
      const reportHistory = state => {
        const next = { canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0 };
        if (next.canUndo === historyState.current.canUndo && next.canRedo === historyState.current.canRedo) return;
        historyState.current = next;
        callbacks.current.onHistoryChange?.(next);
      };
      const wrapping = new Compartment();
      wrapCompartment.current = wrapping;
      const view = new EditorView({
        parent: holder.current,
        state: EditorState.create({
          doc: current.current,
          extensions: [
            basicSetup,
            language,
            amadeusTheme,
            wrapping.of(wrap ? EditorView.lineWrapping : []),
            keymap.of([saveKey]),
            EditorView.updateListener.of(update => {
              if (update.docChanged) {
                current.current = update.state.doc.toString();
                callbacks.current.onChange(current.current);
              }
              reportHistory(update.state);
            }),
          ],
        }),
      });
      viewRef.current = view;
      if (historyRef) historyRef.current = { undo: () => undo(view), redo: () => redo(view) };
      reportHistory(view.state);
      scrollportRef?.(view.scrollDOM);
    })();
    return () => {
      disposed = true;
      scrollportRef?.(null);
      viewRef.current?.destroy();
      viewRef.current = undefined;
      if (historyRef) historyRef.current = undefined;
      historyState.current = { canUndo: false, canRedo: false };
      wrapCompartment.current = undefined;
    };
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === current.current) return;
    current.current = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    if (viewRef.current && wrapCompartment.current) viewRef.current.dispatch({ effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);
  useEffect(() => { if (!hidden) viewRef.current?.requestMeasure(); }, [hidden]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || hidden || !reveal?.text) return;
    const start = view.state.doc.toString().indexOf(reveal.text);
    if (start < 0) return;
    view.dispatch({ selection: { anchor: start, head: start + reveal.text.length }, effects: EditorView.scrollIntoView(start, { y: 'center' }) });
    view.focus();
  }, [hidden, reveal?.revision]);

  return <div ref={holder} className="amadeus-code-editor" style={{ '--amadeus-editor-font-size': `${fontSize}px` }} hidden={hidden} />;
}
