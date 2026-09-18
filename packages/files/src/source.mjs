import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { HttpError, resolveWithin, versionOf } from './workspace.mjs';
import { upload } from './transfer.mjs';

export const DEFAULT_MAX_TEXT_BYTES = 5 * 1024 ** 2;

function decodeUtf8(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new HttpError(415, 'File is not valid UTF-8 text'); }
  if (text.includes('\0')) throw new HttpError(415, 'File contains binary data');
  return text;
}

function encodeText(text, maxBytes) {
  if (typeof text !== 'string') throw new HttpError(400, 'Text content is required');
  if (text.includes('\0')) throw new HttpError(415, 'Text contains binary data');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > maxBytes) throw new HttpError(413, 'Text file exceeds the configured size limit');
  return bytes;
}

export async function statTextSource(root, input, { maxBytes = DEFAULT_MAX_TEXT_BYTES } = {}) {
  const target = await resolveWithin(root, input);
  const info = await lstat(target);
  if (!info.isFile()) throw new HttpError(400, 'Text source is not a regular file');
  if (info.size > maxBytes) throw new HttpError(413, 'Text file exceeds the configured size limit');
  return { path: path.relative(root, target).replaceAll('\\', '/'), bytes: info.size, version: versionOf(info) };
}

export async function readTextSource(root, input, { maxBytes = DEFAULT_MAX_TEXT_BYTES } = {}) {
  const target = await resolveWithin(root, input);
  const before = await lstat(target);
  if (!before.isFile()) throw new HttpError(400, 'Text source is not a regular file');
  if (before.size > maxBytes) throw new HttpError(413, 'Text file exceeds the configured size limit');
  const bytes = await readFile(target);
  const after = await lstat(target);
  const version = versionOf(after);
  if (versionOf(before) !== version) throw new HttpError(409, 'File changed while it was being read', { version });
  return {
    path: path.relative(root, target).replaceAll('\\', '/'),
    text: decodeUtf8(bytes),
    bytes: bytes.length,
    version,
  };
}

export async function saveTextSource(root, input, text, expectedVersion, { maxBytes = DEFAULT_MAX_TEXT_BYTES } = {}) {
  if (typeof expectedVersion !== 'string' || !expectedVersion) throw new HttpError(400, 'An expected file version is required');
  const bytes = encodeText(text, maxBytes);
  await upload(root, input, Readable.from([bytes]), { maxBytes, overwriteVersion: expectedVersion });
  const target = await resolveWithin(root, input);
  const info = await lstat(target);
  return {
    path: path.relative(root, target).replaceAll('\\', '/'),
    text,
    bytes: bytes.length,
    version: versionOf(info),
  };
}

export async function readTextRequest(stream, { maxBytes = DEFAULT_MAX_TEXT_BYTES } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) throw new HttpError(413, 'Text file exceeds the configured size limit');
    chunks.push(chunk);
  }
  return decodeUtf8(Buffer.concat(chunks, total));
}
