import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatElapsed, getVoiceSupport, useAudioRecorder, useDictation, useElapsed } from '../lib/speech';
import { planVoiceInput, speechLangFor, transcriptionLangFor } from '../lib/voice';
import { useCapabilities } from './Capabilities';
import { useToast } from './Toasts';

interface Props {
  /** Language *name* (e.g. "English") chosen for the answer. */
  language: string;
  onText: (text: string) => void;
}

/**
 * Voice input with three honest paths:
 *  1. live browser dictation (Web Speech API),
 *  2. record in-browser → server transcription,
 *  3. upload a file → server transcription.
 * Text is only added once a real transcription service has returned it.
 */
export function VoiceInput({ language, onText }: Props) {
  const { caps } = useCapabilities();
  const toast = useToast();
  const support = useMemo(() => getVoiceSupport(), []);
  const plan = planVoiceInput(support, caps?.transcription ?? false);

  const dictation = useDictation({ lang: speechLangFor(language), onFinalText: (t) => t && onText(t) });
  const recorder = useAudioRecorder();
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dictationSeconds = useElapsed(dictation.listening);
  const recordSeconds = useElapsed(recorder.recording);

  // When a recording finishes, send it for transcription.
  useEffect(() => {
    if (!recorder.result) return;
    const { blob, filename } = recorder.result;
    recorder.clearResult();
    void transcribe(blob, filename);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.result]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function transcribe(blob: Blob, filename: string) {
    setTranscribeError(null);
    setTranscribing(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { text } = await api.transcribe(blob, filename, transcriptionLangFor(language), controller.signal);
      onText(text);
      toast.success('Transcription added to your answer. Please check it for mistakes.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ABORTED') return;
      setTranscribeError(err instanceof Error ? err.message : 'Transcription failed. Please try again.');
    } finally {
      setTranscribing(false);
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    const maxBytes = (caps?.maxAudioMb ?? 10) * 1024 * 1024;
    if (file.size > maxBytes) {
      setTranscribeError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${caps?.maxAudioMb ?? 10} MB - trim or compress it and try again.`);
      return;
    }
    if (file.size === 0) {
      setTranscribeError('That file is empty.');
      return;
    }
    void transcribe(file, file.name);
  }

  const busy = dictation.listening || recorder.recording || transcribing;
  const error = dictation.error ?? recorder.error ?? transcribeError;

  return (
    <section aria-labelledby="voice-heading" className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <h3 id="voice-heading" className="text-sm font-semibold">
        Speak instead of typing
      </h3>
      <p className="hint mb-3">Your speech becomes editable text below. Nothing is added until a transcript actually exists.</p>

      <div className="flex flex-wrap items-center gap-2">
        {plan.dictation && (
          <button
            type="button"
            className={dictation.listening ? 'btn-danger' : 'btn-primary'}
            aria-pressed={dictation.listening}
            disabled={recorder.recording || transcribing}
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
          >
            <span aria-hidden="true">{dictation.listening ? '■' : '🎤'}</span>
            {dictation.listening ? 'Stop dictation' : 'Start dictation'}
          </button>
        )}
        {plan.serverRecording && (
          <button
            type="button"
            className={recorder.recording ? 'btn-danger' : 'btn-secondary'}
            aria-pressed={recorder.recording}
            disabled={dictation.listening || transcribing}
            onClick={() => (recorder.recording ? recorder.stop() : void recorder.start())}
          >
            <span aria-hidden="true">{recorder.recording ? '■' : '●'}</span>
            {recorder.recording ? 'Stop & transcribe' : 'Record for server transcription'}
          </button>
        )}
        {plan.upload && (
          <>
            <input
              ref={fileRef}
              id="audio-upload"
              type="file"
              accept="audio/*,video/mp4,video/webm,.m4a,.mp3,.wav,.ogg,.webm,.flac"
              className="sr-only"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
              Upload audio file
            </button>
          </>
        )}
      </div>

      <div className="mt-3 min-h-6 text-sm" aria-live="polite">
        {dictation.listening && (
          <p className="flex items-center gap-2 text-red-800">
            <span className="inline-block size-2.5 rounded-full bg-red-600" aria-hidden="true" />
            Listening… <span className="tabular-nums" aria-label={`${dictationSeconds} seconds elapsed`}>{formatElapsed(dictationSeconds)}</span>
          </p>
        )}
        {recorder.recording && (
          <p className="flex items-center gap-2 text-red-800">
            <span className="inline-block size-2.5 rounded-full bg-red-600" aria-hidden="true" />
            Recording… <span className="tabular-nums">{formatElapsed(recordSeconds)}</span>
          </p>
        )}
        {transcribing && (
          <p className="flex items-center gap-2 text-stone-800">
            Transcribing on the server…{' '}
            <button type="button" className="underline" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          </p>
        )}
      </div>
      {dictation.listening && dictation.interim && (
        <p className="mt-1 rounded bg-white px-2 py-1 text-sm italic text-stone-600" data-testid="interim">
          {dictation.interim}
        </p>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950">
          {error}
        </div>
      )}
      {plan.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-stone-700">
          {plan.notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
