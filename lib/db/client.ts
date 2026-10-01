import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configuredDatabaseUrl = env.DATABASE_URL?.trim();
  if (env.NODE_ENV === 'production' && !configuredDatabaseUrl) {
    throw new Error('Missing mandatory environment variable: DATABASE_URL in production');
  }
  return configuredDatabaseUrl || 'postgresql://localhost:5432/esniffer_dev';
}

const connectionString = resolveDatabaseUrl();

const pool = new pg.Pool({
  connectionString,
  max: parseInt(process.env.DATABASE_POOL_MAX || '5', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  options: '-c timezone=UTC',
});

const adapter = new PrismaPg(pool);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: pg.Pool | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });
export const dbPool = globalForPrisma.pool ?? pool;

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pool = dbPool;
}

/**
 * Atomically increments and returns the next history sequence.
 * Uses row-level lock on history_sequence_watermark (id=1) to ensure
 * strict monotonic sequence allocation across concurrent transactions.
 */
export async function allocateHistorySequence(
  client: PrismaClient | Prisma.TransactionClient = prisma
): Promise<bigint> {
  const rows = await client.$queryRaw<Array<{ current_sequence: bigint | number | string }>>`
    UPDATE history_sequence_watermark
    SET current_sequence = current_sequence + 1
    WHERE id = 1
    RETURNING current_sequence;
  `;

  if (!rows || rows.length === 0) {
    throw new Error('history_sequence_watermark row id=1 not found');
  }

  return BigInt(rows[0].current_sequence);
}

/**
 * Reads the current watermark sequence without incrementing.
 */
export async function getCurrentWatermark(
  client: PrismaClient | Prisma.TransactionClient = prisma
): Promise<bigint> {
  const rows = await client.$queryRaw<Array<{ current_sequence: bigint | number | string }>>`
    SELECT current_sequence FROM history_sequence_watermark WHERE id = 1;
  `;
  if (!rows || rows.length === 0) {
    return 0n;
  }
  return BigInt(rows[0].current_sequence);
}

/**
 * Closes the database pool and disconnects Prisma.
 * Useful for tests and graceful shutdown.
 */
export async function closeDb(): Promise<void> {
  await prisma.$disconnect();
  await dbPool.end();
}
