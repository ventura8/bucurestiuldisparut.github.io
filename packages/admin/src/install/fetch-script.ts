/**
 * The first step of every install build (`fetch`, `docs/research/M6-interfaces.md` §1.4): a Node program passed inline
 * to the pinned Node image (`node --input-type=module --eval`), because the bundle's own step scripts are inside the
 * tarball it fetches. It downloads `manifest.json` from the admin's own bundle folder (`HCM_BUNDLE_URL`), refuses to go
 * on unless its SHA-256 is the one the admin computed (`HCM_MANIFEST_SHA256`) and it names the admin's release and its
 * build time (`HCM_RELEASE_TIME`, empty for a build that knows none: finding 39 of 2026-11-01), then
 * downloads each tarball of `HCM_FILES` (the target's first) and refuses any whose SHA-256 is not the manifest's, the
 * target's also not the one the admin chose (`HCM_FILE_SHA256`). It unpacks the target's tarball into `HCM_OUT` with
 * the image's `tar`, and each other fetched tarball `HCM_UNPACK` names (§73k: the site build's `legacy.tgz` while the
 * legacy import is not complete); the site build also puts the bundle files back under `HCM_KEEP_BUNDLE` (a Hosting
 * release replaces every file, so the bundle must stay in it). M14 (`docs/research/M14-start-your-map.md` §6): a site build
 * of a bundle made for no project (`HCM_ADOPT_PROJECT`) replaces the token with this project's id in `firebase.json` and in
 * every file the tarball's `templates.json` lists, the city page's policy among them, and takes `admin/project.json` from the live
 * site (`HCM_ADOPT_FROM`). Every other file stays byte for byte: the admin's script holds the token as this very text.
 *
 * The program holds no `$`: Cloud Build substitutes `$NAME` in every argument. `fetch-script.test.ts` runs it.
 */
export const FETCH_BUNDLE_SCRIPT = [
    "import { createHash } from 'node:crypto';",
    "import { execFileSync } from 'node:child_process';",
    "import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
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
    "if (String(manifest.releaseTime ?? '') !== (env.HCM_RELEASE_TIME || '')) fail('manifest.json names another build time');",
    "writeFileSync(join(bundleDir, 'manifest.json'), manifestBytes);",
    "const targets = env.HCM_FILES.split(',');",
    "const unpacked = [targets[0], ...(env.HCM_UNPACK ? env.HCM_UNPACK.split(',') : [])];",
    'for (const target of unpacked) {',
    "    if (!targets.includes(target)) fail(target + ' is unpacked but not fetched');",
    '}',
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
    'for (const target of unpacked) {',
    "    execFileSync('tar', ['-xzf', join(bundleDir, manifest.files[target].name), '-C', env.HCM_OUT], { stdio: 'inherit' });",
    '}',
    'if (env.HCM_KEEP_BUNDLE) {',
    '    const keep = join(env.HCM_OUT, env.HCM_KEEP_BUNDLE);',
    '    mkdirSync(keep, { recursive: true });',
    "    for (const name of ['manifest.json', ...targets.map((target) => manifest.files[target].name)]) {",
    '        copyFileSync(join(bundleDir, name), join(keep, name));',
    '    }',
    '}',
    'if (env.HCM_ADOPT_PROJECT) {',
    "    const templates = JSON.parse(readFileSync(join(env.HCM_OUT, 'templates.json'), 'utf8'));",
    "    for (const file of ['firebase.json', ...templates.map((path) => 'public/' + path)]) {",
    '        const path = join(env.HCM_OUT, file);',
    "        writeFileSync(path, readFileSync(path, 'utf8').replaceAll('__HCM_PROJECT_ID__', env.HCM_ADOPT_PROJECT));",
    '    }',
    "    const live = await fetch(env.HCM_ADOPT_FROM, { redirect: 'error' });",
    "    if (!live.ok) fail('project.json: HTTP ' + live.status);",
    "    mkdirSync(join(env.HCM_OUT, 'public/admin'), { recursive: true });",
    "    writeFileSync(join(env.HCM_OUT, 'public/admin/project.json'), Buffer.from(await live.arrayBuffer()));",
    '}',
    "process.stdout.write('fetch: ' + main.name + ' checked and unpacked\\n');",
].join('\n');
