import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./python_artifacts.py', import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), 'h02-python-'));
const source = path.join(root, 'source');
mkdirSync(source);
mkdirSync(path.join(source, 'h02_demo'));
writeFileSync(path.join(source, 'h02_demo', '__init__.py'), 'ANSWER = 42\n');
writeFileSync(path.join(source, 'pyproject.toml'), `[build-system]\nrequires = ["setuptools", "wheel"]\nbuild-backend = "setuptools.build_meta"\n[project]\nname = "h02-demo"\nversion = "1.2.3.dev10"\nrequires-python = ">=3.12"\n`);
writeFileSync(path.join(source, 'setup.py'), 'from setuptools import setup\nsetup()\n');
writeFileSync(path.join(source, 'README.md'), 'Real local setuptools fixture.\n');
const env = { ...process.env };
delete env.PYTHONPATH;
const run = (args, options = {}) => spawnSync('python3', args, { encoding: 'utf8', env, ...options });
const built = run(['setup.py', '--quiet', 'sdist', 'bdist_wheel'], { cwd: source });
assert.equal(built.status, 0, `Real setuptools fixture build failed: ${built.stderr}\n${built.stdout}`);
const fixture = path.join(source, 'dist');
const wheelName = readdirSync(fixture).find(name => name.endsWith('.whl'));
const sdistName = readdirSync(fixture).find(name => name.endsWith('.tar.gz'));
assert.ok(wheelName && sdistName);
const expected = { schemaVersion: 2, adapter: 'python', bundleName: 'h02-demo', pythonVersion: '1.2.3.dev10', wheelTags: ['py3-none-any'] };
after(() => rmSync(root, { recursive: true, force: true }));

