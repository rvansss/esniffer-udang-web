/**
 * Worker Database Client Module
 * Provides database access for the background worker process.
 */
export {
  prisma,
  dbPool,
  allocateHistorySequence,
  getCurrentWatermark,
  closeDb,
} from '../lib/db/client.ts';
