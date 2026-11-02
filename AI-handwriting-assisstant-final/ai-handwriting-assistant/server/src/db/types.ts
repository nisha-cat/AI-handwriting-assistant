import type {
  DocumentInput,
  DocumentPatch,
  DocumentRecord,
  DocumentSummary,
  DocumentVersionSummary,
  HandwritingSettings,
} from '@hw/shared';

export interface ListResult {
  items: DocumentSummary[];
  total: number;
}

export interface CreateResult {
  document: DocumentRecord;
  /** false when an Idempotency-Key matched an earlier create and that document was returned. */
  created: boolean;
}

/**
 * Storage abstraction. Every document method is scoped by userId so a user can never
 * read or modify another user's data, regardless of the backing store.
 */
export interface Repository {
  readonly kind: 'mysql' | 'memory';
  ping(): Promise<void>;
  close(): Promise<void>;

  /** Finds or creates the (anonymous) user for a hashed session token. */
  ensureUser(tokenHash: string): Promise<string>;

  createDocument(userId: string, input: DocumentInput, idempotencyKey?: string): Promise<CreateResult>;
  listDocuments(userId: string, opts: { limit: number; offset: number }): Promise<ListResult>;
  getDocument(userId: string, id: string): Promise<DocumentRecord | null>;
  updateDocument(userId: string, id: string, patch: DocumentPatch): Promise<DocumentRecord | null>;
  duplicateDocument(userId: string, id: string): Promise<DocumentRecord | null>;
  deleteDocument(userId: string, id: string): Promise<boolean>;
  listVersions(userId: string, id: string): Promise<DocumentVersionSummary[] | null>;

  getPreferences(userId: string): Promise<HandwritingSettings | null>;
  setPreferences(userId: string, settings: HandwritingSettings): Promise<void>;
}

export const MAX_VERSIONS_PER_DOCUMENT = 20;
