import { parseEditableAddress } from '../../reader/src/file-address.mjs';

const binary = new Set(['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','png','jpg','jpeg','gif','webp','bmp','ico','avif','mp3','mp4','webm','mov','wav','ogg','zip','gz','tar','7z','rar','wasm','exe','dll','so','woff','woff2','ttf','otf','bin']);
export function editableResource(address) {
  try {
    const file = parseEditableAddress(address);
    return !binary.has(file.path.split('.').pop().toLowerCase());
  } catch { return false; }
}

export function installEditorRouting(sidebar, kind) {
  const resource = sidebar.openResource, resourceIn = sidebar.openResourceIn;
  function open(address, options = {}) {
    if (editableResource(address) && !options.kind) {
      return sidebar.openTab(kind, { ...options, params: { ...options.params, address } });
    }
    return resource.call(sidebar, address, options);
  }
  function openIn(sessionId, address, options = {}) {
    if (editableResource(address) && !options.kind) {
      return sidebar.openTabIn(sessionId, kind, { ...options, params: { ...options.params, address } });
    }
    return resourceIn.call(sidebar, sessionId, address, options);
  }
  sidebar.openResource = open;
  sidebar.openResourceIn = openIn;
  return () => {
    if (sidebar.openResource === open) sidebar.openResource = resource;
    if (sidebar.openResourceIn === openIn) sidebar.openResourceIn = resourceIn;
  };
}
