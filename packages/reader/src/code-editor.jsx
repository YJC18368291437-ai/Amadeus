import React, { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { languageExtension } from './editor-language.mjs';

const cofolioTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--dsw-alias-label-primary)', backgroundColor: 'var(--dsw-alias-bg-base)' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)' },
  '.cm-content': { caretColor: 'var(--dsw-alias-label-primary)', padding: '10px 0' },
  '.cm-gutters': { backgroundColor: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-caption)', borderRight: '.5px solid var(--dsw-alias-border-l4)' },
  '.cm-activeLine,.cm-activeLineGutter': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-button-primary-fill) 22%, transparent) !important' },
});

export function CodeEditor({ path, value, onChange, onSave, scrollportRef, wrap = true }) {
  const holder = useRef(), viewRef = useRef(), wrapCompartment = useRef(), current = useRef(value), callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };

  useEffect(() => {
    let disposed = false;
    (async () => {
      const language = await languageExtension(path);
      if (disposed) return;
      const saveKey = { key: 'Mod-s', preventDefault: true, run() { void callbacks.current.onSave(); return true; } };
      const wrapping = new Compartment();
      wrapCompartment.current = wrapping;
      const view = new EditorView({
        parent: holder.current,
        state: EditorState.create({
          doc: current.current,
          extensions: [
            basicSetup,
            language,
            cofolioTheme,
            wrapping.of(wrap ? EditorView.lineWrapping : []),
            keymap.of([saveKey]),
            EditorView.updateListener.of(update => {
              if (!update.docChanged) return;
              current.current = update.state.doc.toString();
              callbacks.current.onChange(current.current);
            }),
          ],
        }),
      });
      viewRef.current = view;
      scrollportRef?.(view.scrollDOM);
    })();
    return () => {
      disposed = true;
      scrollportRef?.(null);
      viewRef.current?.destroy();
      viewRef.current = undefined;
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

  return <div ref={holder} className="cf-code-editor" />;
}
