/**
 * The first step of every install build (`fetch`, `docs/research/M6-interfaces.md` §1.4): a Node program passed inline
 * to the pinned Node image (`node --input-type=module --eval`), because the bundle's own step scripts are inside the
 * tarball it fetches. It downloads `manifest.json` from the admin's own bundle folder (`HCM_BUNDLE_URL`), refuses to go
 * on unless its SHA-256 is the one the admin computed (`HCM_MANIFEST_SHA256`) and it names the admin's release, then
 * downloads each tarball of `HCM_FILES` (the target's first) and refuses any whose SHA-256 is not the manifest's, the
 * target's also not the one the admin chose (`HCM_FILE_SHA256`). It unpacks the target's tarball into `HCM_OUT` with
 * the image's `tar`; the site build also puts the bundle files back under `HCM_KEEP_BUNDLE` (a Hosting release replaces
 * every file, so the bundle must stay in it).
 *
 * The program holds no `$`: Cloud Build substitutes `$NAME` in every argument. `fetch-script.test.ts` runs it.
 */
export const FETCH_BUNDLE_SCRIPT = [
    "import { createHash } from 'node:crypto';",
    "import { execFileSync } from 'node:child_process';",
    "import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const env = process.env;',
    "const fail = (message) => { process.stderr.write('fetch: ' + message + '\\n'); process.exit(1); };",
    "const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');",
    'async function get(name) {',
    "    const response = await fetch(new URL(name, env.HCM_BUNDLE_URL), { redirect: 'error' });",
    "    if (!response.ok) fail(name + ': HTTP ' + response.status);",
    '    return Buffer.from(await response.arrayBuffer());',
    '}',
    "const bundleDir = join(env.HCM_WORKSPACE || '/workspace', 'bundle');",
    'mkdirSync(bundleDir, { recursive: true });',
    "const manifestBytes = await get('manifest.json');",
    "if (sha(manifestBytes) !== env.HCM_MANIFEST_SHA256) fail('manifest.json is not the one the admin read');",
    "const manifest = JSON.parse(manifestBytes.toString('utf8'));",
    "if (manifest.release !== env.HCM_RELEASE) fail('manifest.json names another release');",
    "writeFileSync(join(bundleDir, 'manifest.json'), manifestBytes);",
    "const targets = env.HCM_FILES.split(',');",
    'for (const target of targets) {',
    '    const entry = manifest.files[target];',
    "    if (!entry) fail('manifest.json names no file for ' + target);",
    '    const bytes = await get(entry.name);',
    "    if (sha(bytes) !== entry.sha256) fail(entry.name + ' is not the file the manifest names');",
    '    writeFileSync(join(bundleDir, entry.name), bytes);',
    '}',
    'const main = manifest.files[targets[0]];',
    "if (main.sha256 !== env.HCM_FILE_SHA256) fail(main.name + ' is not the file the admin chose');",
    'mkdirSync(env.HCM_OUT, { recursive: true });',
    "execFileSync('tar', ['-xzf', join(bundleDir, main.name), '-C', env.HCM_OUT], { stdio: 'inherit' });",
    'if (env.HCM_KEEP_BUNDLE) {',
    '    const keep = join(env.HCM_OUT, env.HCM_KEEP_BUNDLE);',
    '    mkdirSync(keep, { recursive: true });',
    "    for (const name of ['manifest.json', ...targets.map((target) => manifest.files[target].name)]) {",
    '        copyFileSync(join(bundleDir, name), join(keep, name));',
    '    }',
    '}',
    "process.stdout.write('fetch: ' + main.name + ' checked and unpacked\\n');",
].join('\n');
