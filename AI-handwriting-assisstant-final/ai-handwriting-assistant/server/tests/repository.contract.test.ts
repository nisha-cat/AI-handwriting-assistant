import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultHandwritingSettings } from '@hw/shared';
import { MemoryRepository } from '../src/db/memoryRepo';
import { MysqlRepository } from '../src/db/mysqlRepo';
import { createPool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import type { Repository } from '../src/db/types';
import { sampleDocument } from './helpers';

/**
 * The same behavioural contract is asserted against every Repository implementation.
 * MySQL runs only when TEST_DATABASE_URL points at a disposable database, e.g.
 *   TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/handwriting_test npm test -w server
 */
const mysqlUrl = process.env.TEST_DATABASE_URL;

const targets: Array<{ name: string; skip: boolean; make: () => Promise<Repository> }> = [
  { name: 'memory', skip: false, make: async () => new MemoryRepository() },
  {
    name: 'mysql',
    skip: !mysqlUrl,
    make: async () => {
      const pool = createPool(mysqlUrl!);
      await runMigrations(pool);
      return new MysqlRepository(pool);
    },
  },
];

for (const target of targets) {
  describe.skipIf(target.skip)(`Repository contract: ${target.name}`, () => {
    let repo: Repository;
    const hashes: string[] = [];
    const newUser = async () => {
      const hash = randomUUID().replace(/-/g, '').padEnd(64, '0');
      hashes.push(hash);
      return repo.ensureUser(hash);
    };

    beforeAll(async () => {
      repo = await target.make();
    });
    afterAll(async () => {
      await repo.close();
    });

    it('ping succeeds', async () => {
      await expect(repo.ping()).resolves.toBeUndefined();
    });

    it('ensureUser is stable for the same token hash and distinct across hashes', async () => {
      const hash = randomUUID().replace(/-/g, '').padEnd(64, '1');
      const a = await repo.ensureUser(hash);
      const b = await repo.ensureUser(hash);
      expect(a).toBe(b);
      expect(await repo.ensureUser(randomUUID().replace(/-/g, '').padEnd(64, '2'))).not.toBe(a);
    });

    it('ensureUser is safe under concurrent first requests', async () => {
      const hash = randomUUID().replace(/-/g, '').padEnd(64, '3');
      const ids = await Promise.all(Array.from({ length: 8 }, () => repo.ensureUser(hash)));
      expect(new Set(ids).size).toBe(1);
    });

    it('creates and round-trips a document including unicode and quotes', async () => {
      const u = await newUser();
      const input = sampleDocument('Quote "test" ✓ \'single\'', '# Heading\nLine with "quotes", \\backslash and emoji 😀');
      const { document, created } = await repo.createDocument(u, input);
      expect(created).toBe(true);
      const got = await repo.getDocument(u, document.id);
      expect(got).not.toBeNull();
      expect(got!.title).toBe(input.title);
      expect(got!.content.bodyText).toBe(input.content.bodyText);
      expect(got!.content.settings).toEqual(defaultHandwritingSettings());
      expect(got!.version).toBe(1);
      expect(Date.parse(got!.createdAt)).not.toBeNaN();
      expect(Date.parse(got!.updatedAt)).not.toBeNaN();
    });

    it('is idempotent per (user, key), and concurrent retries do not duplicate', async () => {
      const u = await newUser();
      const other = await newUser();
      const key = `key-${randomUUID()}`;
      const results = await Promise.all(Array.from({ length: 5 }, () => repo.createDocument(u, sampleDocument(), key)));
      expect(new Set(results.map((r) => r.document.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect((await repo.listDocuments(u, { limit: 50, offset: 0 })).total).toBe(1);
      const foreign = await repo.createDocument(other, sampleDocument(), key);
      expect(foreign.created).toBe(true);
      expect(foreign.document.id).not.toBe(results[0]!.document.id);
    });

    it('allows many documents with no idempotency key (NULLs do not collide)', async () => {
      const u = await newUser();
      for (let i = 0; i < 3; i++) await repo.createDocument(u, sampleDocument(`D${i}`));
      expect((await repo.listDocuments(u, { limit: 50, offset: 0 })).total).toBe(3);
    });

    it('lists newest-updated first with limit/offset and a correct total', async () => {
      const u = await newUser();
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        ids.push((await repo.createDocument(u, sampleDocument(`Doc ${i}`))).document.id);
        await new Promise((r) => setTimeout(r, 15));
      }
      await repo.updateDocument(u, ids[0]!, { title: 'Doc 0 touched' });
      const all = await repo.listDocuments(u, { limit: 50, offset: 0 });
      expect(all.total).toBe(4);
      expect(all.items[0]!.title).toBe('Doc 0 touched');
      expect(all.items[0]).not.toHaveProperty('content');
      const page = await repo.listDocuments(u, { limit: 2, offset: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(4);
    });

    it('snapshots previous content on update, but not on rename', async () => {
      const u = await newUser();
      const { document } = await repo.createDocument(u, sampleDocument('v1', '# One\nfirst'));
      const v2 = await repo.updateDocument(u, document.id, { title: 'v2', content: sampleDocument('v2', '# Two\nsecond').content });
      expect(v2!.version).toBe(2);
      expect(v2!.content.bodyText).toContain('second');
      expect(v2!.excerpt).toContain('second');
      const renamed = await repo.updateDocument(u, document.id, { title: 'renamed' });
      expect(renamed!.version).toBe(2);
      expect(renamed!.title).toBe('renamed');
      const versions = await repo.listVersions(u, document.id);
      expect(versions).toEqual([expect.objectContaining({ version: 1, title: 'v1' })]);
    });

    it('keeps at most 20 versions per document', async () => {
      const u = await newUser();
      const { document } = await repo.createDocument(u, sampleDocument('many'));
      for (let i = 0; i < 25; i++) {
        await repo.updateDocument(u, document.id, { content: sampleDocument('many', `# Rev ${i}\nbody`).content });
      }
      const versions = (await repo.listVersions(u, document.id))!;
      expect(versions.length).toBeLessThanOrEqual(20);
      expect(versions[0]!.version).toBe(25); // newest snapshot first
    });

    it('serialises concurrent updates without losing a version', async () => {
      const u = await newUser();
      const { document } = await repo.createDocument(u, sampleDocument('race'));
      await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          repo.updateDocument(u, document.id, { content: sampleDocument('race', `# R${i}\nbody`).content }),
        ),
      );
      const final = await repo.getDocument(u, document.id);
      expect(final!.version).toBe(5);
      expect((await repo.listVersions(u, document.id))!.map((v) => v.version).sort()).toEqual([1, 2, 3, 4]);
    });

    it('duplicates with a "(copy)" suffix and independent identity', async () => {
      const u = await newUser();
      const { document } = await repo.createDocument(u, sampleDocument('Original'));
      const copy = await repo.duplicateDocument(u, document.id);
      expect(copy!.id).not.toBe(document.id);
      expect(copy!.title).toBe('Original (copy)');
      expect(copy!.content.bodyText).toBe(document.content.bodyText);
      expect(copy!.version).toBe(1);
    });

    it('deletes a document and its versions', async () => {
      const u = await newUser();
      const { document } = await repo.createDocument(u, sampleDocument());
      await repo.updateDocument(u, document.id, { content: sampleDocument('x', '# New\nbody').content });
      expect(await repo.deleteDocument(u, document.id)).toBe(true);
      expect(await repo.getDocument(u, document.id)).toBeNull();
      expect(await repo.listVersions(u, document.id)).toBeNull();
      expect(await repo.deleteDocument(u, document.id)).toBe(false);
    });

    it("isolates users: nobody can touch another user's document", async () => {
      const owner = await newUser();
      const intruder = await newUser();
      const { document } = await repo.createDocument(owner, sampleDocument('Mine'));
      expect(await repo.getDocument(intruder, document.id)).toBeNull();
      expect(await repo.updateDocument(intruder, document.id, { title: 'pwned' })).toBeNull();
      expect(await repo.duplicateDocument(intruder, document.id)).toBeNull();
      expect(await repo.listVersions(intruder, document.id)).toBeNull();
      expect(await repo.deleteDocument(intruder, document.id)).toBe(false);
      expect((await repo.listDocuments(intruder, { limit: 50, offset: 0 })).total).toBe(0);
      expect((await repo.getDocument(owner, document.id))!.title).toBe('Mine');
    });

    it('is not vulnerable to SQL injection through ids or titles', async () => {
      const u = await newUser();
      await repo.createDocument(u, sampleDocument('keep me'));
      expect(await repo.getDocument(u, "' OR '1'='1")).toBeNull();
      expect(await repo.deleteDocument(u, "x' OR 1=1 --")).toBe(false);
      const evil = await repo.createDocument(u, sampleDocument("Robert'); DROP TABLE documents;--"));
      expect((await repo.getDocument(u, evil.document.id))!.title).toBe("Robert'); DROP TABLE documents;--");
      expect((await repo.listDocuments(u, { limit: 50, offset: 0 })).total).toBe(2);
    });

    it('stores and updates preferences per user', async () => {
      const u = await newUser();
      const other = await newUser();
      expect(await repo.getPreferences(u)).toBeNull();
      await repo.setPreferences(u, { ...defaultHandwritingSettings(), style: 'patrick' });
      await repo.setPreferences(u, { ...defaultHandwritingSettings(), style: 'kalam', fontSize: 22 });
      expect(await repo.getPreferences(u)).toMatchObject({ style: 'kalam', fontSize: 22 });
      expect(await repo.getPreferences(other)).toBeNull();
    });
  });
}
