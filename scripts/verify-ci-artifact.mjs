import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const controlledDirectories = ['dist', 'node_modules/.prisma/client'];
const controlledFiles = [
  'prisma/schema.prisma',
  'package.json',
  'package-lock.json',
];

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Artefato CI recusado: ${message}`);
}

export function githubRepository(remote) {
  const match = remote
    .trim()
    .match(
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/,
    );
  requireCondition(
    match,
    'origin deve identificar um repositorio publico no github.com.',
  );
  return match[1];
}

export function validateOrigin({
  artifact,
  run,
  repository,
  head,
  artifactId,
}) {
  requireCondition(/^[a-f0-9]{40}$/.test(head), 'SHA do checkout invalido.');
  requireCondition(
    String(artifact.id) === String(artifactId),
    'artifactId divergente.',
  );
  requireCondition(
    artifact.expired === false,
    'artefato expirado ou sem estado verificavel.',
  );
  requireCondition(
    artifact.name === `backend-release-${head}`,
    'nome do artefato divergente.',
  );
  requireCondition(
    /^sha256:[a-f0-9]{64}$/.test(artifact.digest || ''),
    'digest oficial ausente ou invalido.',
  );
  requireCondition(
    String(artifact.workflow_run?.id) === String(run.id),
    'artefato pertence a outro run.',
  );
  requireCondition(
    artifact.workflow_run?.head_sha === head && run.head_sha === head,
    'SHA do artefato/run difere de HEAD.',
  );
  requireCondition(
    run.repository?.full_name?.toLowerCase() === repository.toLowerCase() &&
      run.head_repository?.full_name?.toLowerCase() ===
        repository.toLowerCase(),
    'repositorio do run divergente.',
  );
  requireCondition(
    run.head_branch === 'main' && run.event === 'push',
    'run deve ser push da branch main.',
  );
  requireCondition(
    run.path === '.github/workflows/backend-verify.yml',
    'workflow inesperado.',
  );
  requireCondition(
    run.status === 'completed' && run.conclusion === 'success',
    'workflow completo ainda nao aprovado.',
  );
  return artifact.digest.slice('sha256:'.length);
}

async function sha256(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function inventory(root) {
  const files = new Map();
  async function visit(path, expectDirectory = false) {
    const stat = await lstat(path);
    requireCondition(
      !stat.isSymbolicLink(),
      'links nao sao permitidos nas raizes verificadas.',
    );
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name));
    } else {
      requireCondition(
        !expectDirectory && stat.isFile(),
        'tipo de arquivo inesperado.',
      );
      files.set(relative(root, path).split(sep).join('/'), await sha256(path));
    }
  }
  for (const name of controlledDirectories) await visit(join(root, name), true);
  for (const name of controlledFiles) {
    const path = join(root, name);
    requireCondition(
      (await lstat(path)).isFile(),
      `${name} nao e arquivo regular.`,
    );
    await visit(path);
  }
  requireCondition(
    files.has('dist/src/main.js') &&
      files.has('node_modules/.prisma/client/index.js'),
    'payload de runtime incompleto.',
  );
  return files;
}

export async function comparePayload(payloadRoot, candidateRoot) {
  const expected = await inventory(payloadRoot);
  const candidate = await inventory(candidateRoot);
  const differences = [
    ...new Set([...expected.keys(), ...candidate.keys()]),
  ].filter((name) => expected.get(name) !== candidate.get(name));
  requireCondition(
    differences.length === 0,
    `inventario/hash divergente: ${differences.slice(0, 10).join(', ')}`,
  );
  return expected.size;
}

export function extractRelease(zipPath, targetRoot) {
  execFileSync(
    process.platform === 'win32' ? 'python' : 'python3',
    [
      fileURLToPath(new URL('./extract-ci-release.py', import.meta.url)),
      zipPath,
      targetRoot,
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    },
  );
}

async function githubApi(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jr-backend-release-preflight',
    },
    signal: AbortSignal.timeout(20000),
  });
  requireCondition(
    response.ok,
    `GitHub API indisponivel (${response.status}).`,
  );
  return response.json();
}

export async function verifyCiArtifact({
  root,
  zipPath,
  artifactId,
  head,
  repository,
  api = githubApi,
}) {
  requireCondition(
    /^[1-9][0-9]*$/.test(String(artifactId)),
    'artifactId invalido.',
  );
  const prefix = `/repos/${repository}/actions`;
  const artifact = await api(`${prefix}/artifacts/${artifactId}`);
  requireCondition(
    Number.isSafeInteger(artifact.workflow_run?.id) &&
      artifact.workflow_run.id > 0,
    'run do artefato ausente.',
  );
  const run = await api(`${prefix}/runs/${artifact.workflow_run.id}`);
  const expectedDigest = validateOrigin({
    artifact,
    run,
    repository,
    head,
    artifactId,
  });
  const temporary = await mkdtemp(join(tmpdir(), 'jr-ci-release-'));
  try {
    // Hash e extracao usam a mesma copia privada, sem reabrir o ZIP original.
    const zip = join(temporary, 'artifact.zip');
    await copyFile(resolve(zipPath), zip);
    requireCondition(
      (await sha256(zip)) === expectedDigest,
      'ZIP difere do digest oficial do GitHub.',
    );
    const payload = join(temporary, 'payload');
    extractRelease(zip, payload);
    const fileCount = await comparePayload(payload, resolve(root));
    return {
      artifactId: artifact.id,
      runId: run.id,
      commit: head,
      zipSha256: expectedDigest,
      fileCount,
    };
  } finally {
    // Caminho criado por mkdtemp exclusivamente para este ensaio.
    requireCondition(
      resolve(temporary).startsWith(resolve(tmpdir()) + sep + 'jr-ci-release-'),
      'diretorio temporario fora do destino esperado.',
    );
    await rm(temporary, { recursive: true, force: true });
  }
}
