import { Router } from 'express';
import { organizeRequestSchema } from '@hw/shared';
import type { AiProvider } from '../ai/provider';
import { organizeAnswer } from '../ai/organize';

export function aiRouter(provider: AiProvider): Router {
  const router = Router();

  // POST /api/ai/organize-answer
  router.post('/organize-answer', async (req, res) => {
    const input = organizeRequestSchema.parse(req.body);
    const result = await organizeAnswer(input, { provider });
    res.json(result);
  });

  return router;
}
