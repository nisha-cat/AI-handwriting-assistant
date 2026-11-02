import OpenAI, { toFile } from 'openai';
import { AppError } from '../errors';
import { mapProviderError } from '../ai/openaiProvider';

export interface AudioUpload {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export interface Transcriber {
  readonly name: string;
  transcribe(audio: AudioUpload, language?: string): Promise<{ text: string }>;
}

/** Maps a MIME type to a file extension the transcription API recognises. */
export function extensionFor(mimetype: string, originalname: string): string {
  const m = mimetype.toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('wav') || m.includes('wave')) return 'wav';
  if (m.includes('flac')) return 'flac';
  const ext = originalname.split('.').pop()?.toLowerCase();
  return ext && /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'webm';
}

export class OpenAiTranscriber implements Transcriber {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    timeoutMs: number,
  ) {
    this.client = new OpenAI({ apiKey, timeout: Math.max(timeoutMs, 60_000), maxRetries: 2 });
  }

  async transcribe(audio: AudioUpload, language?: string): Promise<{ text: string }> {
    try {
      const file = await toFile(audio.buffer, `audio.${extensionFor(audio.mimetype, audio.originalname)}`, {
        type: audio.mimetype,
      });
      const res = await this.client.audio.transcriptions.create({
        file,
        model: this.model,
        ...(language ? { language } : {}),
      });
      return { text: (res.text ?? '').trim() };
    } catch (err) {
      const mapped = mapProviderError(err);
      // Re-label so the client can tell transcription failures from organisation failures.
      throw new AppError(mapped.status, mapped.code.replace(/^AI_/, 'TRANSCRIPTION_'), mapped.message, undefined, mapped.headers);
    }
  }
}
