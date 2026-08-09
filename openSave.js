// CFB27 franchise-save opener for the Real Coaches tool.
// Vendored from the CFB27-Dynasty-Engine project's test/src/openSave.js. Tables are
// resolved ONLY by stable uniqueId — see the canonical rule at
// ../CFB27-Modding-Knowledge/knowledge/save-format/table-resolution.md — display
// names are not unique and tableId shifts between saves. The bootstrap-only name
// lookup is deliberately omitted here.
const path = require('path');
const { FranchiseFile } = require('madden-franchise');

const fs = require('fs');
const SCHEMA_DIR = process.env.RG_SCHEMA_DIR || path.resolve(__dirname, 'schema');

/**
 * Full save schemas in SCHEMA_DIR matching `prefix`, as {name, major, minor},
 * sorted newest-first. Versions come from the FILENAME, not the schema's own
 * internal dataMajorVersion — the two counters differ (CFB27_833_0.gz is
 * internally 486_1), and it's the save-stamped number that drives selection.
 *
 * The \d+ immediately after the prefix keeps FTC-tagged files (CFB27_FTC_*)
 * out of save selection by construction: those are mod-build schemas, never
 * save schemas.
 */
function schemaVersionsIn(prefix) {
  let files = [];
  try { files = fs.readdirSync(SCHEMA_DIR); } catch { return []; }
  const re = new RegExp(`^${prefix}_(\\d+)_(\\d+)\\.gz$`, 'i');
  const out = [];
  for (const f of files) {
    const m = re.exec(f);
    if (m) out.push({ name: f, major: parseInt(m[1], 10), minor: parseInt(m[2], 10) });
  }
  return out.sort((a, b) => b.major - a.major || b.minor - a.minor);
}

/**
 * Choose a schema file for a save. Prefer an exact version match
 * (CFB27_<major>_<minor>.gz or C27_<major>_<minor>.gz); otherwise the NEWEST
 * full CFB27_* schema whose version is <= the version the save declares; if
 * every bundled schema is newer than the save, the oldest bundled one (nearest
 * above). C27_* is consulted only when no CFB27_* file is present.
 *
 * The "<= declared" bound is load-bearing, not a tidiness preference. Through
 * the 814 patch, CFB27 table layouts really were stable across game builds (an
 * 809 save parses byte-identically under the 809 and 472 schemas), so "newest
 * bundled" was a safe fallback. THE 2026-08-06 PATCH BROKE THAT. Saves written
 * by the patched game declare 833, and the Coach table's layout is incompatible
 * in BOTH directions — measured: 472 reads zero named Coach fields on an 833
 * save, and the 833 schema reads zero named Coach fields on an 814 save (the
 * table's embedded schema hash no longer matches, so madden-franchise silently
 * regenerates a generic Field_N schema for it). Since this tool's entire job is
 * the Coach table, "newest wins" would have quietly broken every pre-patch save
 * the moment 833 was bundled. So an 809/814 save must resolve to 472 even
 * though 833 is newer, and an 833+ save to 833. A future 840 patch then
 * resolves to 833 automatically, with no code change.
 *
 * We still supply the path explicitly, because madden-franchise's built-in
 * picker silently falls back to an unrelated Madden/old-CFB schema, which
 * mis-parses.
 *
 * Facts + measurement trail:
 * ../CFB27-Modding-Knowledge/knowledge/save-format/schema-and-versions.md.
 * Kept in lockstep with the Dynasty Engine's app/src/saveio/cfb27/schema.ts.
 *
 * Returns { path, exact, name }.
 */
function schemaFileFor(meta) {
  for (const name of [`CFB27_${meta.major}_${meta.minor}.gz`, `C27_${meta.major}_${meta.minor}.gz`]) {
    const p = path.join(SCHEMA_DIR, name);
    if (fs.existsSync(p)) return { path: p, exact: true, name };
  }
  for (const prefix of ['CFB27', 'C27']) {
    const all = schemaVersionsIn(prefix);
    if (!all.length) continue;
    // Compare the (major, minor) PAIR, not major alone: a same-major
    // higher-minor schema is still newer than the save declares, and the point
    // of the bound is never handing a save a layout newer than itself.
    const atOrBelow = all.find(
      (s) => s.major < meta.major || (s.major === meta.major && s.minor <= meta.minor),
    ); // list is newest-first, so the first hit is the closest at-or-below
    const chosen = atOrBelow || all[all.length - 1];
    return { path: path.join(SCHEMA_DIR, chosen.name), exact: false, name: chosen.name };
  }
  throw new Error(
    `No CFB27 schema files found in "${SCHEMA_DIR}".\n`
    + `The "schema" folder must sit next to Real-Coaches.exe. If it's missing, re-download the release zip.`,
  );
}

