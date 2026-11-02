import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Config } from '../config';
import { AppError } from '../errors';
import type { Transcriber } from '../transcription/transcriber';

const ALLOWED_MIME = /^(audio\/(webm|ogg|mpeg|mp3|mp4|m4a|x-m4a|aac|wav|x-wav|wave|flac|x-flac)|video\/(webm|mp4))(;.*)?$/i;
const MIN_AUDIO_BYTES = 512;
const languageSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, 'Language must be an ISO code such as "en".')
  .optional();

export function transcriptionRouter(transcriber: Transcriber | null, config: Config): Router {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxAudioBytes, files: 1, fields: 4, fieldSize: 100 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME.test(file.mimetype)) return cb(null, true);
      cb(new AppError(415, 'UNSUPPORTED_AUDIO', 'Unsupported audio type. Use WebM, Ogg, MP3, M4A/MP4, WAV or FLAC.'));
    },
  }).single('audio');

  // Check configuration BEFORE accepting the upload, so we never buffer audio we cannot use.
  const requireTranscriber: RequestHandler = (_req, _res, next) => {
    if (!transcriber) {
      return next(
        new AppError(
          503,
          'TRANSCRIPTION_NOT_CONFIGURED',
          'Audio transcription is not configured on this server (no OPENAI_API_KEY). Use browser dictation or type your answer instead - no transcript was produced.',
        ),
      );
    }
    next();
  };

  // POST /api/transcription  (multipart/form-data, field "audio", optional field "language")
  router.post('/', requireTranscriber, upload, async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError(400, 'NO_AUDIO', 'No audio file was received.');
    if (file.size < MIN_AUDIO_BYTES) {
      throw new AppError(400, 'EMPTY_AUDIO', 'The recording appears to be empty. Check your microphone and try again.');
    }
    const language = languageSchema.parse(typeof req.body?.language === 'string' && req.body.language ? req.body.language : undefined);
    const { text } = await transcriber!.transcribe(
      { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname },
      language,
    );
    if (!text) {
      throw new AppError(422, 'NO_SPEECH_DETECTED', 'No speech was detected in that audio. Try again closer to the microphone.');
    }
    res.json({ text, provider: transcriber!.name });
  });

  return router;
}
