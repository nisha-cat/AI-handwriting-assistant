import { Router } from 'express';
import { z } from 'zod';
import { documentInputSchema, documentPatchSchema, listQuerySchema, preferencesSchema, defaultHandwritingSettings } from '@hw/shared';
import type { Repository } from '../db/types';
import { AppError, notFound } from '../errors';

const idSchema = z.uuid();
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Idempotency-Key must be 8-64 URL-safe characters.');

/** Unknown/invalid ids are reported as 404 so ids cannot be probed. */
function docId(raw: unknown): string {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw notFound('Document');
  return parsed.data;
}

export function documentsRouter(repo: Repository): Router {
  const router = Router();
  // userId is set by sessionMiddleware, which is mounted ahead of this router.
  const uid = (req: { userId?: string }): string => {
    if (!req.userId) throw new AppError(401, 'NO_SESSION', 'No session. Reload the page and try again.');
    return req.userId;
  };

  router.get('/', async (req, res) => {
    const { limit, offset } = listQuerySchema.parse(req.query);
    const { items, total } = await repo.listDocuments(uid(req), { limit, offset });
    res.json({ items, total, limit, offset });
  });

  router.post('/', async (req, res) => {
    const input = documentInputSchema.parse(req.body);
    const rawKey = req.header('Idempotency-Key');
    const key = rawKey === undefined ? undefined : idempotencyKeySchema.parse(rawKey);
    const { document, created } = await repo.createDocument(uid(req), input, key);
    res.status(created ? 201 : 200).json({ document });
  });

  router.get('/:id', async (req, res) => {
    const doc = await repo.getDocument(uid(req), docId(req.params.id));
    if (!doc) throw notFound('Document');
    res.json({ document: doc });
  });

  router.put('/:id', async (req, res) => {
    const input = documentInputSchema.parse(req.body);
    const doc = await repo.updateDocument(uid(req), docId(req.params.id), { title: input.title, content: input.content });
    if (!doc) throw notFound('Document');
    res.json({ document: doc });
  });

  router.patch('/:id', async (req, res) => {
    const patch = documentPatchSchema.parse(req.body);
    const doc = await repo.updateDocument(uid(req), docId(req.params.id), patch);
    if (!doc) throw notFound('Document');
    res.json({ document: doc });
  });

  router.post('/:id/duplicate', async (req, res) => {
    const doc = await repo.duplicateDocument(uid(req), docId(req.params.id));
    if (!doc) throw notFound('Document');
    res.status(201).json({ document: doc });
  });

  router.get('/:id/versions', async (req, res) => {
    const versions = await repo.listVersions(uid(req), docId(req.params.id));
    if (!versions) throw notFound('Document');
    res.json({ versions });
  });

  router.delete('/:id', async (req, res) => {
    const removed = await repo.deleteDocument(uid(req), docId(req.params.id));
    if (!removed) throw notFound('Document');
    res.status(204).end();
  });

  return router;
}

export function preferencesRouter(repo: Repository): Router {
  const router = Router();
  const uid = (req: { userId?: string }): string => {
    if (!req.userId) throw new AppError(401, 'NO_SESSION', 'No session. Reload the page and try again.');
    return req.userId;
  };

  router.get('/', async (req, res) => {
    const settings = (await repo.getPreferences(uid(req))) ?? defaultHandwritingSettings();
    res.json({ settings });
  });

  router.put('/', async (req, res) => {
    const { settings } = preferencesSchema.parse(req.body);
    await repo.setPreferences(uid(req), settings);
    res.json({ settings });
  });

  return router;
}
