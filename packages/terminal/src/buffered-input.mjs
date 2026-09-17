// DSH 0.1.6 serializes each key behind its RPC acknowledgement. Collapse the
// keys typed during a round trip into the next ordered write instead of N RTTs.
export function bufferTerminalInput(view, { delayMs = 8, maxBytes = 65536 } = {}) {
  const original = view.write;
  let buffer = '', bufferAttachment, timer, sending = false, disposed = false;
  const flush = () => {
    timer = undefined;
    if (disposed || sending || !buffer) return;
    if (!view.state.getSnapshot().writable || view.attachmentId !== bufferAttachment) { buffer = ''; return; }
    const data = buffer; buffer = ''; sending = true;
    original.call(view, data);
    // Version-pinned adapter to the native write queue; native errors still
    // surface through the terminal model and turn writable off.
    Promise.resolve(view.writes).finally(() => {
      sending = false;
      if (!view.state.getSnapshot().writable) buffer = '';
      if (buffer && !disposed) flush();
    });
  };
  view.write = data => {
    if (disposed || !view.state.getSnapshot().writable) return;
    if (bufferAttachment !== view.attachmentId) { buffer = ''; bufferAttachment = view.attachmentId; }
    const limit = view.state.getSnapshot().environment?.maxInputBytes ?? maxBytes;
    if (new TextEncoder().encode(buffer + data).length > limit) {
      // Let native validation render its normal inputFull error. Never truncate.
      const overflow = buffer + data; buffer = ''; original.call(view, overflow); return;
    }
    buffer += data;
    if (!sending && timer === undefined) timer = setTimeout(flush, delayMs);
  };
  return () => { disposed = true; clearTimeout(timer); buffer = ''; view.write = original; };
}
