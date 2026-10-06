import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

// Compare a freshly built dist against the currently deployed dist before release.
// Only explicitly reviewed, exact output paths may change.
const [builtArgument, deployedArgument, ...options] = process.argv.slice(2);
if (!builtArgument || !deployedArgument) {
  console.error('Uso: node scripts/compare-runtime-artifacts.mjs <dist-build> <dist-produção> [--allow=src/arquivo.js]');
  process.exit(2);
}

const builtRoot = resolve(builtArgument);
const deployedRoot = resolve(deployedArgument);
for (const root of [builtRoot, deployedRoot]) {
  if (!existsSync(root)) {
    console.error(`Diretório não encontrado: ${root}`);
    process.exit(2);
  }
}

const allowed = new Set();
for (const option of options) {
  if (!option.startsWith('--allow=')) {
    console.error(`Opção inválida: ${option}`);
    process.exit(2);
  }
  const path = option.slice('--allow='.length).replaceAll('\\', '/');
  if (!path.endsWith('.js') || path.startsWith('/') || path.includes('..') || isAbsolute(path)) {
    console.error(`Caminho de exceção inválido: ${path}`);
    process.exit(2);
  }
  allowed.add(path);
}

function collect(root) {
  const files = new Map();
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const name = relative(root, path).split(sep).join('/');
        const normalized = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
        files.set(name, createHash('sha256').update(normalized).digest('hex'));
      }
    }
  }
  walk(root);
  return files;
}

const built = collect(builtRoot);
const deployed = collect(deployedRoot);
const differences = [...new Set([...built.keys(), ...deployed.keys()])]
  .sort()
  .filter((name) => built.get(name) !== deployed.get(name));
const unexpected = differences.filter((name) => !allowed.has(name));
const staleAllowlist = [...allowed].filter((name) => !differences.includes(name));

console.log(`Artefatos JS: build=${built.size}, produção=${deployed.size}.`);
for (const name of differences) {
  const kind = !built.has(name) ? 'só em produção' : !deployed.has(name) ? 'só no build' : 'conteúdo diferente';
  console.log(`${allowed.has(name) ? 'PERMITIDO' : 'BLOQUEADO'} ${name} (${kind})`);
}
for (const name of staleAllowlist) console.error(`Exceção sem diferença correspondente: ${name}`);

if (unexpected.length || staleAllowlist.length) {
  console.error(`Publicação bloqueada: ${unexpected.length} diferença(s) não autorizada(s).`);
  process.exit(1);
}
console.log('Comparação aprovada: somente as diferenças explicitamente autorizadas.');
