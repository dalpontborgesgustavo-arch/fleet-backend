import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

export const SSMA_WORK_PRODUCT_CODES = [
  '7085',
  '13189',
  '14515',
  '15016',
  '17410',
  '17411',
] as const;
const PRODUCT_SET = new Set<string>(SSMA_WORK_PRODUCT_CODES);
const MONEY_PATTERN = /^-?\d{1,15}(?:\.\d{1,2})?$/;
const DECIMAL_PATTERN = /^-?\d{1,15}(?:\.\d{1,6})?$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/;

export interface SsmaBudgetLine {
  sourceId: string;
  workCode: string;
  workName: string | null;
  companyCode: string | null;
  productCode: string;
  productDescription: string;
  unit: string | null;
  parentSourceId: string | null;
  stageId: string | null;
  quantity: string | null;
  unitCost: string | null;
  amount: string | null;
  status: string;
  isOriginal: boolean;
}

export interface SsmaActualLine {
  sourceKey: string;
  workCode: string;
  workName: string | null;
  companyCode: string | null;
  productCode: string;
  productDescription: string;
  entryDate: string;
  status: 'F' | 'C';
  unit: string | null;
  quantity: string | null;
  unitCost: string | null;
  amount: string | null;
  accountCode: string | null;
  documentType: string | null;
  documentId: string | null;
  documentItemId: string | null;
  stageId: string | null;
}

export interface SsmaWorkSnapshot {
  runId: string;
  generatedAt: string;
  fullSnapshot: true;
  productCodes: string[];
  budgets: SsmaBudgetLine[];
  actuals: SsmaActualLine[];
  payloadHash: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' deve ser um objeto');
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(label + ' invalido');
  }
  return value.trim();
}

function optionalText(
  value: unknown,
  label: string,
  maxLength = 200,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  return requiredText(value, label, maxLength);
}

export function normalizeProductCode(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!/^\d{1,8}$/.test(raw)) throw new Error('codigo de produto invalido');
  const code = String(Number(raw));
  if (!PRODUCT_SET.has(code)) throw new Error('produto fora do escopo SSMA');
  return code;
}

function decimal(value: unknown, label: string, money = false): string | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = typeof value === 'number' ? String(value) : value;
  if (
    typeof raw !== 'string' ||
    !(money ? MONEY_PATTERN : DECIMAL_PATTERN).test(raw)
  ) {
    throw new Error(label + ' invalido');
  }
  const parsed = new Prisma.Decimal(raw);
  if (money) return parsed.toFixed(2);
  return parsed.toFixed(6).replace(/(?:\.0+|(\.\d*?)0+)$/, '$1');
}

function budget(value: unknown): SsmaBudgetLine {
  const row = record(value, 'linha de orcamento');
  if (typeof row.isOriginal !== 'boolean')
    throw new Error('isOriginal invalido');
  return {
    sourceId: requiredText(row.sourceId, 'sourceId', 100),
    workCode: requiredText(row.workCode, 'workCode', 60),
    workName: optionalText(row.workName, 'workName', 300),
    companyCode: optionalText(row.companyCode, 'companyCode', 60),
    productCode: normalizeProductCode(row.productCode),
    productDescription: requiredText(
      row.productDescription,
      'productDescription',
      300,
    ),
    unit: optionalText(row.unit, 'unit', 30),
    parentSourceId: optionalText(row.parentSourceId, 'parentSourceId', 100),
    stageId: optionalText(row.stageId, 'stageId', 100),
    quantity: decimal(row.quantity, 'quantity'),
    unitCost: decimal(row.unitCost, 'unitCost'),
    amount: decimal(row.amount, 'amount', true),
    status: requiredText(row.status, 'status', 20),
    isOriginal: row.isOriginal,
  };
}

