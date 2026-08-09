// Builds the end-user distributable: a single Windows .exe plus the loose,
// editable assets it reads at runtime (coaches.json, schema/, the native zstd
// addon). Produces build/dist/CFB27-Real-Coaches/ and a matching .zip.
//
//   npm run build-exe
//
// The user needs no Node install: the .exe embeds a Node 22 runtime. coaches.json
// and the schema/ files stay editable in Notepad next to the .exe.
import { exec } from '@yao-pkg/pkg';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { FranchiseSchema } = require('madden-franchise');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const distRoot = path.join(buildDir, 'dist');
const outDir = path.join(distRoot, 'CFB27-Real-Coaches');
const exeName = 'Real-Coaches.exe';
const target = 'node22-win-x64';

const NATIVE_ZSTD = path.join(
  root, 'node_modules', '@toondepauw', 'node-zstd-win32-x64-msvc', 'node-zstd.win32-x64-msvc.node',
);

function log(msg) { console.log(`\x1b[36m[build]\x1b[0m ${msg}`); }

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Load a schema through madden-franchise's own parser — the same code path the
// tool uses at runtime. If it loads, the file is genuinely usable; we also get its
// authoritative version back (handles both old- and new-generation schema formats).
function loadSchemaMeta(gzPath) {
  return new Promise((resolve, reject) => {
    const s = new FranchiseSchema(gzPath, {});
    const t = setTimeout(() => reject(new Error(`${path.basename(gzPath)}: schema load timed out`)), 30000);
    s.on('schemas:done', () => { clearTimeout(t); resolve(s.meta); });
    s.on('error', (e) => { clearTimeout(t); reject(new Error(`${path.basename(gzPath)}: ${e.message}`)); });
    s.evaluate();
  });
}

// Fail the build here rather than on a user's machine if an asset is broken.
async function preflight() {
  if (!fs.existsSync(NATIVE_ZSTD)) {
    throw new Error(`Native zstd addon not found at ${NATIVE_ZSTD}. Run \`npm install\` first.`);
  }

  const coaches = JSON.parse(fs.readFileSync(path.join(root, 'coaches.json'), 'utf8'));
  if (!Array.isArray(coaches.coaches) || coaches.coaches.length === 0) {
    throw new Error('coaches.json is missing a non-empty "coaches" array.');
  }
  log(`coaches.json OK (${coaches.coaches.length} coaches).`);

  const schemaDir = path.join(root, 'schema');
  const gzs = fs.readdirSync(schemaDir).filter((f) => f.endsWith('.gz'));
  if (gzs.length === 0) throw new Error(`No schema .gz files found in ${schemaDir}.`);
  for (const f of gzs) {
    const meta = await loadSchemaMeta(path.join(schemaDir, f));
    // openSave.js selects on the SAVE-STAMPED version in the filename, which is a
    // different counter from the schema's own internal dataMajorVersion (833 vs
    // 486_1) — so we deliberately do NOT require the two to agree. What must hold
    // is that the filename is visible to the runtime selector at all: it globs
    // ^CFB27_<digits>_<digits>.gz$ / ^C27_..., which an FTC-tagged or oddly-named
    // file silently fails, leaving it bundled but never selectable.
    const selectable = /^(CFB27|C27)_\d+_\d+\.gz$/i.test(f);
    log(`schema ${f} -> internal version ${meta.major}_${meta.minor} (loads OK)`
      + (selectable ? '' : `  \x1b[33m(WARNING: filename isn't matched by the runtime selector; it will never be chosen)\x1b[0m`));
  }
}

async function main() {
  log('Preflight checks...');
  await preflight();

  log('Cleaning previous output...');
  rmrf(distRoot);
  fs.mkdirSync(outDir, { recursive: true });

  const exePath = path.join(outDir, exeName);
  log(`Compiling ${exeName} (${target}) — this downloads the Node base binary on first run...`);
  await exec([
    path.join(root, 'entry.js'),
    '--target', target,
    '--output', exePath,
  ]);

  log('Copying loose, editable assets beside the exe...');
  // Editable data + schemas.
  fs.copyFileSync(path.join(root, 'coaches.json'), path.join(outDir, 'coaches.json'));
  copyDir(path.join(root, 'schema'), path.join(outDir, 'schema'));
  // Native zstd addon (loaded via NAPI_RS_NATIVE_LIBRARY_PATH in entry.js).
  const runtimeDir = path.join(outDir, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.copyFileSync(NATIVE_ZSTD, path.join(runtimeDir, 'node-zstd.win32-x64-msvc.node'));
  // End-user readme.
  fs.writeFileSync(path.join(outDir, 'README.txt'), README, 'utf8');

  log('Zipping distributable...');
  const zipPath = path.join(distRoot, 'CFB27-Real-Coaches.zip');
  const r = spawnSync('powershell', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path "${outDir}\\*" -DestinationPath "${zipPath}" -Force`,
  ], { stdio: 'inherit' });
  if (r.status !== 0) log('(zip step skipped/failed — the folder is still ready to share)');

  log(`Done.`);
  console.log(`\n  Folder: ${outDir}`);
  console.log(`  Zip:    ${zipPath}\n`);
}

const README = `CFB27 Real Coach Importer
=========================

WHAT THIS DOES
  Corrects a CFB27 dynasty save's generic CPU head coaches to their real-life
  names, faces, and historic career stats. It writes to a COPY of your save
  (named <save>-REALCOACHES); your original save is never touched.

HOW TO USE
  1. Make sure CFB27 is closed.
  2. Double-click Real-Coaches.exe.
  3. Pick your dynasty save from the list (or paste a path).
  4. Load the -REALCOACHES copy in CFB27 to verify.

  Tip: run a preview first by opening a Command Prompt here and running:
       Real-Coaches.exe --dry-run

FILES YOU CAN EDIT
  coaches.json   The coach data (names / faces / stats). Edit in Notepad to
                 add or change coaches, then re-run the exe.
  schema\\        Game data schemas. Don't change these unless you know why.
  runtime\\       Support binary. Leave it alone.

  Keep all of these files next to Real-Coaches.exe — it reads them at startup.

NO INSTALL NEEDED
  Node.js is NOT required. Everything the tool needs is in this folder.
`;

main().catch((err) => {
  console.error(`\n\x1b[31m[build] Error: ${err && err.message ? err.message : err}\x1b[0m`);
  process.exit(1);
});
