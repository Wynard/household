// Recipe videos (e.g. a screen recording of a reel, with sound): uploaded to
// Gemini's Files API with this phone's key, read once, then deleted. Videos are
// too big to send inline, and Google deletes uploads after 48 hours anyway;
// we delete it as soon as the recipe is read.
import { GEMINI_BASE } from './config';
import { GeminiError, MESSAGES, geminiKey } from './gemini';

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const UPLOAD_BASE = GEMINI_BASE.replace('/v1beta', '/upload/v1beta');

export interface UploadedVideo {
  /** "files/abc123" */
  name: string;
  uri: string;
  mimeType: string;
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

async function call(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, referrerPolicy: 'no-referrer' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new GeminiError('network', MESSAGES.network);
  }
  if (res.ok) return res;
  if (res.status === 429) throw new GeminiError('rate', MESSAGES.rate);
  if (res.status === 401 || res.status === 403) throw new GeminiError('key', MESSAGES.key);
  if (res.status === 413) throw new GeminiError('too-big', 'That video is too big. Record a shorter part.');
  if (res.status >= 500) throw new GeminiError('busy', MESSAGES.busy);
  throw new GeminiError('other', MESSAGES.other);
}

/** Uploads a video and waits until Gemini has processed it. */
export async function uploadVideo(
  file: File,
  opts: { signal?: AbortSignal; onProgress?: (text: string) => void } = {},
): Promise<UploadedVideo> {
  const key = geminiKey();
  if (!key) throw new GeminiError('no-key', MESSAGES['no-key']);
  if (file.size > MAX_VIDEO_BYTES)
    throw new GeminiError(
      'too-big',
      'That video is too big. Record just the part with the recipe (a minute or two).',
    );
  const mimeType = file.type || 'video/mp4';
  // 1. start a resumable upload
  const start = await call(`${UPLOAD_BASE}/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(file.size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    // a neutral name: the file's own name can say anything
    body: JSON.stringify({ file: { display_name: 'recipe video' } }),
    signal: opts.signal,
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl?.startsWith(UPLOAD_BASE)) throw new GeminiError('other', MESSAGES.other);
  // 2. send the bytes
  const done = await call(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: file,
    signal: opts.signal,
  });
  const meta = ((await done.json()) as { file?: { name?: string; uri?: string; state?: string } }).file;
  if (!meta?.name || !meta.uri) throw new GeminiError('other', MESSAGES.other);
  const video = { name: meta.name, uri: meta.uri, mimeType };
  // 3. wait until it's processed (usually a few seconds)
  let state = meta.state;
  for (let i = 0; state !== 'ACTIVE'; i++) {
    if (state === 'FAILED' || i > 60) {
      void deleteVideo(video);
      throw new GeminiError('other', "Gemini couldn't process that video. Try recording it again.");
    }
    opts.onProgress?.('Gemini is getting the video ready…');
    await wait(2000, opts.signal);
    const r = await call(`${GEMINI_BASE}/${video.name}`, {
      headers: { 'x-goog-api-key': key },
      signal: opts.signal,
    });
    state = ((await r.json()) as { state?: string }).state;
  }
  return video;
}

/** Best effort: Google removes uploads after 48 hours anyway. */
export async function deleteVideo(video: UploadedVideo): Promise<void> {
  const key = geminiKey();
  if (!key || !/^files\/[\w-]+$/.test(video.name)) return;
  try {
    await fetch(`${GEMINI_BASE}/${video.name}`, {
      method: 'DELETE',
      headers: { 'x-goog-api-key': key },
      referrerPolicy: 'no-referrer',
    });
  } catch {
    /* expires by itself */
  }
}
