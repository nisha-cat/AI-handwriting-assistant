import type { VoiceSupport } from './speech';

export interface VoicePlan {
  /** Live browser dictation is available. */
  dictation: boolean;
  /** Record in-browser and transcribe on the server. */
  serverRecording: boolean;
  /** Upload an audio file for server transcription. */
  upload: boolean;
  /** Messages explaining anything that is unavailable and what to do instead. */
  notes: string[];
}

/**
 * Decides which voice-input paths to offer. Pure, so the fallback behaviour is unit-tested.
 * We never offer a path that cannot actually produce a transcript.
 */
export function planVoiceInput(support: VoiceSupport, serverTranscription: boolean): VoicePlan {
  const notes: string[] = [];
  if (!support.dictation) {
    notes.push(
      serverTranscription
        ? "This browser doesn't support live dictation, so use the record button (transcribed on the server) or upload a file."
        : "This browser doesn't support live dictation (try Chrome, Edge or Safari). You can still type or paste your answer.",
    );
  }
  if (!serverTranscription) {
    notes.push('Audio recording/upload is disabled because the server has no transcription provider configured (set OPENAI_API_KEY).');
  } else if (!support.recording) {
    notes.push("This browser can't record audio, but you can upload a recording instead.");
  }
  return {
    dictation: support.dictation,
    serverRecording: serverTranscription && support.recording,
    upload: serverTranscription,
    notes,
  };
}

const SPEECH_LANGS: Record<string, string> = {
  english: 'en-US',
  spanish: 'es-ES',
  french: 'fr-FR',
  german: 'de-DE',
  italian: 'it-IT',
  portuguese: 'pt-PT',
  hindi: 'hi-IN',
  dutch: 'nl-NL',
};

/** Maps the language name used by the organiser to a BCP-47 tag for speech recognition. */
export function speechLangFor(language: string, fallback = typeof navigator !== 'undefined' ? navigator.language : 'en-US'): string {
  return SPEECH_LANGS[language.trim().toLowerCase()] ?? (language === 'English' ? 'en-US' : fallback || 'en-US');
}

/** ISO 639-1 hint for the transcription API ("en", "es", …), or undefined to auto-detect. */
export function transcriptionLangFor(language: string): string | undefined {
  const tag = SPEECH_LANGS[language.trim().toLowerCase()];
  return tag ? tag.split('-')[0] : undefined;
}

/** Appends dictated text to existing text, respecting a character limit. */
export function appendText(existing: string, addition: string, maxChars: number): { text: string; truncated: boolean } {
  const add = addition.trim();
  if (!add) return { text: existing, truncated: false };
  const joined = existing.trim() ? `${existing.replace(/\s+$/, '')} ${add}` : add;
  if (joined.length <= maxChars) return { text: joined, truncated: false };
  return { text: joined.slice(0, maxChars), truncated: true };
}
