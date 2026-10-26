import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// Este ensaio cria tabelas e dados ficticios; somente banco local descartavel.
const endpoint = new URL(process.env.DATABASE_URL || '');
if (
  process.env.CONTRACT_APPROVAL_REHEARSAL !== '1' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
) {
  throw new Error(
    'Use CONTRACT_APPROVAL_REHEARSAL=1 e um PostgreSQL local descartavel.',
  );
}
const prisma = new PrismaClient();
const db = {
  exec(sql) {
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'db',
        'execute',
        '--stdin',
        '--schema',
        'prisma/schema.prisma',
      ],
      { input: sql, encoding: 'utf8', env: process.env },
    );
    if (result.status !== 0)
      throw new Error(
        result.stderr || result.stdout || 'Falha no SQL do ensaio',
      );
  },
  async query(sql, values = []) {
    if (/^\s*SELECT/i.test(sql))
      return { rows: await prisma.$queryRawUnsafe(sql, ...values) };
    await prisma.$executeRawUnsafe(sql, ...values);
    return { rows: [] };
  },
  close() {
    return prisma.$disconnect();
  },
};
await db.exec(
  "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='powerbi_reader') THEN CREATE ROLE powerbi_reader; END IF; END $$;",
);
for (const migration of [
  '20260721143000_add_aethos_contracts',
  '20260721223000_add_contract_workflows',
  '20260728153000_add_contract_contracted_dates',
  '20260813223000_add_pbi_adm_contract_views',
  '20260817133000_add_contract_signed_availability_target',
  '20260817140000_update_service_contract_total_target',
  '20261026220000_contract_approval_cycle',
]) {
  await db.exec(
    await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'),
  );
}
for (const [id, status, approved, contracted] of [
  ['open', 'A', '2026-09-16', '2026-09-22'],
  ['cancelled', 'C', '2026-09-16', '2026-09-22'],
  ['pending', 'P', '2026-09-16', null],
  ['hired', 'O', '2026-09-16', '2026-09-22'],
  ['legacy', 'F', null, null],
  ['complete', 'O', '2026-09-16', '2026-09-22'],
  ['reverse', 'O', '2026-09-16', '2026-09-22'],
]) {
  await db.query(
    `INSERT INTO "AethosContract" (id,"aethosId","companyAethosId","workAethosId","workName","contractorAethosId","contractorName","registeredAt","startDate","originalValue","statusCode","statusDescription","contentHash","updatedAt","approvedAt","approvalCycleContractedAt","approvalCycleSourceId","approvalCycleHistoryComplete","contractedAt","lastContractedAt") VALUES ($1,$1,'1','1','TEST','1','TEST','2026-09-01','2026-10-01',1,$2,$2,'test',now(),$3::timestamp,$4::timestamp,'history',true,'2026-09-22','2026-10-20')`,
    [id, status, approved, contracted],
  );
  await db.query(
    `INSERT INTO "ContractWorkflow" (id,"contractId",type,status,"updatedAt") VALUES($1,$1,'EMPREITEIRO','IN_PROGRESS',now())`,
    [id],
  );
}
async function stage(contract, key, sequence, date) {
  await db.query(
    `INSERT INTO "ContractWorkflowStage" (id,"workflowId",key,sequence,label,responsible,"completedAt","updatedAt") VALUES($1,$2,$3,$4,$3,'TEST',$5::timestamp,now())`,
    [contract + key, contract, key, sequence, date],
  );
}
await stage('hired', 'CONFERENCIA_ADMINISTRATIVO', 2, '2026-09-17');
await stage('hired', 'ENCAMINHAMENTO_JURIDICO', 4, '2026-09-19');
await stage('hired', 'VALIDACAO_JURIDICO', 5, '2026-09-23');
const keys = [
  'CONFERENCIA_ADMINISTRATIVO',
  'APROVACAO_DIRETOR_OPERACOES',
  'ENCAMINHAMENTO_JURIDICO',
  'VALIDACAO_JURIDICO',
  'ASSINATURA_EMPREITEIRO',
  'LIBERACAO_GERENTE_ADMINISTRATIVA',
];
for (const [i, key] of keys.entries()) {
  await stage('complete', key, i + 2, '2026-09-18');
  await stage('reverse', key, i + 2, i === 1 ? '2026-09-17' : '2026-09-18');
}
const contracts = (
  await db.query('SELECT * FROM bi.pbi_adm_contratos ORDER BY contrato_id')
).rows;
assert.equal(contracts.length, 5);
assert.ok(
  contracts.every((c) => !['A', 'C'].includes(c.status_contrato_codigo)),
);
const hired = contracts.find((c) => c.contrato_id === 'hired');
assert.equal(hired.lead_time_total_dias, 4);
assert.equal(hired.fluxo_status, 'Concluido');
assert.equal(hired.preenchimento_completo, false);
assert.equal(hired.indicador_concluido_elegivel, true);
assert.equal(hired.antecedencia_solicitacao_dias, 30);
assert.equal(hired.etapa_atual_ordem, null);
assert.equal(
  contracts.find((c) => c.contrato_id === 'legacy').lead_time_total_dias,
  null,
);
assert.equal(
  contracts.find((c) => c.contrato_id === 'complete').preenchimento_completo,
  true,
);
assert.equal(
  contracts.find((c) => c.contrato_id === 'reverse').preenchimento_completo,
  false,
);
const stages = (
  await db.query(
    'SELECT * FROM bi.pbi_adm_contratos_etapas ORDER BY contrato_id,etapa_ordem',
  )
).rows;
assert.equal(
  stages.find((s) => s.contrato_id === 'hired' && s.etapa_ordem === 2)
    .dias_etapa,
  1,
);
assert.equal(
  stages.find((s) => s.contrato_id === 'hired' && s.etapa_ordem === 4)
    .dias_etapa,
  null,
);
assert.equal(
  stages.find((s) => s.contrato_id === 'hired' && s.etapa_ordem === 5)
    .data_etapa,
  null,
);
assert.ok(
  stages
    .filter((s) => s.contrato_id === 'hired')
    .every((s) => !s.fase_atual_contrato),
);
const pending = stages.filter((s) => s.contrato_id === 'pending');
assert.equal(pending.filter((s) => s.fase_atual_contrato).length, 1);
assert.ok(pending[1].dias_etapa > 0);
assert.ok(pending.slice(2).every((s) => s.dias_etapa === null));
assert.ok(pending.every((s) => s.dias_etapa_concluida === null));
await db.query('SELECT * FROM bi.pbi_adm_resumo_etapas');
await db.query('SELECT * FROM bi.pbi_adm_resumo_mensal');
console.log(
  'PASS: additive migration replaces existing dependent views; 7 scenarios cover P/O/F/A/C, missing history, incomplete/reversed intervals, request notice and completed-only averages.',
);
await db.close();
