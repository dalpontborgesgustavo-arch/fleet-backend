import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only production preflight. Run from a separate clean checkout, never from
// the directory whose dist is serving live traffic.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [deployedDist, ...allowOptions] = process.argv.slice(2);
if (!deployedDist || allowOptions.some((option) => !option.startsWith('--allow='))) {
  console.error('Uso: node scripts/verify-backend-release.mjs <dist-em-produção> [--allow=src/arquivo.js]');
  process.exit(2);
}

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
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
const remoteMain = run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0];
if (head !== remoteMain) fail('HEAD difere de origin/main.');

const node = process.execPath;
run(node, [join(root, 'scripts', 'verify-applied-migrations.mjs'), '--database']);
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
run(node, [join(root, 'scripts', 'compare-runtime-artifacts.mjs'), join(root, 'dist'), deployedDist, ...allowOptions]);

console.log(`Pré-publicação aprovada para o commit ${head}. Nenhum serviço foi alterado.`);
