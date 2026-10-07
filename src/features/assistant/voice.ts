// Voice input (6.10): Web Speech API with interim results shown in the field.
// Tapping again stops; the text stays editable, so nothing is sent unheard.
import { useCallback, useEffect, useRef, useState } from 'react';

interface Rec {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecCtor = new () => Rec;

const ctor = (): RecCtor | undefined =>
  (window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor })
    .SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecCtor }).webkitSpeechRecognition;

export const speechSupported = () => typeof window !== 'undefined' && !!ctor();

export function useSpeech(lang: string, onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const base = useRef('');

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(
    (existing: string) => {
      const C = ctor();
      if (!C) {
        setError(
          "Voice input isn't available in this browser. Use the microphone key on your keyboard instead.",
        );
        return;
      }
      setError(null);
      base.current = existing ? `${existing.trimEnd()} ` : '';
      const r = new C();
      r.lang = lang;
      r.interimResults = true;
      r.continuous = true;
      let finalText = '';
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finalText += res[0].transcript;
          else interim += res[0].transcript;
        }
        onText(`${base.current}${finalText}${interim}`.replace(/\s+/g, ' ').trimStart());
      };
      r.onerror = (e) => {
        setError(
          e.error === 'not-allowed'
            ? 'Allow the microphone for this site to talk to the Assistant.'
            : e.error === 'no-speech'
              ? "I didn't hear anything. Try again."
              : null,
        );
      };
      r.onend = () => {
        setListening(false);
        rec.current = null;
      };
      rec.current = r;
      r.start();
      setListening(true);
    },
    [lang, onText],
  );

  useEffect(() => () => rec.current?.stop(), []);
  return { listening, start, stop, error, supported: speechSupported() };
}
