// Gemini model names change; this is the default only. Each phone can change it
// in Settings. Checked against ai.google.dev (models + rate limits pages):
// gemini-3.8-flash is the latest Flash model; it supports image input,
// structured outputs, function calling and URL context. On the free tier
// it allows few requests per day, so Flash-Lite is offered as an alternative.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

/** Tried once when the chosen model is too busy (it is usually less loaded). */
export const FALLBACK_GEMINI_MODEL = 'gemini-3.5-flash-lite';

export const MODEL_SUGGESTIONS = [
  { id: 'gemini-3.8-flash', note: 'Best quality. The free tier allows only a few requests a day.' },
  { id: 'gemini-3.5-flash-lite', note: 'Faster, with a higher free daily limit.' },
];

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
