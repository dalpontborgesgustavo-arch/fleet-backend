import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationRoot = join(root, 'prisma', 'migrations');
const manifestPath = join(root, 'prisma', 'applied-migrations.sha256');
const withDatabase = process.argv.includes('--database');

function fail(message) {
  throw new Error(`Migrações fora de sincronia: ${message}`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const pinned = new Map();
for (const line of readFileSync(manifestPath, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const match = line.match(/^([a-f0-9]{64})  ([0-9]{14}_[A-Za-z0-9_]+)$/);
  if (!match) fail('manifesto de checksums inválido');
  const [, checksum, name] = match;
  if (pinned.has(name)) fail(`migração duplicada no manifesto: ${name}`);
  pinned.set(name, checksum);
}

const files = new Map();
for (const entry of readdirSync(migrationRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const path = join(migrationRoot, entry.name, 'migration.sql');
  files.set(entry.name, sha256(path));
}

for (const [name, checksum] of pinned) {
  if (!files.has(name)) fail(`arquivo aplicado ausente: ${name}`);
  if (files.get(name) !== checksum) {
    fail(`checksum alterado de migração já aplicada: ${name}`);
  }
}

if (withDatabase) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: join(root, '.env'), quiet: true });
  if (!process.env.DATABASE_URL) fail('DATABASE_URL indisponível');

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"',
    );
    const applied = new Map();
    for (const row of rows) {
      if (!row.finished_at && !row.rolled_back_at) {
        fail(`migração falhou e não foi revertida: ${row.migration_name}`);
      }
      if (!row.finished_at || row.rolled_back_at) continue;
      if (applied.has(row.migration_name)) {
        fail(`migração aplicada mais de uma vez: ${row.migration_name}`);
      }
      applied.set(row.migration_name, row.checksum);
    }
    for (const [name, checksum] of applied) {
      if (!files.has(name)) fail(`migração do banco ausente no Git: ${name}`);
      if (files.get(name) !== checksum) {
        fail(`checksum do banco difere do Git: ${name}`);
      }
    }
    for (const name of files.keys()) {
      if (!applied.has(name)) fail(`migração ainda não aplicada: ${name}`);
    }
    console.log(`Banco e Git alinhados: ${applied.size} migrações aplicadas.`);
  } finally {
    await prisma.$disconnect();
  }
} else {
  console.log(
    `Checksums preservados: ${pinned.size} migrações aplicadas; ${files.size - pinned.size} migrações novas.`,
  );
}
