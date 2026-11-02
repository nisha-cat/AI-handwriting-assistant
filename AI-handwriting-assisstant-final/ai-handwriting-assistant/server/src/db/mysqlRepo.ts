import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  documentContentSchema,
  handwritingSettingsSchema,
  makeExcerpt,
  type DocumentContent,
  type DocumentInput,
  type DocumentPatch,
  type DocumentRecord,
  type DocumentSummary,
  type DocumentVersionSummary,
  type HandwritingSettings,
} from '@hw/shared';
import { MAX_VERSIONS_PER_DOCUMENT, type CreateResult, type ListResult, type Repository } from './types';

interface DocRow extends RowDataPacket {
  id: string;
  title: string;
  mode: 'notes' | 'exam';
  excerpt: string;
  content: unknown;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();

/** mysql2 parses JSON columns for us, but stay defensive about string payloads. */
function parseContent(raw: unknown): DocumentContent {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  // Re-validating on read lets old rows pick up new defaults after schema evolution.
  return documentContentSchema.parse(value);
}

function toRecord(row: DocRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    excerpt: row.excerpt,
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    content: parseContent(row.content),
  };
}

export class MysqlRepository implements Repository {
  readonly kind = 'mysql' as const;
  constructor(private readonly pool: Pool) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ensureUser(tokenHash: string): Promise<string> {
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT id FROM users WHERE session_hash = ?', [tokenHash]);
    if (rows[0]) return rows[0].id as string;
    const id = randomUUID();
    // INSERT IGNORE handles two simultaneous first requests carrying the same new token.
    await this.pool.execute('INSERT IGNORE INTO users (id, session_hash) VALUES (?, ?)', [id, tokenHash]);
    const [again] = await this.pool.execute<RowDataPacket[]>('SELECT id FROM users WHERE session_hash = ?', [tokenHash]);
    return again[0]!.id as string;
  }

  async createDocument(userId: string, input: DocumentInput, idempotencyKey?: string): Promise<CreateResult> {
    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(userId, idempotencyKey);
      if (existing) return { document: existing, created: false };
    }
    const id = randomUUID();
    try {
      await this.pool.execute(
        `INSERT INTO documents (id, user_id, title, mode, excerpt, content, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          userId,
          input.title,
          input.content.mode,
          makeExcerpt(input.content.bodyText || input.content.rawText),
          JSON.stringify(input.content),
          idempotencyKey ?? null,
        ],
      );
    } catch (err) {
      // A concurrent retry with the same key won the race: return its document.
      if (idempotencyKey && (err as { code?: string }).code === 'ER_DUP_ENTRY') {
        const existing = await this.findByIdempotencyKey(userId, idempotencyKey);
        if (existing) return { document: existing, created: false };
      }
      throw err;
    }
    const document = await this.getDocument(userId, id);
    return { document: document!, created: true };
  }

  private async findByIdempotencyKey(userId: string, key: string): Promise<DocumentRecord | null> {
    const [rows] = await this.pool.execute<DocRow[]>(
      'SELECT * FROM documents WHERE user_id = ? AND idempotency_key = ?',
      [userId, key],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async listDocuments(userId: string, opts: { limit: number; offset: number }): Promise<ListResult> {
    const [countRows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM documents WHERE user_id = ?',
      [userId],
    );
    // LIMIT/OFFSET are validated integers; interpolate them because some MySQL builds reject placeholders here.
    const limit = Math.trunc(opts.limit);
    const offset = Math.trunc(opts.offset);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, title, mode, excerpt, created_at, updated_at
         FROM documents WHERE user_id = ? ORDER BY updated_at DESC, id LIMIT ${limit} OFFSET ${offset}`,
      [userId],
    );
    const items: DocumentSummary[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      mode: r.mode,
      excerpt: r.excerpt,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    }));
    return { items, total: Number(countRows[0]?.total ?? 0) };
  }

  async getDocument(userId: string, id: string): Promise<DocumentRecord | null> {
    const [rows] = await this.pool.execute<DocRow[]>('SELECT * FROM documents WHERE id = ? AND user_id = ?', [id, userId]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async updateDocument(userId: string, id: string, patch: DocumentPatch): Promise<DocumentRecord | null> {
    const conn: PoolConnection = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<DocRow[]>(
        'SELECT * FROM documents WHERE id = ? AND user_id = ? FOR UPDATE',
        [id, userId],
      );
      const current = rows[0];
      if (!current) {
        await conn.rollback();
        return null;
      }
      if (patch.content) {
        await conn.execute(
          'INSERT INTO document_versions (document_id, version, title, content) VALUES (?, ?, ?, ?)',
          [id, current.version, current.title, JSON.stringify(parseContent(current.content))],
        );
        await conn.execute(
          `UPDATE documents SET title = ?, mode = ?, excerpt = ?, content = ?, version = version + 1
            WHERE id = ? AND user_id = ?`,
          [
            patch.title ?? current.title,
            patch.content.mode,
            makeExcerpt(patch.content.bodyText || patch.content.rawText),
            JSON.stringify(patch.content),
            id,
            userId,
          ],
        );
        await conn.execute('DELETE FROM document_versions WHERE document_id = ? AND version <= ?', [
          id,
          current.version - MAX_VERSIONS_PER_DOCUMENT,
        ]);
      } else if (patch.title !== undefined) {
        await conn.execute('UPDATE documents SET title = ? WHERE id = ? AND user_id = ?', [patch.title, id, userId]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      throw err;
    } finally {
      conn.release();
    }
    return this.getDocument(userId, id);
  }

  async duplicateDocument(userId: string, id: string): Promise<DocumentRecord | null> {
    const source = await this.getDocument(userId, id);
    if (!source) return null;
    const { document } = await this.createDocument(userId, {
      title: `${source.title} (copy)`.slice(0, 120),
      content: source.content,
    });
    return document;
  }

  async deleteDocument(userId: string, id: string): Promise<boolean> {
    const [res] = await this.pool.execute<ResultSetHeader>('DELETE FROM documents WHERE id = ? AND user_id = ?', [id, userId]);
    return res.affectedRows > 0;
  }

  async listVersions(userId: string, id: string): Promise<DocumentVersionSummary[] | null> {
    const doc = await this.getDocument(userId, id);
    if (!doc) return null;
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT version, title, created_at FROM document_versions WHERE document_id = ? ORDER BY version DESC',
      [id],
    );
    return rows.map((r) => ({ version: r.version as number, title: r.title as string, createdAt: iso(r.created_at) }));
  }

  async getPreferences(userId: string): Promise<HandwritingSettings | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT settings FROM user_preferences WHERE user_id = ?', [userId]);
    if (!rows[0]) return null;
    const raw = typeof rows[0].settings === 'string' ? JSON.parse(rows[0].settings) : rows[0].settings;
    return handwritingSettingsSchema.parse(raw);
  }

  async setPreferences(userId: string, settings: HandwritingSettings): Promise<void> {
    await this.pool.execute(
      `INSERT INTO user_preferences (user_id, settings) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE settings = VALUES(settings)`,
      [userId, JSON.stringify(settings)],
    );
  }
}
