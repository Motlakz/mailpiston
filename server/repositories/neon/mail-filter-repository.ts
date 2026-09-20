import 'server-only';

import { asc, eq } from 'drizzle-orm';

import { ConflictError } from '@/server/core/errors';
import { newId } from '@/server/core/ids';
import type { MailFilterEntry } from '@/server/core/types';
import { db } from '@/server/db/client';
import { mailFilterEntries } from '@/server/db/schema';
import type { MailFilterRepository } from '@/server/repositories/types';

import { isUniqueViolation } from './domain-repository';

export class NeonMailFilterRepository implements MailFilterRepository {
  async list(): Promise<MailFilterEntry[]> {
    const rows = await db
      .select()
      .from(mailFilterEntries)
      .orderBy(asc(mailFilterEntries.kind), asc(mailFilterEntries.pattern));

    return rows.map(toEntry);
  }

  /**
   * Both lists in one round trip, in the shape the classifier takes.
   *
   * Read on every inbound delivery, which is why it is one query returning two
   * arrays of strings rather than the full rows: the classifier only ever
   * compares patterns, and the notes and timestamps are for the settings screen.
   */
  async lists(): Promise<{ allow: string[]; deny: string[] }> {
    const rows = await db
      .select({
        kind: mailFilterEntries.kind,
        pattern: mailFilterEntries.pattern,
      })
      .from(mailFilterEntries);

    return {
      allow: rows.filter((row) => row.kind === 'allow').map((row) => row.pattern),
      deny: rows.filter((row) => row.kind === 'deny').map((row) => row.pattern),
    };
  }

  async add(data: {
    kind: MailFilterEntry['kind'];
    pattern: string;
    note: string | null;
  }): Promise<MailFilterEntry> {
    try {
      const [row] = await db
        .insert(mailFilterEntries)
        .values({
          id: newId('filter'),
          kind: data.kind,
          // Lower-cased on the way in so the unique index and the classifier's
          // comparison agree without either having to remember.
          pattern: data.pattern.trim().toLowerCase(),
          note: data.note,
        })
        .returning();

      return toEntry(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          `${data.pattern} is already on the ${data.kind} list`,
        );
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    await db.delete(mailFilterEntries).where(eq(mailFilterEntries.id, id));
  }
}

function toEntry(row: typeof mailFilterEntries.$inferSelect): MailFilterEntry {
  return {
    id: row.id,
    kind: row.kind,
    pattern: row.pattern,
    note: row.note,
    createdAt: row.createdAt,
  };
}
