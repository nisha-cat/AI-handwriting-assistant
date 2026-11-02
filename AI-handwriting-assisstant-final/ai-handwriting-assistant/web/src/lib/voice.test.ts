import { describe, expect, it } from 'vitest';
import { describeRecorderError, describeSpeechError, formatElapsed, getVoiceSupport } from './speech';
import { appendText, planVoiceInput, speechLangFor, transcriptionLangFor } from './voice';

describe('planVoiceInput (speech recognition fallback)', () => {
  it('offers everything when the browser and server both support it', () => {
    const plan = planVoiceInput({ dictation: true, recording: true }, true);
    expect(plan).toMatchObject({ dictation: true, serverRecording: true, upload: true, notes: [] });
  });

  it('falls back to typing only, and says so, when nothing can transcribe', () => {
    const plan = planVoiceInput({ dictation: false, recording: false }, false);
    expect(plan.dictation).toBe(false);
    expect(plan.serverRecording).toBe(false);
    expect(plan.upload).toBe(false);
    expect(plan.notes.join(' ')).toMatch(/type or paste/i);
    expect(plan.notes.join(' ')).toMatch(/OPENAI_API_KEY/);
  });

  it('never offers server recording without a configured transcription provider', () => {
    const plan = planVoiceInput({ dictation: true, recording: true }, false);
    expect(plan.serverRecording).toBe(false);
    expect(plan.upload).toBe(false);
    expect(plan.dictation).toBe(true);
  });

  it('points to the server path when live dictation is unsupported but the server can transcribe', () => {
    const plan = planVoiceInput({ dictation: false, recording: true }, true);
    expect(plan.serverRecording).toBe(true);
    expect(plan.upload).toBe(true);
    expect(plan.notes[0]).toMatch(/record button/i);
  });

  it('keeps upload available when the browser cannot record', () => {
    const plan = planVoiceInput({ dictation: false, recording: false }, true);
    expect(plan.serverRecording).toBe(false);
    expect(plan.upload).toBe(true);
    expect(plan.notes.join(' ')).toMatch(/upload a recording/i);
  });
});

describe('getVoiceSupport', () => {
  it('detects the prefixed Web Speech API and MediaRecorder', () => {
    const win = {
      webkitSpeechRecognition: function () {},
      MediaRecorder: function () {},
      navigator: { mediaDevices: { getUserMedia: () => {} } },
    } as unknown as Window & typeof globalThis;
    expect(getVoiceSupport(win)).toEqual({ dictation: true, recording: true });
  });

  it('reports nothing supported on a bare window', () => {
    const win = { navigator: {} } as unknown as Window & typeof globalThis;
    expect(getVoiceSupport(win)).toEqual({ dictation: false, recording: false });
  });
});

describe('error descriptions give recovery instructions', () => {
  it('maps a denied microphone to actionable text', () => {
    const e = describeSpeechError('not-allowed');
    expect(e.fatal).toBe(true);
    expect(e.message).toMatch(/allow the microphone/i);
  });
  it('treats silence as non-fatal and an intentional abort as silent', () => {
    expect(describeSpeechError('no-speech').fatal).toBe(false);
    expect(describeSpeechError('aborted').message).toBe('');
  });
  it('describes network failures honestly', () => {
    expect(describeSpeechError('network').message).toMatch(/internet connection/i);
  });
  it('maps recorder errors by name', () => {
    expect(describeRecorderError({ name: 'NotAllowedError' })).toMatch(/blocked/i);
    expect(describeRecorderError({ name: 'NotFoundError' })).toMatch(/No microphone/i);
    expect(describeRecorderError(new Error('x'))).toMatch(/Could not start recording/i);
  });
});

describe('helpers', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65)).toBe('1:05');
  });
  it('maps language names to recognition and transcription codes', () => {
    expect(speechLangFor('Spanish')).toBe('es-ES');
    expect(speechLangFor('English')).toBe('en-US');
    expect(transcriptionLangFor('French')).toBe('fr');
    expect(transcriptionLangFor('Klingon')).toBeUndefined();
  });
  it('appends dictation and respects the character limit', () => {
    expect(appendText('Hello', 'world', 100)).toEqual({ text: 'Hello world', truncated: false });
    expect(appendText('', '  first  ', 100).text).toBe('first');
    expect(appendText('abc', '   ', 100)).toEqual({ text: 'abc', truncated: false });
    const r = appendText('12345', '67890', 8);
    expect(r.truncated).toBe(true);
    expect(r.text).toHaveLength(8);
  });
});
