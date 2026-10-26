"""Extract only the fixed release payload from an authenticated GitHub artifact."""
import hashlib
import re
import shutil
import stat
import sys
import tarfile
import zipfile
from pathlib import Path, PurePosixPath

archive = Path(sys.argv[1])
target = Path(sys.argv[2]).resolve()
target.mkdir()
container = target.parent

def fail(message):
    raise ValueError('Artefato CI recusado: ' + message)

with zipfile.ZipFile(archive) as package:
    names = package.namelist()
    if len(names) != 2 or set(names) != {'backend-release.tgz', 'backend-release.sha256'}:
        fail('ZIP deve conter somente tgz e checksum, sem duplicatas')
    for item in package.infolist():
        if item.is_dir() or stat.S_ISLNK(item.external_attr >> 16):
            fail('tipo de entrada ZIP invalido')
    checksum = package.read('backend-release.sha256').decode('ascii').strip()
    match = re.fullmatch(r'([a-f0-9]{64})\s+\*?backend-release\.tgz', checksum)
    if not match:
        fail('checksum interno invalido')
    tgz = container / 'backend-release.tgz'
    digest = hashlib.sha256()
    with package.open('backend-release.tgz') as source, tgz.open('wb') as destination:
        while chunk := source.read(1024 * 1024):
            destination.write(chunk)
            digest.update(chunk)
    if digest.hexdigest() != match[1]:
        fail('checksum do tgz divergente')

allowed_files = {'prisma/schema.prisma', 'package.json', 'package-lock.json'}
allowed_parents = {'dist', 'node_modules', 'node_modules/.prisma', 'node_modules/.prisma/client', 'prisma'}
seen = set()
with tarfile.open(tgz, 'r:gz') as package:
    members = package.getmembers()
    for item in members:
        name = item.name.rstrip('/')
        path = PurePosixPath(name)
        if not name or '\\' in name or path.is_absolute() or '..' in path.parts or str(path) != name:
            fail('caminho inseguro no tgz')
        if name in seen:
            fail('caminho duplicado no tgz')
        seen.add(name)
        if not (item.isfile() or item.isdir()):
            fail('links e dispositivos nao sao permitidos')
        under_root = name.startswith('dist/') or name.startswith('node_modules/.prisma/client/')
        if item.isfile() and not (under_root or name in allowed_files):
            fail('arquivo fora das raizes controladas')
        if item.isdir() and not (under_root or name in allowed_parents):
            fail('diretorio fora das raizes controladas')
    for item in members:
        destination = target.joinpath(*PurePosixPath(item.name).parts)
        if target not in destination.resolve().parents:
            fail('destino fora do temporario')
        if item.isdir():
            destination.mkdir(parents=True, exist_ok=True)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            with package.extractfile(item) as source, destination.open('xb') as output:
                shutil.copyfileobj(source, output)
