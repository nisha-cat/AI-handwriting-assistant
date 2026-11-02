import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { extensionFor } from '../src/transcription/transcriber';
import { buildApp, mockTranscriber, request, testConfig } from './helpers';

const audio = (size = 4096) => Buffer.alloc(size, 1);

describe('POST /api/transcription', () => {
  it('says so plainly when no transcription service is configured (never fakes a transcript)', async () => {
    const { app } = buildApp({ transcriber: null });
    const res = await request(app).post('/api/transcription').attach('audio', audio(), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('TRANSCRIPTION_NOT_CONFIGURED');
    expect(res.body.error.message).toMatch(/no transcript was produced/i);
    expect(res.body).not.toHaveProperty('text');
  });

  it('returns the transcript when the provider succeeds', async () => {
    const t = mockTranscriber();
    const { app } = buildApp({ transcriber: t });
    const res = await request(app)
      .post('/api/transcription')
      .field('language', 'en')
      .attach('audio', audio(), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: 'hello from the recording', provider: 'mock' });
    expect(t.transcribe).toHaveBeenCalledTimes(1);
    expect(t.transcribe.mock.calls[0]![1]).toBe('en');
  });

  it('rejects empty audio without calling the provider', async () => {
    const t = mockTranscriber();
    const { app } = buildApp({ transcriber: t });
    const res = await request(app).post('/api/transcription').attach('audio', audio(10), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_AUDIO');
    expect(t.transcribe).not.toHaveBeenCalled();
  });

  it('rejects requests with no file', async () => {
    const { app } = buildApp({ transcriber: mockTranscriber() });
    const res = await request(app).post('/api/transcription').field('language', 'en');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_AUDIO');
  });

  it('rejects non-audio uploads', async () => {
    const t = mockTranscriber();
    const { app } = buildApp({ transcriber: t });
    const res = await request(app).post('/api/transcription').attach('audio', Buffer.from('<?php evil ?>'), { filename: 'x.php', contentType: 'application/x-php' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_AUDIO');
    expect(t.transcribe).not.toHaveBeenCalled();
  });

  it('rejects oversized uploads', async () => {
    const t = mockTranscriber();
    const config = testConfig({ maxAudioBytes: 2048, maxAudioMb: 0.002 });
    const { app } = buildApp({ transcriber: t, config });
    const res = await request(app).post('/api/transcription').attach('audio', audio(10_000), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('AUDIO_TOO_LARGE');
    expect(t.transcribe).not.toHaveBeenCalled();
  });

  it('reports silence as NO_SPEECH_DETECTED rather than an empty success', async () => {
    const { app } = buildApp({ transcriber: mockTranscriber(async () => ({ text: '' })) });
    const res = await request(app).post('/api/transcription').attach('audio', audio(), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_SPEECH_DETECTED');
  });

  it('surfaces provider failures as safe, typed errors', async () => {
    const t = mockTranscriber(async () => {
      throw new AppError(504, 'TRANSCRIPTION_TIMEOUT', 'The AI service took too long to respond. Your text is unchanged - please try again.');
    });
    const { app } = buildApp({ transcriber: t });
    const res = await request(app).post('/api/transcription').attach('audio', audio(), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('TRANSCRIPTION_TIMEOUT');
  });

  it('validates the language field', async () => {
    const { app } = buildApp({ transcriber: mockTranscriber() });
    const res = await request(app)
      .post('/api/transcription')
      .field('language', 'not a language!!')
      .attach('audio', audio(), { filename: 'a.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(400);
  });

  it('accepts codec parameters in the MIME type (MediaRecorder output)', async () => {
    const { app } = buildApp({ transcriber: mockTranscriber() });
    const res = await request(app)
      .post('/api/transcription')
      .attach('audio', audio(), { filename: 'a.webm', contentType: 'audio/webm;codecs=opus' });
    expect(res.status).toBe(200);
  });
});

describe('extensionFor', () => {
  it('maps MIME types to API-recognised extensions', () => {
    expect(extensionFor('audio/webm;codecs=opus', 'x')).toBe('webm');
    expect(extensionFor('audio/mpeg', 'x')).toBe('mp3');
    expect(extensionFor('audio/x-m4a', 'x')).toBe('m4a');
    expect(extensionFor('audio/wav', 'x')).toBe('wav');
    expect(extensionFor('application/octet-stream', 'clip.ogg')).toBe('ogg');
  });
});
