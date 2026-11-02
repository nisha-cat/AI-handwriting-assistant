import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Minimal typings: TypeScript's DOM lib does not ship Web Speech API types.
// ---------------------------------------------------------------------------
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface VoiceSupport {
  /** Browser dictation (Web Speech API). */
  dictation: boolean;
  /** Raw audio capture via MediaRecorder (needed for server transcription). */
  recording: boolean;
}

export function getVoiceSupport(win: Window & typeof globalThis = window): VoiceSupport {
  const w = win as unknown as Record<string, unknown>;
  return {
    dictation: typeof w.SpeechRecognition === 'function' || typeof w.webkitSpeechRecognition === 'function',
    recording: typeof win.MediaRecorder === 'function' && !!win.navigator?.mediaDevices?.getUserMedia,
  };
}

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as Record<string, SpeechRecognitionCtor | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Turns Web Speech API error codes into instructions a person can act on. */
export function describeSpeechError(code: string): { message: string; fatal: boolean } {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return {
        message:
          'Microphone access was blocked. Click the lock/camera icon in the address bar, allow the microphone for this site, then try again.',
        fatal: true,
      };
    case 'audio-capture':
      return { message: 'No microphone was found. Plug one in or check your system sound settings, then try again.', fatal: true };
    case 'network':
      return {
        message:
          "Browser dictation needs an internet connection (the browser sends audio to its speech service). Check your connection, or type your answer instead.",
        fatal: true,
      };
    case 'language-not-supported':
      return { message: 'This browser cannot dictate in the selected language. Pick another language or type your answer.', fatal: true };
    case 'no-speech':
      return { message: "I didn't hear anything. Speak closer to the microphone.", fatal: false };
    case 'aborted':
      return { message: '', fatal: false };
    default:
      return { message: `Dictation stopped unexpectedly (${code}). You can start it again or type your answer.`, fatal: true };
  }
}

export function describeRecorderError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Allow the microphone for this site in your browser settings and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Plug one in or check your system sound settings.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone is busy or unavailable. Close other apps that might be using it and try again.';
    default:
      return 'Could not start recording. Check your microphone and try again.';
  }
}

export function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Ticks once a second while `active`; resets when it turns off. */
export function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [active]);
  return seconds;
}

interface DictationOptions {
  lang: string;
  onFinalText: (text: string) => void;
}

/** Live browser dictation. Final phrases are delivered via onFinalText; interim text is shown only. */
export function useDictation({ lang, onFinalText }: DictationOptions) {
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantedRef = useRef(false);
  const restartsRef = useRef<number[]>([]);
  const onFinalRef = useRef(onFinalText);
  onFinalRef.current = onFinalText;

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    wantedRef.current = false;
    recRef.current?.stop();
    setListening(false);
    setInterim('');
  }, []);

  const begin = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]!;
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) onFinalRef.current(text.trim());
        else interimText += text;
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      const { message, fatal } = describeSpeechError(e.error);
      if (message) setError(message);
      if (fatal) {
        wantedRef.current = false;
        setListening(false);
      }
    };
    rec.onend = () => {
      setInterim('');
      if (!wantedRef.current) {
        setListening(false);
        return;
      }
      // Browsers end continuous recognition after a pause. Restart, but never in a tight loop.
      const now = Date.now();
      restartsRef.current = restartsRef.current.filter((t) => now - t < 60_000);
      if (restartsRef.current.length >= 15) {
        wantedRef.current = false;
        setListening(false);
        setError('Dictation kept stopping, so it was turned off. Press the microphone to continue.');
        return;
      }
      restartsRef.current.push(now);
      try {
        rec.start();
      } catch {
        wantedRef.current = false;
        setListening(false);
      }
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setError('Could not start dictation. Please try again.');
      wantedRef.current = false;
    }
  }, [lang]);

  const start = useCallback(() => {
    setError(null);
    wantedRef.current = true;
    begin();
  }, [begin]);

  useEffect(
    () => () => {
      wantedRef.current = false;
      recRef.current?.abort();
    },
    [],
  );

  return { listening, interim, error, start, stop, clearError: () => setError(null) };
}

export interface RecordedAudio {
  blob: Blob;
  filename: string;
  durationSec: number;
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

/** Records microphone audio for server-side transcription. */
export function useAudioRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordedAudio | null>(null);

  const release = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m));
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        release();
        setRecording(false);
        if (blob.size < 512) {
          setError('The recording is empty. Check that the right microphone is selected and speak after pressing record.');
          return;
        }
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        setResult({ blob, filename: `recording.${ext}`, durationSec: Math.round((Date.now() - startedRef.current) / 1000) });
      };
      recorderRef.current = rec;
      startedRef.current = Date.now();
      rec.start();
      setRecording(true);
    } catch (err) {
      release();
      setRecording(false);
      setError(describeRecorderError(err));
    }
  }, []);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  }, []);

  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      release();
    },
    [],
  );

  return { recording, error, result, start, stop, clearResult: () => setResult(null), clearError: () => setError(null) };
}