function actual(value: unknown): SsmaActualLine {
  const row = record(value, 'apropriacao');
  const status = requiredText(row.status, 'status', 1);
  if (status !== 'F' && status !== 'C')
    throw new Error('status da apropriacao invalido');
  const entryDate = requiredText(row.entryDate, 'entryDate', 10);
  const parsedDay = new Date(entryDate + 'T00:00:00Z');
  if (
    !DAY_PATTERN.test(entryDate) ||
    Number.isNaN(parsedDay.getTime()) ||
    parsedDay.toISOString().slice(0, 10) !== entryDate
  ) {
    throw new Error('entryDate invalido');
  }
  const amount = decimal(row.amount, 'amount', true);
  if (status === 'F' && amount === null) {
    throw new Error('apropriacao finalizada sem valor');
  }
  return {
    sourceKey: requiredText(row.sourceKey, 'sourceKey', 200),
    workCode: requiredText(row.workCode, 'workCode', 60),
    workName: optionalText(row.workName, 'workName', 300),
    companyCode: optionalText(row.companyCode, 'companyCode', 60),
    productCode: normalizeProductCode(row.productCode),
    productDescription: requiredText(
      row.productDescription,
      'productDescription',
      300,
    ),
    entryDate,
    status,
    unit: optionalText(row.unit, 'unit', 30),
    quantity: decimal(row.quantity, 'quantity'),
    unitCost: decimal(row.unitCost, 'unitCost'),
    amount,
    accountCode: optionalText(row.accountCode, 'accountCode', 60),
    documentType: optionalText(row.documentType, 'documentType', 30),
    documentId: optionalText(row.documentId, 'documentId', 100),
    documentItemId: optionalText(row.documentItemId, 'documentItemId', 100),
    stageId: optionalText(row.stageId, 'stageId', 100),
  };
}

function uniqueKeys<T>(rows: T[], key: (row: T) => string, label: string) {
  const keys = new Set<string>();
  for (const row of rows) {
    const current = key(row);
    if (keys.has(current)) throw new Error(label + ' duplicada: ' + current);
    keys.add(current);
  }
}

export function normalizeSsmaWorkSnapshot(value: unknown): SsmaWorkSnapshot {
  const input = record(value, 'payload');
  const runId = requiredText(input.runId, 'runId', 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,99}$/.test(runId)) {
    throw new Error('runId invalido');
  }
  const generatedAt = requiredText(input.generatedAt, 'generatedAt', 40);
  const generatedDate = new Date(generatedAt);
  if (
    !UTC_TIMESTAMP_PATTERN.test(generatedAt) ||
    Number.isNaN(generatedDate.getTime()) ||
    generatedDate.toISOString().slice(0, 19) !== generatedAt.slice(0, 19)
  ) {
    throw new Error('generatedAt invalido');
  }
  if (generatedDate.getTime() > Date.now() + 10 * 60_000) {
    throw new Error('generatedAt no futuro');
  }
  if (input.fullSnapshot !== true)
    throw new Error('fotografia completa obrigatoria');
  if (!Array.isArray(input.productCodes))
    throw new Error('productCodes invalido');
  const productCodes = input.productCodes.map(normalizeProductCode).sort();
  if (
    productCodes.length !== SSMA_WORK_PRODUCT_CODES.length ||
    productCodes.some(
      (code, index) => code !== [...SSMA_WORK_PRODUCT_CODES].sort()[index],
    )
  ) {
    throw new Error('escopo de produtos incompleto');
  }
  if (!Array.isArray(input.budgets) || !Array.isArray(input.actuals)) {
    throw new Error('budgets e actuals obrigatorios');
  }
  if (
    input.budgets.length < 1 ||
    input.budgets.length > 10_000 ||
    input.actuals.length < 1 ||
    input.actuals.length > 20_000
  ) {
    throw new Error('contagem fora dos limites da fotografia completa');
  }
  const budgets = input.budgets
    .map(budget)
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const actuals = input.actuals
    .map(actual)
    .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
  uniqueKeys(budgets, (row) => row.sourceId, 'linha de orcamento');
  uniqueKeys(actuals, (row) => row.sourceKey, 'apropriacao');
  const payloadHash = createHash('sha256')
    .update(JSON.stringify({ productCodes, budgets, actuals }))
    .digest('hex');
  return {
    runId,
    generatedAt: generatedDate.toISOString(),
    fullSnapshot: true,
    productCodes,
    budgets,
    actuals,
    payloadHash,
  };
}
