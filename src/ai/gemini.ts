// Gemini REST client (4.5): called from the browser with this phone's key
// (sent in a header, never in the URL). Structured output with a JSON schema,
// validated again with zod. Errors become plain-language GeminiErrors.
import type { z } from 'zod';
import { prefs } from '../app/prefs';
import { DEFAULT_GEMINI_MODEL, GEMINI_BASE } from './config';
import { UNTRUSTED_RULE } from './privacy';

export type GeminiErrorKind =
  'no-key' | 'rate' | 'key' | 'model' | 'network' | 'blocked' | 'bad-json' | 'too-big' | 'other';

export class GeminiError extends Error {
  constructor(
    public kind: GeminiErrorKind,
    message: string,
    /** raw model text (bad-json) so the user can enter it by hand */
    public raw?: string,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export const MESSAGES: Record<GeminiErrorKind, string> = {
  'no-key': 'Add your Gemini key in Settings › This phone first.',
  rate: "Gemini's free limit was reached, try again in a minute.",
  key: "Gemini didn't accept the key on this phone. Check it in Settings › This phone.",
  model: "The Gemini model set on this phone isn't available. Check the model name in Settings › This phone.",
  network: "Couldn't reach Gemini. Check your connection.",
  blocked: "Gemini wouldn't answer that one. Try rewording it, or enter it by hand.",
  'bad-json': "Gemini's answer didn't come out right. You can enter it by hand.",
  'too-big': 'That was too much for Gemini in one go. Try fewer photos or a shorter text.',
  other: 'Gemini had a problem. Try again in a moment.',
};

export type Part =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args?: Record<string, unknown>; id?: string }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown>; id?: string } };

export interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface GenerateRequest {
  contents: Content[];
  systemInstruction?: string;
  tools?: ({ functionDeclarations: FunctionDeclaration[] } | { url_context: Record<string, never> })[];
  generationConfig?: Record<string, unknown>;
}

export interface GenerateResult {
  content: Content;
  text: string;
  functionCalls: { name: string; args: Record<string, unknown>; id?: string }[];
  finishReason?: string;
}

export const geminiKey = () => prefs.geminiKey();
export const geminiModel = () => prefs.geminiModel() || DEFAULT_GEMINI_MODEL;

/** For tests: swap the transport. */
export let transport: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i);
export function setTransport(t: typeof transport) {
  transport = t;
}

export async function generate(
  req: GenerateRequest,
  opts: { signal?: AbortSignal } = {},
): Promise<GenerateResult> {
  const key = geminiKey();
  if (!key) throw new GeminiError('no-key', MESSAGES['no-key']);
  const body: Record<string, unknown> = {
    contents: req.contents,
    ...(req.tools?.length ? { tools: req.tools } : {}),
    generationConfig: { temperature: 0.2, ...req.generationConfig },
    systemInstruction: {
      parts: [{ text: [req.systemInstruction, UNTRUSTED_RULE].filter(Boolean).join('\n\n') }],
    },
  };
  let res: Response;
  try {
    res = await transport(`${GEMINI_BASE}/models/${encodeURIComponent(geminiModel())}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      referrerPolicy: 'no-referrer',
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new GeminiError('network', MESSAGES.network);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      /* not json */
    }
    if (res.status === 429) throw new GeminiError('rate', MESSAGES.rate);
    if (res.status === 401 || res.status === 403 || /api key/i.test(detail))
      throw new GeminiError('key', MESSAGES.key);
    if (res.status === 404) throw new GeminiError('model', MESSAGES.model);
    if (res.status === 413 || /too large|exceeds/i.test(detail))
      throw new GeminiError('too-big', MESSAGES['too-big']);
    throw new GeminiError('other', `${MESSAGES.other}${detail ? ` (${detail.slice(0, 160)})` : ''}`, detail);
  }
  const j = (await res.json()) as {
    candidates?: { content?: Content; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  const cand = j.candidates?.[0];
  if (!cand?.content) {
    if (j.promptFeedback?.blockReason || cand?.finishReason === 'SAFETY')
      throw new GeminiError('blocked', MESSAGES.blocked);
    throw new GeminiError('other', MESSAGES.other);
  }
  const content: Content = { role: 'model', parts: cand.content.parts ?? [] };
  const text = content.parts
    .filter((p): p is { text: string; thought?: boolean } => 'text' in p && !p.thought)
    .map((p) => p.text)
    .join('');
  const functionCalls = content.parts
    .filter(
      (p): p is { functionCall: { name: string; args?: Record<string, unknown>; id?: string } } =>
        'functionCall' in p,
    )
    .map((p) => ({ name: p.functionCall.name, args: p.functionCall.args ?? {}, id: p.functionCall.id }));
  return { content, text, functionCalls, finishReason: cand.finishReason };
}

/** Pulls a JSON object out of model text (tolerates ```json fences and stray prose). */
export function extractJson(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new SyntaxError('no json');
  }
}

/**
 * Asks for structured JSON. If the answer doesn't parse or validate, asks once
 * more; then gives up with the raw text so the person can enter it by hand.
 * `schemaInPrompt` is used when a tool (URL context) can't be combined with a
 * response schema on this model.
 */
export async function generateJson<T>(
  req: Omit<GenerateRequest, 'generationConfig'>,
  jsonSchema: Record<string, unknown>,
  zodSchema: z.ZodType<T, z.ZodTypeDef, unknown>,
  opts: { schemaInPrompt?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const generationConfig = opts.schemaInPrompt
    ? {}
    : { responseMimeType: 'application/json', responseJsonSchema: jsonSchema };
  const contents = opts.schemaInPrompt
    ? [
        ...req.contents.slice(0, -1),
        {
          ...req.contents[req.contents.length - 1],
          parts: [
            ...req.contents[req.contents.length - 1].parts,
            {
              text: `Answer with only one JSON object matching this JSON Schema, no other text:\n${JSON.stringify(jsonSchema)}`,
            },
          ],
        },
      ]
    : req.contents;
  let lastText = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await generate({ ...req, contents, generationConfig }, opts);
    lastText = r.text;
    try {
      const parsed = zodSchema.safeParse(extractJson(r.text));
      if (parsed.success) return parsed.data;
    } catch {
      /* try again */
    }
  }
  throw new GeminiError('bad-json', MESSAGES['bad-json'], lastText);
}

export function geminiMessage(e: unknown): string {
  if (e instanceof GeminiError) return e.message;
  if (e instanceof Error) return e.message;
  return MESSAGES.other;
}
