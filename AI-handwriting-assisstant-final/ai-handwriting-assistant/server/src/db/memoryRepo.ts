import { randomUUID } from 'node:crypto';
import {
  makeExcerpt,
  type DocumentInput,
  type DocumentPatch,
  type DocumentRecord,
  type DocumentVersionSummary,
  type HandwritingSettings,
} from '@hw/shared';
import { MAX_VERSIONS_PER_DOCUMENT, type CreateResult, type ListResult, type Repository } from './types';

interface StoredDoc {
  userId: string;
  record: DocumentRecord;
  idempotencyKey: string | null;
  versions: Array<{ version: number; title: string; createdAt: string }>;
}

/** Development-only store: data is lost when the process exits. */
export class MemoryRepository implements Repository {
  readonly kind = 'memory' as const;
  private users = new Map<string, string>(); // tokenHash → userId
  private docs = new Map<string, StoredDoc>();
  private prefs = new Map<string, HandwritingSettings>();

  async ping(): Promise<void> {}
  async close(): Promise<void> {}

  async ensureUser(tokenHash: string): Promise<string> {
    let id = this.users.get(tokenHash);
    if (!id) {
      id = randomUUID();
      this.users.set(tokenHash, id);
    }
    return id;
  }

  async createDocument(userId: string, input: DocumentInput, idempotencyKey?: string): Promise<CreateResult> {
    if (idempotencyKey) {
      for (const d of this.docs.values()) {
        if (d.userId === userId && d.idempotencyKey === idempotencyKey) {
          return { document: structuredClone(d.record), created: false };
        }
      }
    }
    const now = new Date().toISOString();
    const record: DocumentRecord = {
      id: randomUUID(),
      title: input.title,
      mode: input.content.mode,
      excerpt: makeExcerpt(input.content.bodyText || input.content.rawText),
      createdAt: now,
      updatedAt: now,
      version: 1,
      content: input.content,
    };
    this.docs.set(record.id, { userId, record, idempotencyKey: idempotencyKey ?? null, versions: [] });
    return { document: structuredClone(record), created: true };
  }

  async listDocuments(userId: string, opts: { limit: number; offset: number }): Promise<ListResult> {
    const mine = [...this.docs.values()]
      .filter((d) => d.userId === userId)
      .sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt));
    const items = mine.slice(opts.offset, opts.offset + opts.limit).map(({ record }) => ({
      id: record.id,
      title: record.title,
      mode: record.mode,
      excerpt: record.excerpt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }));
    return { items, total: mine.length };
  }

  private own(userId: string, id: string): StoredDoc | null {
    const d = this.docs.get(id);
    return d && d.userId === userId ? d : null;
  }

  async getDocument(userId: string, id: string): Promise<DocumentRecord | null> {
    const d = this.own(userId, id);
    return d ? structuredClone(d.record) : null;
  }

  async updateDocument(userId: string, id: string, patch: DocumentPatch): Promise<DocumentRecord | null> {
    const d = this.own(userId, id);
    if (!d) return null;
    if (patch.content) {
      // Snapshot the previous state before overwriting content.
      d.versions.push({ version: d.record.version, title: d.record.title, createdAt: d.record.updatedAt });
      if (d.versions.length > MAX_VERSIONS_PER_DOCUMENT) d.versions.shift();
      d.record.content = patch.content;
      d.record.mode = patch.content.mode;
      d.record.excerpt = makeExcerpt(patch.content.bodyText || patch.content.rawText);
      d.record.version += 1;
    }
    if (patch.title !== undefined) d.record.title = patch.title;
    d.record.updatedAt = new Date().toISOString();
    return structuredClone(d.record);
  }

  async duplicateDocument(userId: string, id: string): Promise<DocumentRecord | null> {
    const d = this.own(userId, id);
    if (!d) return null;
    const title = `${d.record.title} (copy)`.slice(0, 120);
    const { document } = await this.createDocument(userId, { title, content: structuredClone(d.record.content) });
    return document;
  }

  async deleteDocument(userId: string, id: string): Promise<boolean> {
    return this.own(userId, id) ? this.docs.delete(id) : false;
  }

  async listVersions(userId: string, id: string): Promise<DocumentVersionSummary[] | null> {
    const d = this.own(userId, id);
    if (!d) return null;
    return [...d.versions].reverse().map((v) => ({ ...v }));
  }

  async getPreferences(userId: string): Promise<HandwritingSettings | null> {
    const p = this.prefs.get(userId);
    return p ? structuredClone(p) : null;
  }

  async setPreferences(userId: string, settings: HandwritingSettings): Promise<void> {
    this.prefs.set(userId, structuredClone(settings));
  }
}
