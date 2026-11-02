import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { caps, errorResponse, jsonResponse, mockApi, renderWithProviders } from '../test/utils';
import { VoiceInput } from './VoiceInput';

afterEach(() => vi.unstubAllGlobals());

const audio = (bytes = 2048, name = 'answer.mp3') => new File([new Uint8Array(bytes)], name, { type: 'audio/mpeg' });

describe('VoiceInput', () => {
  it('without browser or server support: offers no recording controls and explains the typed fallback', async () => {
    mockApi({ 'GET /api/health': () => jsonResponse(caps({ transcription: false })) });
    renderWithProviders(<VoiceInput language="English" onText={vi.fn()} />);

    expect(await screen.findByText(/no transcription provider configured/i)).toBeInTheDocument();
    expect(screen.getByText(/type or paste your answer/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start dictation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload audio/i })).not.toBeInTheDocument();
  });

  it('adds the transcript only after the server actually returns one', async () => {
    const onText = vi.fn();
    const { calls } = mockApi({
      'GET /api/health': () => jsonResponse(caps({ transcription: true })),
      'POST /api/transcription': () => jsonResponse({ text: 'the mitochondria is the powerhouse of the cell', provider: 'openai' }),
    });
    renderWithProviders(<VoiceInput language="English" onText={onText} />);
    await screen.findByRole('button', { name: /upload audio file/i });
    expect(onText).not.toHaveBeenCalled();

    await userEvent.upload(document.querySelector<HTMLInputElement>('#audio-upload')!, audio());

    await waitFor(() => expect(onText).toHaveBeenCalledWith('the mitochondria is the powerhouse of the cell'));
    expect(calls.some((c) => c.key === 'POST /api/transcription')).toBe(true);
  });

  it('shows the server error and adds NO text when transcription fails', async () => {
    const onText = vi.fn();
    mockApi({
      'GET /api/health': () => jsonResponse(caps({ transcription: true })),
      'POST /api/transcription': () => errorResponse(502, 'TRANSCRIPTION_FAILED', 'The transcription service could not process this audio.'),
    });
    renderWithProviders(<VoiceInput language="English" onText={onText} />);
    await screen.findByRole('button', { name: /upload audio file/i });
    await userEvent.upload(document.querySelector<HTMLInputElement>('#audio-upload')!, audio());

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not process this audio/i);
    expect(onText).not.toHaveBeenCalled();
  });

  it('rejects an oversized file locally, before any upload', async () => {
    const { calls } = mockApi({ 'GET /api/health': () => jsonResponse(caps({ transcription: true, maxAudioMb: 1 })) });
    renderWithProviders(<VoiceInput language="English" onText={vi.fn()} />);
    await screen.findByRole('button', { name: /upload audio file/i });
    await userEvent.upload(document.querySelector<HTMLInputElement>('#audio-upload')!, audio(2 * 1024 * 1024));

    expect(await screen.findByRole('alert')).toHaveTextContent(/limit is 1 MB/i);
    expect(calls.some((c) => c.key === 'POST /api/transcription')).toBe(false);
  });

  it('rejects an empty file', async () => {
    const { calls } = mockApi({ 'GET /api/health': () => jsonResponse(caps({ transcription: true })) });
    renderWithProviders(<VoiceInput language="English" onText={vi.fn()} />);
    await screen.findByRole('button', { name: /upload audio file/i });
    await userEvent.upload(document.querySelector<HTMLInputElement>('#audio-upload')!, audio(0));
    expect(await screen.findByRole('alert')).toHaveTextContent(/empty/i);
    expect(calls.some((c) => c.key === 'POST /api/transcription')).toBe(false);
  });
});