function sample(overrides = {}) {
  const dir = mkdtempSync(path.join(root, 'case-'));
  cpSync(fixture, path.join(dir, 'dist'), { recursive: true });
  const allocation = path.join(dir, 'allocation.json');
  writeFileSync(allocation, JSON.stringify({ ...expected, ...overrides }));
  return { dir, dist: path.join(dir, 'dist'), allocation };
}
function verify(value) { return run([script, 'verify', '--allocation', value.allocation, '--directory', value.dist]); }
function reject(value, pattern) {
  const result = verify(value);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  if (pattern) assert.match(result.stderr, pattern);
}
function mutateWheel(value, code) {
  const result = run(['-c', `from pathlib import Path\nfrom zipfile import ZipFile,ZIP_DEFLATED\nimport base64,csv,hashlib,io\np=Path(${JSON.stringify(path.join(value.dist, wheelName))})\nwith ZipFile(p) as z: files={n:z.read(n) for n in z.namelist()}\n${code}\nwith ZipFile(p,'w',ZIP_DEFLATED) as z:\n for n,b in files.items(): z.writestr(n,b)\n`]);
  assert.equal(result.status, 0, result.stderr);
}

 test('real setuptools wheel/sdist metadata and deterministic digests pass', () => {
  const value = sample();
  const first = verify(value);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(verify(value).stdout, first.stdout);
  const inventory = JSON.parse(first.stdout);
  assert.equal(inventory.length, 2);
  assert.equal(inventory.find(item => !item.tags).buildBackend, "setuptools.build_meta");
  assert.ok(inventory.every(item => item.packageName === 'h02-demo' && item.version === expected.pythonVersion && item.requiresPython === '>=3.12' && /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.deepEqual(inventory.find(item => item.tags).tags, ['py3-none-any']);
});

test('real wheel installs and imports from an unrelated directory', () => {
  const value = sample();
  const venv = path.join(value.dir, 'venv');
  let result = run(['-m', 'venv', '--without-pip', venv]);
  assert.equal(result.status, 0, result.stderr);
  result = run(['-m', 'pip', '--python', path.join(venv, 'bin', 'python'), 'install', '--no-deps', '--no-index', path.join(value.dist, wheelName)], { cwd: root });
  assert.equal(result.status, 0, result.stderr);
  const smoke = spawnSync(path.join(venv, 'bin', 'python'), ['-I', '-c', 'import h02_demo; from importlib.metadata import version; assert h02_demo.ANSWER == 42; assert version("h02-demo") == "1.2.3.dev10"'], { encoding: 'utf8', env, cwd: root });
  assert.equal(smoke.status, 0, smoke.stderr);
});

test('missing wheel/sdist and wrong configured Python/ABI variant fail', () => {
  const wheel = sample(); rmSync(path.join(wheel.dist, wheelName)); reject(wheel, /wheel variant/);
  const sdist = sample(); rmSync(path.join(sdist.dist, sdistName)); reject(sdist, /sdist/);
  reject(sample({ wheelTags: ['cp312-cp312-manylinux_2_17_x86_64'] }), /tag/);
  reject(sample({ wheelTags: ['py3-none-any', 'cp312-cp312-manylinux_2_17_x86_64'] }), /wheel variant/);
});

test('wrong native version, package identity and malformed allocation fail', () => {
  reject(sample({ pythonVersion: '1.2.3.dev0' }), /mismatch/);
  reject(sample({ bundleName: 'other-project' }), /mismatch/);
  reject(sample({ pythonVersion: '1.2.3-dev.10' }), /canonical/);
  reject(sample({ wheelTags: ['py2.py3-none-any'] }), /single canonical/);
  reject(sample({ wheelTags: ['py3-none-any', 'py3-none-any'] }), /Duplicate/);
  reject(sample({ schemaVersion: 1 }), /schema/);
});

test('corrupted bytes, embedded metadata, WHEEL and RECORD do not pass', () => {
  const corrupt = sample(); writeFileSync(path.join(corrupt.dist, wheelName), 'broken'); reject(corrupt);
  const gzip = sample(); const brokenGzip = readFileSync(path.join(gzip.dist, sdistName)); brokenGzip[brokenGzip.length - 8] ^= 1; writeFileSync(path.join(gzip.dist, sdistName), brokenGzip); reject(gzip, /CRC/);
  const metadata = sample(); mutateWheel(metadata, `n=next(n for n in files if n.endswith('/METADATA'))\nfiles[n]=files[n].replace(b'Version: 1.2.3.dev10',b'Version: 1.2.3.dev11')`); reject(metadata, /version mismatch/);
  const wheel = sample(); mutateWheel(wheel, `n=next(n for n in files if n.endswith('/WHEEL'))\nfiles[n]=files[n].replace(b'Tag: py3-none-any',b'Tag: cp312-cp312-linux_x86_64')`); reject(wheel, /tags differ/);
  const record = sample(); mutateWheel(record, `n=next(n for n in files if n.endswith('/__init__.py'))\nfiles[n]=b'ANSWER = 43\\n'`); reject(record, /RECORD checksum/);
  const missing = sample(); mutateWheel(missing, `del files[next(n for n in files if n.endswith('/RECORD'))]`); reject(missing, /Missing wheel RECORD/);
  const signature = sample(); mutateWheel(signature, `files['h02_demo-1.2.3.dev10.dist-info/RECORD.jws']=b'fake'`); reject(signature, /signatures/);
});

test('unsafe ZIP paths, duplicate entries and symlink distributions fail', () => {
  const traversal = sample(); mutateWheel(traversal, `files['../escape']=b'bad'`); reject(traversal, /Unsafe archive path/);
  const duplicate = sample(); const duplicated = run(['-c', `from zipfile import ZipFile\np=${JSON.stringify(path.join(duplicate.dist, wheelName))}\nwith ZipFile(p,'a') as z: z.writestr('h02_demo/__init__.py',b'bad')`]); assert.equal(duplicated.status, 0); reject(duplicate, /Duplicate ZIP/);
  const symlink = sample(); const linked = run(['-c', `from pathlib import Path\np=Path(${JSON.stringify(path.join(symlink.dist, wheelName))})\np.unlink(); p.symlink_to(${JSON.stringify(path.join(fixture, wheelName))})`]); assert.equal(linked.status, 0); reject(symlink, /symlink/);
});

test('sdist links, traversal, metadata constraints and wrong root fail', () => {
  for (const mode of ['link', 'traversal', 'version', 'requires', 'root', 'old-metadata']) {
    const value = sample();
    const result = run(['-c', `from pathlib import Path\nimport tarfile,io\np=Path(${JSON.stringify(path.join(value.dist, sdistName))})\nwith tarfile.open(p,'r:gz') as t: items=[(m,t.extractfile(m).read() if m.isfile() else b'') for m in t.getmembers()]\nmode=${JSON.stringify(mode)}\nwith tarfile.open(p,'w:gz') as t:\n for m,b in items:\n  if mode=='version' and m.name.endswith('/PKG-INFO'): b=b.replace(b'Version: 1.2.3.dev10',b'Version: 1.2.3.dev11'); m.size=len(b)\n  if mode=='requires' and m.name.endswith('/PKG-INFO'): b=b.replace(b'Requires-Python: >=3.12',b'Requires-Python: >=3.13'); m.size=len(b)\n  if mode=='old-metadata' and m.name.endswith('/PKG-INFO'): b=b.replace(b'Metadata-Version: 2.4',b'Metadata-Version: 2.1').replace(b'Metadata-Version: 2.3',b'Metadata-Version: 2.1').replace(b'Metadata-Version: 2.2',b'Metadata-Version: 2.1'); m.size=len(b)\n  if mode=='root': m.name=m.name.replace('h02_demo-','other-')\n  t.addfile(m,io.BytesIO(b) if m.isfile() else None)\n if mode in ('link','traversal'):\n  m=tarfile.TarInfo('h02_demo-1.2.3.dev10/evil' if mode=='link' else '../evil')\n  if mode=='link': m.type=tarfile.SYMTYPE; m.linkname='/tmp/evil'\n  t.addfile(m,io.BytesIO(b''))`]);
    assert.equal(result.status, 0, result.stderr); reject(value);
  }
});

test('only declared control receipt is allowed and transport extraction is fail closed', () => {
  const value = sample(); writeFileSync(path.join(value.dist, 'python-build-receipt.json'), '{}'); assert.equal(verify(value).status, 0);
  writeFileSync(path.join(value.dist, 'provenance.json'), '{}'); reject(value, /Unexpected artifact/);
  for (const filename of [wheelName, '../escape.whl', 'nested/demo.whl', 'evidence.json']) {
    const caseRoot = mkdtempSync(path.join(root, 'extract-'));
    const archive = path.join(caseRoot, 'artifact.zip');
    const result = run(['-c', `from zipfile import ZipFile\nwith ZipFile(${JSON.stringify(archive)},'w') as z: z.writestr(${JSON.stringify(filename)},b'fixture')`]); assert.equal(result.status, 0);
    const extracted = run([script, 'extract', '--archive', archive, '--directory', path.join(caseRoot, 'out')]);
    assert.equal(extracted.status, filename === wheelName ? 0 : 1, extracted.stderr);
    if (filename === wheelName) assert.equal(readFileSync(path.join(caseRoot, 'out', filename), 'utf8'), 'fixture');
  }
});

test('original source contract binds package, reviewed target, backend and Python constraints', () => {
  const value = sample();
  const pyproject = path.join(value.dir, 'pyproject.toml');
  const good = readFileSync(path.join(source, 'pyproject.toml'), 'utf8');
  writeFileSync(pyproject, good);
  const sourceCheck = (name = 'h02-demo', target = '1.2.3') => run([script, 'source', '--pyproject', pyproject, '--package-name', name, '--version-target', target]);
  assert.deepEqual(JSON.parse(sourceCheck().stdout), { backend: 'setuptools.build_meta', requiresPython: '>=3.12', versionMode: 'static' });
  const boundVerify = () => run([script, 'verify', '--allocation', value.allocation, '--directory', value.dist, '--source-pyproject', pyproject, '--version-target', '1.2.3']);
  assert.equal(boundVerify().status, 0);
  assert.equal(sourceCheck('wrong-project').status, 1);
  assert.equal(sourceCheck('h02-demo', '1.2.4').status, 1);
  for (const [changed, pattern] of [
    [good.replace('setuptools.build_meta', 'other.backend'), /backend mismatch/],
    [good.replace('>=3.12', '>=3.13'), /Requires-Python mismatch/],
    [good.replace('version = "1.2.3.dev10"', 'dynamic = ["version"]'), /version injection mode mismatch/],
  ]) {
    writeFileSync(pyproject, changed);
    assert.equal(sourceCheck().status, 0);
    const checked = boundVerify(); assert.equal(checked.status, 1); assert.match(checked.stderr, pattern);
  }
  writeFileSync(pyproject, good.replace('version = "1.2.3.dev10"', 'dynamic = ["version"]'));
  assert.equal(JSON.parse(sourceCheck().stdout).versionMode, 'dynamic');
  for (const changed of [good.replace('>=3.12', 'invalid'), good.replace('version = "1.2.3.dev10"', 'version = "1.2.3rc1"'), good.replace('version = "1.2.3.dev10"', '')]) {
    writeFileSync(pyproject, changed); assert.equal(sourceCheck().status, 1);
  }
});
