import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubRepository, verifyCiArtifact } from './verify-ci-artifact.mjs';

// Read-only production preflight. Run from a separate clean checkout, never from
// the directory whose dist is serving live traffic.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [deployedDist, ...options] = process.argv.slice(2);
const allowOptions = options.filter((option) => option.startsWith('--allow='));
const ciOptions = options.filter((option) =>
  option.startsWith('--ci-artifact='),
);
const idOptions = options.filter((option) =>
  option.startsWith('--artifact-id='),
);
if (
  !deployedDist ||
  options.length !==
    allowOptions.length + ciOptions.length + idOptions.length ||
  ciOptions.length > 1 ||
  idOptions.length > 1 ||
  ciOptions.length !== idOptions.length
) {
  console.error(
    'Uso: node scripts/verify-backend-release.mjs <dist-em-produção> [--ci-artifact=/caminho/artifact.zip --artifact-id=123] [--allow=src/arquivo.js]',
  );
  process.exit(2);
}
if (process.platform === 'win32') {
  console.error(
    'Execute este preflight no servidor Linux, em um checkout isolado do serviço ativo.',
  );
  process.exit(2);
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

function fail(message) {
  throw new Error(`Publicação do backend bloqueada: ${message}`);
}

if (run('git', ['branch', '--show-current']) !== 'main') {
  fail('o checkout de release deve estar na branch main.');
}
if (run('git', ['status', '--porcelain=v1', '--untracked-files=all'])) {
  fail('o checkout contém alterações ou arquivos não versionados.');
}
const head = run('git', ['rev-parse', 'HEAD']);
const remoteMain = run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(
  /\s+/,
)[0];
if (head !== remoteMain) fail('HEAD difere de origin/main.');

const node = process.execPath;
if (ciOptions.length) {
  const verified = await verifyCiArtifact({
    root,
    zipPath: ciOptions[0].slice('--ci-artifact='.length),
    artifactId: idOptions[0].slice('--artifact-id='.length),
    head,
    repository: githubRepository(run('git', ['remote', 'get-url', 'origin'])),
  });
  console.log(
    `Artefato CI verificado: run=${verified.runId}, artifact=${verified.artifactId}, SHA=${verified.commit}, ZIP=${verified.zipSha256}, arquivos=${verified.fileCount}.`,
  );
}
run(node, [
  join(root, 'scripts', 'verify-applied-migrations.mjs'),
  '--database',
]);
if (!ciOptions.length) run('npm', ['run', 'build']);
run(node, [
  join(root, 'scripts', 'compare-runtime-artifacts.mjs'),
  join(root, 'dist'),
  deployedDist,
  ...allowOptions,
]);

console.log(
  `Pré-publicação aprovada para o commit ${head}. Nenhum serviço foi alterado.`,
);
