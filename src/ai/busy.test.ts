import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generate, setPause, setTransport } from './gemini';
import { FALLBACK_GEMINI_MODEL } from './config';
import { uploadVideo } from './video';
import { importRecipe } from './recipe';

vi.mock('../app/prefs', () => ({ prefs: { geminiKey: () => 'test-key', geminiModel: () => '' } }));

const ok = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] }));
const busy = () =>
  new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), {
    status: 503,
  });
const ask = { contents: [{ role: 'user' as const, parts: [{ text: 'hi', thoughtSignature: 'sig' }] }] };

beforeEach(() => setPause(() => Promise.resolve()));
afterEach(() => {
  setTransport((u, i) => fetch(u, i));
  vi.unstubAllGlobals();
});

describe('Gemini busy (high demand)', () => {
  it('retries the same model, then answers', async () => {
    const urls: string[] = [];
    let n = 0;
    setTransport(async (u) => {
      urls.push(u);
      return ++n < 3 ? busy() : ok('hello');
    });
    expect((await generate(ask)).text).toBe('hello');
    expect(urls).toHaveLength(3);
    expect(urls.every((u) => !u.includes(FALLBACK_GEMINI_MODEL))).toBe(true);
  });

  it('falls back to the lighter model once, without the other model’s thought signatures', async () => {
    const calls: { url: string; body: string }[] = [];
    setTransport(async (u, i) => {
      calls.push({ url: u, body: String(i.body) });
      return u.includes(FALLBACK_GEMINI_MODEL) ? ok('from lite') : busy();
    });
    expect((await generate(ask)).text).toBe('from lite');
    expect(calls).toHaveLength(4);
    expect(calls[3].body).not.toContain('thoughtSignature');
  });

  it('gives a plain message when everything is busy', async () => {
    setTransport(async () => busy());
    await expect(generate(ask)).rejects.toMatchObject({
      kind: 'busy',
      message: expect.stringMatching(/very busy/),
    });
  });
});

describe('recipe videos', () => {
  it('uploads with a neutral name, waits until processed, and sends the file to Gemini', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    let polls = 0;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      if (url.endsWith('/upload/v1beta/files'))
        return new Response('{}', {
          headers: {
            'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=1',
          },
        });
      if (url.includes('upload_id'))
        return new Response(
          JSON.stringify({ file: { name: 'files/abc', uri: 'https://g/files/abc', state: 'PROCESSING' } }),
        );
      if (url.endsWith('/files/abc'))
        return new Response(JSON.stringify({ state: ++polls > 1 ? 'ACTIVE' : 'PROCESSING' }));
      throw new Error('unexpected ' + url);
    });
    const file = new File([new Uint8Array(10)], 'my holiday 2026.mp4', { type: 'video/mp4' });
    const v = await uploadVideo(file);
    expect(v).toEqual({ name: 'files/abc', uri: 'https://g/files/abc', mimeType: 'video/mp4' });
    expect(String(seen[0].init?.body)).toContain('recipe video');
    expect(String(seen[0].init?.body)).not.toContain('holiday');
    expect((seen[0].init?.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');

    let sent = '';
    setTransport(async (_u, i) => {
      sent = String(i.body);
      return ok(
        JSON.stringify({ title: 'Pasta', servings: 2, ingredients: [], steps: [{ text: 'Boil water.' }] }),
      );
    });
    await importRecipe({ video: v }, [], []).catch(() => undefined);
    expect(sent).toContain('"fileUri":"https://g/files/abc"');
    expect(sent).toContain('screen recording');
  });

  it('refuses huge files before uploading', async () => {
    const big = { size: 300 * 1024 * 1024, type: 'video/mp4' } as File;
    await expect(uploadVideo(big)).rejects.toMatchObject({ kind: 'too-big' });
  });
});
