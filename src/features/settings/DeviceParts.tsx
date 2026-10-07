import { useState } from 'react';
import { prefs } from '../../app/prefs';
import { useAssistantUi } from '../../app/assistantUi';
import { Field, Seg, Switch } from '../../ui/controls';
import { useToast } from '../../ui/Toast';
import { DEFAULT_GEMINI_MODEL, MODEL_SUGGESTIONS } from '../../ai/config';
import { SettingsPage } from './common';
import { GeminiTestButton } from './GeminiTest';

export function GeminiPrivacyNote() {
  return (
    <div className="note small" style={{ lineHeight: 1.45 }}>
      <strong>What is sent to Gemini.</strong> Only what a request needs: the receipt photo (without location
      data), the text of a recipe page you pasted, your message, and short summaries of your items, recipes or
      spending. Your names are replaced with "Person A" and "Person B" and emails are never sent. On the free
      tier, Google may use what you send to improve its products, so don't type anything you'd rather keep
      private.
    </div>
  );
}

export function GeminiSettings() {
  const toast = useToast();
  const [key, setKey] = useState(prefs.geminiKey());
  const [show, setShow] = useState(false);
  const [model, setModel] = useState(prefs.geminiModel() || DEFAULT_GEMINI_MODEL);
  const saved = key === prefs.geminiKey() && model === (prefs.geminiModel() || DEFAULT_GEMINI_MODEL);
  return (
    <>
      <h2 className="group-title">Gemini (receipts, recipe import, Assistant)</h2>
      <form
        className="card card-pad stack-lg"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          prefs.setGeminiKey(key.trim());
          prefs.setGeminiModel(model.trim() === DEFAULT_GEMINI_MODEL ? '' : model.trim());
          toast.show(key.trim() ? 'Gemini key saved on this phone' : 'Gemini key removed from this phone');
        }}
      >
        <Field
          label="Gemini API key"
          hint="Get a free key in Google AI Studio. It's stored only on this phone."
        >
          <div className="row">
            <input
              className="input grow"
              type={show ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShow(!show)}
              aria-pressed={show}
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </Field>
        <Field
          label="Model"
          hint={`Default: ${DEFAULT_GEMINI_MODEL}. Change it only if Google renames or retires it.`}
        >
          <input
            className="input"
            spellCheck={false}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </Field>
        <div className="stack-sm">
          {MODEL_SUGGESTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              className="chip chip-sm"
              aria-pressed={model === m.id}
              onClick={() => setModel(m.id)}
              style={{
                height: 'auto',
                minHeight: 40,
                padding: '6px 12px',
                textAlign: 'left',
                borderRadius: 12,
              }}
            >
              <span>
                {m.id}
                <span style={{ display: 'block', fontWeight: 400, fontSize: 13 }}>{m.note}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary btn-md" disabled={saved}>
            Save
          </button>
          <GeminiTestButton apiKey={key.trim()} model={model.trim() || DEFAULT_GEMINI_MODEL} />
        </div>
        <GeminiPrivacyNote />
      </form>
    </>
  );
}

export function AssistantSettings() {
  const ui = useAssistantUi();
  const toast = useToast();
  const [lang, setLang] = useState(prefs.ui().voiceLang);
  return (
    <SettingsPage
      title="Assistant"
      hint="The Assistant reads your data and prepares changes. Nothing changes until one of you taps Apply."
    >
      <div className="stack-lg">
        <Switch
          on={!ui.disabled}
          onToggle={() => ui.setDisabled(!ui.disabled)}
          title="Assistant on this phone"
          sub={
            ui.disabled
              ? 'Off. The round button is hidden on this phone.'
              : 'On. Tap the round button on any tab.'
          }
        />
        <div className="card card-pad stack" style={{ gap: 10 }}>
          <span className="bold">Voice language</span>
          <Seg
            label="Voice language"
            value={lang}
            onChange={(v) => {
              setLang(v);
              prefs.setUi({ voiceLang: v });
            }}
            options={[
              ['ro-RO', 'Română'],
              ['en-US', 'English'],
            ]}
          />
          <span className="small muted">
            Used by the microphone button. You can always check and edit the text before sending.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-outline btn-md"
          onClick={() => {
            prefs.setChatRaw(null);
            window.dispatchEvent(new Event('hh-chat-cleared'));
            toast.show('Conversation cleared on this phone');
          }}
        >
          Clear conversation
        </button>
        <span className="small muted">
          The conversation is kept only on this phone (last 50 messages) and never saved to Drive.
        </span>
        <GeminiPrivacyNote />
      </div>
    </SettingsPage>
  );
}
