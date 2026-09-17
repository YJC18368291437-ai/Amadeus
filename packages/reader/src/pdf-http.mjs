import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileVersion } from './convert.mjs';

// Return null for unsupported/malformed ranges (serve the full representation),
// false for unsatisfiable ranges, or the inclusive byte interval.
export function byteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) { const suffix = Number(match[2]); if (!suffix) return false; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end || !size) return false;
  return { start, end };
}

export async function sendPdf(req, res, source) {
  const file = await open(source);
  try {
    const info = await file.stat({ bigint: true }), size = Number(info.size);
    const etag = `"${fileVersion(info)}"`;
    const headers = {
      'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', ETag: etag,
      'Cache-Control': 'private, no-cache, must-revalidate, no-transform',
      'Content-Encoding': 'identity', 'X-Content-Type-Options': 'nosniff',
    };
    if (req.headers['if-none-match']?.split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*')) {
      res.writeHead(304, headers); res.end(); return;
    }
    const range = req.method !== 'GET' || (req.headers['if-range'] && req.headers['if-range'] !== etag) ? null : byteRange(req.headers.range, size);
    if (range === false) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 }); res.end(); return; }
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    headers['Content-Length'] = range ? range.end - range.start + 1 : size;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    await pipeline(file.createReadStream({ autoClose: false, ...(range || {}) }), res);
  } finally { await file.close(); }
}
