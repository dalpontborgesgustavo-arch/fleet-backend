import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  githubRepository,
  validateOrigin,
  verifyCiArtifact,
} from './verify-ci-artifact.mjs';

const head = 'a'.repeat(40);
const repository = 'example/backend';
const artifactId = 123;
const files = {
  'dist/src/main.js': 'console.log("verified runtime");\n',
  'dist/src/main.js.map': '{"version":3}',
  'node_modules/.prisma/client/index.js': 'module.exports = {};\n',
  'prisma/schema.prisma': 'datasource db { provider = "postgresql" }\n',
  'package.json': '{"private":true}',
  'package-lock.json': '{"lockfileVersion":3}',
};
function metadata(digest = 'b'.repeat(64)) {
  return {
    artifact: {
      id: artifactId,
      name: `backend-release-${head}`,
      expired: false,
      digest: `sha256:${digest}`,
      workflow_run: { id: 456, head_sha: head },
    },
    run: {
      id: 456,
      head_sha: head,
      head_branch: 'main',
      event: 'push',
      path: '.github/workflows/backend-verify.yml',
      status: 'completed',
      conclusion: 'success',
      repository: { full_name: repository },
      head_repository: { full_name: repository },
    },
    repository,
    head,
    artifactId,
  };
}

test('origin accepts only the expected main push and complete successful workflow', () => {
  assert.equal(validateOrigin(metadata()), 'b'.repeat(64));
  assert.equal(
    githubRepository('https://github.com/example/backend.git'),
    repository,
  );
  assert.equal(
    githubRepository('git@github.com:example/backend.git'),
    repository,
  );
  assert.throws(
    () => githubRepository('https://elsewhere.test/example/backend'),
    /origin/,
  );
});

for (const [name, change] of [
  [
    'wrong artifact id',
    (m) => {
      m.artifact.id = 321;
    },
  ],
  [
    'expired artifact',
    (m) => {
      m.artifact.expired = true;
    },
  ],
  [
    'wrong artifact name',
    (m) => {
      m.artifact.name = 'other';
    },
  ],
  [
    'absent official digest',
    (m) => {
      delete m.artifact.digest;
    },
  ],
  [
    'wrong run',
    (m) => {
      m.run.id = 999;
    },
  ],
  [
    'wrong commit',
    (m) => {
      m.run.head_sha = 'c'.repeat(40);
    },
  ],
  [
    'wrong artifact commit',
    (m) => {
      m.artifact.workflow_run.head_sha = 'c'.repeat(40);
    },
  ],
  [
    'wrong repository',
    (m) => {
      m.run.repository.full_name = 'other/backend';
    },
  ],
  [
    'fork head repository',
    (m) => {
      m.run.head_repository.full_name = 'fork/backend';
    },
  ],
  [
    'wrong branch',
    (m) => {
      m.run.head_branch = 'feature';
    },
  ],
  [
    'pull request run',
    (m) => {
      m.run.event = 'pull_request';
    },
  ],
  [
    'wrong workflow',
    (m) => {
      m.run.path = '.github/workflows/other.yml';
    },
  ],
  [
    'running workflow',
    (m) => {
      m.run.status = 'in_progress';
    },
  ],
  [
    'failed workflow',
    (m) => {
      m.run.conclusion = 'failure';
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    const value = metadata();
    change(value);
    assert.throws(() => validateOrigin(value), /Artefato CI recusado/);
  });
}

const fixtureWriter = String.raw`
import hashlib, io, json, sys, tarfile, zipfile
data=json.loads(sys.argv[2]); output=io.BytesIO()
with tarfile.open(fileobj=output,mode='w:gz') as tar:
    for name,content in data['files'].items():
        raw=content.encode(); item=tarfile.TarInfo(name); item.size=len(raw)
        tar.addfile(item,io.BytesIO(raw))
    if data.get('traversal'):
        item=tarfile.TarInfo('../outside'); item.size=1; tar.addfile(item,io.BytesIO(b'x'))
    if data.get('link'):
        item=tarfile.TarInfo('dist/link'); item.type=tarfile.SYMTYPE; item.linkname='/etc/passwd'; tar.addfile(item)
payload=output.getvalue()
checksum=('0'*64 if data.get('badChecksum') else hashlib.sha256(payload).hexdigest())+'  backend-release.tgz\n'
with zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('backend-release.tgz',payload)
    archive.writestr('backend-release.sha256',checksum)
    if data.get('extraZip'): archive.writestr('unexpected.txt','x')
`;

async function fixture(t, options = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'jr-ci-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'candidate');
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
  // Dependencies outside the two controlled directories remain installable.
  await mkdir(join(root, 'node_modules/unrelated-dependency'), {
    recursive: true,
  });
  await writeFile(
    join(root, 'node_modules/unrelated-dependency/index.js'),
    'ignored',
  );
  const zipPath = join(temporary, 'artifact.zip');
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', [
    '-c',
    fixtureWriter,
    zipPath,
    JSON.stringify({ files, ...options }),
  ]);
  const digest = createHash('sha256')
    .update(await readFile(zipPath))
    .digest('hex');
  const origin = metadata(digest);
  const api = async (path) =>
    path.endsWith(`/artifacts/${artifactId}`) ? origin.artifact : origin.run;
  return { root, zipPath, artifactId, head, repository, api, origin };
}

test('verifies the official ZIP, tgz, exact payload and source files', async (t) => {
  const value = await fixture(t);
  const result = await verifyCiArtifact(value);
  assert.equal(result.fileCount, Object.keys(files).length);
  assert.equal(result.commit, head);
  assert.equal(result.artifactId, artifactId);
});

test('rejects a ZIP differing from the official API digest', async (t) => {
  const value = await fixture(t);
  value.origin.artifact.digest = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(verifyCiArtifact(value), /ZIP difere/);
});

for (const name of [
  'dist/src/main.js',
  'node_modules/.prisma/client/index.js',
  'prisma/schema.prisma',
  'package.json',
  'package-lock.json',
]) {
  test(`rejects altered candidate ${name}`, async (t) => {
    const value = await fixture(t);
    await writeFile(join(value.root, name), 'modified');
    await assert.rejects(
      verifyCiArtifact(value),
      /inventario\/hash divergente/,
    );
  });
}

test('rejects an extra candidate runtime file', async (t) => {
  const value = await fixture(t);
  await writeFile(join(value.root, 'dist/extra.js'), 'extra');
  await assert.rejects(verifyCiArtifact(value), /inventario\/hash divergente/);
});

for (const option of ['traversal', 'link', 'extraZip', 'badChecksum']) {
  test(`rejects unsafe or inconsistent archive: ${option}`, async (t) => {
    const value = await fixture(t, { [option]: true });
    await assert.rejects(verifyCiArtifact(value), /Artefato CI recusado/);
  });
}

test('does not accept a generic skip-build switch or incomplete artifact options', () => {
  for (const option of [
    '--skip-build',
    '--ci-artifact=artifact.zip',
    '--artifact-id=123',
  ]) {
    const result = spawnSync(
      process.execPath,
      ['scripts/verify-backend-release.mjs', 'dist', option],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Uso:/);
  }
});
