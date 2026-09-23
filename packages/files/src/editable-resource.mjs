import { parseEditableAddress } from '../../reader/src/file-address.mjs';

const binary = new Set(['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','png','jpg','jpeg','gif','webp','bmp','ico','avif','mp3','mp4','webm','mov','wav','ogg','zip','gz','tar','7z','rar','wasm','exe','dll','so','woff','woff2','ttf','otf','bin']);

export function editableResource(address) {
  try {
    const file = parseEditableAddress(address);
    return !binary.has(file.path.split('.').pop().toLowerCase());
  } catch { return false; }
}
