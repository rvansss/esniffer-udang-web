import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dbPool, closeDb } from '../../lib/db/client.ts';

test('new migration preserves historical values and leaves species unknown', async () => {
  const client = await dbPool.connect();
  const schema = `migration_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(`
      CREATE TABLE collection_batches (batch_id text PRIMARY KEY, market_source text);
      CREATE TABLE sample_groups (group_id text PRIMARY KEY, lab_temp_c numeric(5,2) NOT NULL, lab_weight_before_g numeric(8,2) NOT NULL, lab_weight_after_g numeric(8,2));
      CREATE TABLE measurement_sessions (chamber_id uuid, started_at_utc timestamptz);
      INSERT INTO collection_batches VALUES ('legacy', 'Pasar lama');
      INSERT INTO sample_groups VALUES ('legacy-SR', 7.25, 480.50, 475.25);
    `);
    const sql = await readFile(new URL('../../prisma/migrations/20261105090000_batch_shrimp_type/migration.sql', import.meta.url), 'utf8');
    await client.query(sql);
    assert.deepEqual((await client.query('SELECT market_source, shrimp_type FROM collection_batches')).rows, [{ market_source: 'Pasar lama', shrimp_type: null }]);
    assert.deepEqual((await client.query('SELECT lab_temp_c, lab_weight_before_g, lab_weight_after_g FROM sample_groups')).rows, [{ lab_temp_c: '7.25', lab_weight_before_g: '480.50', lab_weight_after_g: '475.25' }]);
    await client.query("INSERT INTO sample_groups (group_id) VALUES ('new-SD')");
    assert.equal((await client.query("SELECT lab_temp_c FROM sample_groups WHERE group_id = 'new-SD'")).rows[0].lab_temp_c, null);
  } finally {
    await client.query('ROLLBACK'); client.release(); await closeDb();
  }
});
