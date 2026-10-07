import { useState } from 'react';
import { GEMINI_BASE } from '../../ai/config';

/**
 * "Test key": asks Gemini for the model's details. This checks the key and
 * the model name without using a generation request from the daily quota.
 */
export function GeminiTestButton({ apiKey, model }: { apiKey: string; model: string }) {
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; text?: string }>({});
  const test = async () => {
    if (!apiKey) {
      setState({ ok: false, text: 'Paste a key first.' });
      return;
    }
    setState({ busy: true });
    try {
      const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}`, {
        headers: { 'x-goog-api-key': apiKey },
        referrerPolicy: 'no-referrer',
      });
      if (res.ok) {
        const info = (await res.json()) as { displayName?: string };
        setState({ ok: true, text: `The key works with ${info.displayName ?? model}.` });
      } else if (res.status === 400 || res.status === 401 || res.status === 403) {
        setState({ ok: false, text: "Gemini didn't accept this key. Copy it again from Google AI Studio." });
      } else if (res.status === 404) {
        setState({ ok: false, text: `The key works, but there's no model called ${model}. Check the name.` });
      } else if (res.status === 429) {
        setState({ ok: false, text: "Gemini's free limit was reached, try again in a minute." });
      } else setState({ ok: false, text: `Gemini answered with an error (${res.status}). Try again later.` });
    } catch {
      setState({ ok: false, text: "Couldn't reach Gemini. Check your connection." });
    }
  };
  return (
    <>
      <button
        type="button"
        className="btn btn-outline btn-md"
        onClick={() => void test()}
        disabled={state.busy}
      >
        {state.busy ? 'Testing…' : 'Test key'}
      </button>
      {state.text && (
        <span
          role="status"
          className={`small bold ${state.ok ? 'text-cobalt' : 'danger-text'}`}
          style={{ width: '100%' }}
        >
          {state.text}
        </span>
      )}
    </>
  );
}