/**
 * Open a CFB27 dynasty save; resolves once tables are parsed. The schema is chosen
 * from the version the save declares, falling back to the newest bundled schema so
 * saves from any game patch work.
 */
function openSave(savePath, { autoUnempty = false, onSchema } = {}) {
  return new Promise((resolve, reject) => {
    let f;
    try {
      // autoParse:false lets us read the save's own schema version (computed in the
      // constructor) before parsing, then supply the schema file path explicitly.
      f = new FranchiseFile(savePath, { autoParse: false, schemaDirectory: SCHEMA_DIR, autoUnempty });
      const expected = f.expectedSchemaVersion;
      const chosen = schemaFileFor(expected);
      if (typeof onSchema === 'function') onSchema({ expected, ...chosen });
      f.settings.schemaOverride = {
        major: expected.major, minor: expected.minor, gameYear: expected.gameYear,
        path: chosen.path,
      };
    } catch (err) { reject(err); return; }
    f.on('ready', () => resolve(f));
    f.on('error', reject);
    f.parse();
  });
}

// Confirmed against DYNASTY-BASELINE / DYNASTY-REALCOACHES. uniqueId is stable
// across schema versions; see ../CFB27-Dynasty-Engine/docs/reference/TABLES.md
// (or the canonical rule at
// ../CFB27-Modding-Knowledge/knowledge/save-format/table-resolution.md).
const TABLE_UNIQUE_ID = {
  team: 3359508968, // per-school Team table (DisplayName/TeamIndex). NOT 431958913 (singleton).
  coach: 1860529246,
  owner: 2357578975,
  franchiseUser: 3429237668,
  careerCoachStats: 1758861850, // Coach.CareerStats target — career-cumulative counters
  seasonCoachStats: 564984853, // Coach.SeasonStats target — current-season W/L
};

/** Resolve a table by its stable uniqueId. Throws if not catalogued or not found. */
function tableByUniqueId(file, key) {
  const uniqueId = TABLE_UNIQUE_ID[key];
  if (uniqueId === undefined) throw new Error(`No uniqueId catalogued for "${key}".`);
  const table = file.getTableByUniqueId(uniqueId);
  if (!table) throw new Error(`Could not find table "${key}" by uniqueId ${uniqueId}. Schema may have changed.`);
  return table;
}

async function readTable(file, key) {
  const t = tableByUniqueId(file, key);
  await t.readRecords();
  return t;
}

/** Decode a 32-char binary-string reference into {tableId, row}, or null if empty/invalid. */
function parseRef(bin) {
  if (typeof bin !== 'string' || bin.length < 32 || !/[1-9]/.test(bin)) return null;
  return { tableId: parseInt(bin.slice(0, 15), 2), row: parseInt(bin.slice(15), 2) };
}

/**
 * Follow a Coach's CareerStats/SeasonStats reference to its record, verifying the
 * target table's uniqueId so a shifted tableId can never send a write to the wrong
 * table. This is §3's one sanctioned use of getTableById (following a decoded ref).
 * Returns { table, record } or null if the ref is empty/unresolvable.
 */
async function followStatsRef(file, ref, expectedUniqueId) {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const table = file.getTableById(parsed.tableId);
  if (!table) return null;
  if (table.header.uniqueId !== expectedUniqueId) {
    throw new Error(`Stats ref resolved to table uniqueId ${table.header.uniqueId}, expected ${expectedUniqueId}. Refusing.`);
  }
  await table.readRecords();
  const record = table.records[parsed.row];
  if (!record || record.isEmpty) return null;
  return { table, record };
}

/** Safe field read (schema mismatches / free rows throw otherwise). */
const sf = (rec, field) => { try { return rec[field]; } catch { return undefined; } };

module.exports = {
  openSave, schemaFileFor, tableByUniqueId, readTable, parseRef, followStatsRef, sf,
  SCHEMA_DIR, TABLE_UNIQUE_ID,
  CAREER_COACH_STATS_UID: TABLE_UNIQUE_ID.careerCoachStats,
  SEASON_COACH_STATS_UID: TABLE_UNIQUE_ID.seasonCoachStats,
};
