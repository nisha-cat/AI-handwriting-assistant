import type { OrganizeRequest } from '@hw/shared';

export interface RepairContext {
  previous: string;
  issues: string;
}

/**
 * An AI provider returns the RAW text of a JSON reply. Parsing and schema validation are
 * done once, centrally, in organize.ts - so every provider is held to the same contract.
 */
export interface AiProvider {
  readonly name: 'openai' | 'local-fallback';
  readonly model: string | null;
  organize(req: OrganizeRequest, repair?: RepairContext): Promise<string>;
}
