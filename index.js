#!/usr/bin/env node
// Real Coaches — correct a CFB27 dynasty save's generic head coaches to their
// real-life identities: name + shipped likeness (portrait + 3D head recipe) +
// real age + real seasons-at-this-school. A corrected coach also gets their real
// historic career record written, because a replaced generic inherited the
// placeholder's empty 0-0 stat slot. Coaches EA
// already ships correctly are left ALONE — their stat slot already holds EA's real
// career record, so we never overwrite it. Writes to a SIBLING COPY
// (<save>-REALCOACHES); the source is never touched. Tables resolved by stable
// uniqueId only (see ../CFB27-Modding-Knowledge/knowledge/save-format/table-resolution.md);
// the CareerCoachStats row is reached by following Coach.CareerStats and verifying
// the target's uniqueId.
//
// Safety: by default every generic coach is corrected, INCLUDING the one you
// control (name + face + real record). Pass --skip-my-coach to leave your own coach
// alone — useful mid-dynasty or to avoid the in-game "Edit Coach" screen crash that
// has occurred on an edited coach. The name+likeness swap is in-game validated; the
// historic-stat write is NOT yet validated in-game — pass --names-only to skip it.
//
// Usage: node index.js [savePath] [--dry-run] [--names-only] [--skip-my-coach] [--out=<path>] [--json]
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { resolveSavePath } = require('./savePicker');
const {
  openSave, readTable, followStatsRef, sf, CAREER_COACH_STATS_UID,
} = require('./openSave');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const namesOnly = args.includes('--names-only');
const asJson = args.includes('--json');
// By default EVERY generic coach is corrected, including the one YOU control
// (name + face + real career record). Opt out with --skip-my-coach to leave your
// own coach untouched — useful mid-dynasty, or to avoid the in-game "Edit Coach"
// screen crash that has occurred on an edited coach.
const skipMyCoach = args.includes('--skip-my-coach');
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

// dataset stat key -> CareerCoachStats field name (RecentYearNCWon intentionally
// omitted: it is a dynasty-relative index, not a real calendar year).
const STAT_FIELDS = {
  wins: 'Wins', losses: 'Losses',
  bowlWins: 'BowlWins', bowlLosses: 'BowlLosses',
  confChampWins: 'ConfChampWins', confChampLosses: 'ConfChampLosses',
  playoffWins: 'PlayoffWins', playoffLosses: 'PlayoffLosses',
  ncWins: 'NCWins', ncLosses: 'NCLosses',
  top25Wins: 'Top25Wins', top25Losses: 'Top25Losses',
  timesFired: 'TimesFired',
};

const displayName = (first, last) => `${first.charAt(0)}. ${last}`;
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
function assertFits(value, max, label) {
  if (String(value).length > max) throw new Error(`${label} "${value}" exceeds maxLength ${max}.`);
}
function clamp(v, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, Math.round(v)));
}

async function main() {
  if (!asJson) {
    console.log(`\n${c.bold}Real Coaches — CFB27 head-coach corrector${c.reset}`);
    console.log(`${c.dim}────────────────────────────────────────────${c.reset}\n`);
  }

  if (!process.env.RG_SCHEMA_DIR) process.env.RG_SCHEMA_DIR = paths.SCHEMA_DIR;
  const dataset = JSON.parse(fs.readFileSync(paths.COACHES_JSON, 'utf8'));

  const savePath = await resolveSavePath(positional, c);
  if (!asJson) {
    console.log(`${c.cyan}Save:${c.reset} ${savePath}`);
    console.log(`${c.dim}Mode: ${dryRun ? 'dry run (no writes)' : 'apply'}${namesOnly ? ', names+faces only (no stats)' : ''}${c.reset}\n`);
  }

  const file = await openSave(savePath, {
    autoUnempty: false,
    onSchema: ({ expected, exact, name }) => {
      if (asJson) return;
      if (exact) {
        console.log(`${c.dim}Schema: ${expected.major}_${expected.minor} (exact match)${c.reset}\n`);
      } else {
        console.log(`${c.dim}Schema: save reports ${expected.major}_${expected.minor}; using the closest bundled schema at or below it, ${name}.${c.reset}\n`);
      }
    },
  });
  const teamTable = await readTable(file, 'team');
  const coachTable = await readTable(file, 'coach');

  // team DisplayName (lowercased) -> TeamIndex
  const teamIndexByName = new Map();
  for (const rec of teamTable.records) {
    if (rec.isEmpty) continue;
    teamIndexByName.set(norm(sf(rec, 'DisplayName')), sf(rec, 'TeamIndex'));
  }
  // TeamIndex -> HeadCoach record
  const hcByTeamIndex = new Map();
  for (const rec of coachTable.records) {
    if (rec.isEmpty || sf(rec, 'Position') !== 'HeadCoach') continue;
    hcByTeamIndex.set(sf(rec, 'TeamIndex'), rec);
  }

  // Field ranges for stat clamping (read once from the schema).
  const careerStatsTable = file.getTableByUniqueId(CAREER_COACH_STATS_UID);
  const statRange = {};
  for (const attr of careerStatsTable.schema.attributes) statRange[attr.name] = { min: attr.minValue, max: attr.maxValue };
  // Age/SeasonsWithTeam live on the Coach record itself, not CareerCoachStats.
  const coachRange = {};
  for (const attr of coachTable.schema.attributes) coachRange[attr.name] = { min: attr.minValue, max: attr.maxValue };

  const plan = [];
  const skipped = [];
  for (const d of dataset.coaches) {
    const teamIndex = teamIndexByName.get(norm(d.team));
    if (teamIndex === undefined) { skipped.push({ team: d.team, reason: 'team not in this save' }); continue; }
    const rec = hcByTeamIndex.get(teamIndex);
    if (!rec) { skipped.push({ team: d.team, reason: 'no head coach on this team' }); continue; }
    const isUser = sf(rec, 'IsUserControlled') === true;
    if (isUser && skipMyCoach) { skipped.push({ team: d.team, reason: 'your coach — left alone (--skip-my-coach)' }); continue; }

    const curFirst = sf(rec, 'FirstName'), curLast = sf(rec, 'LastName');
    const nameMatches = norm(curFirst) === norm(d.firstName) && norm(curLast) === norm(d.lastName);
    const curAsset = sf(rec, 'AssetName');
    const assetMatches = d.asset ? curAsset === d.asset.assetName : true;

    plan.push({
      team: d.team, teamIndex, rec, data: d, isUser,
      before: { first: curFirst, last: curLast, asset: curAsset, isNIL: sf(rec, 'IsNIL') },
      nameMatches, assetMatches,
      classification: (nameMatches && assetMatches) ? 'already-correct' : 'correcting',
    });
  }

  // Resolve each stats target now (before writing) so the report is accurate.
  for (const p of plan) {
    p.statsRef = null;
    if (!p.data.stats) continue;
    try {
      p.statsRef = await followStatsRef(file, sf(p.rec, 'CareerStats'), CAREER_COACH_STATS_UID);
    } catch (e) { p.statsError = e.message; }
  }

  // ---- Report ----
  const correcting = plan.filter((p) => p.classification === 'correcting');
  const alreadyOk = plan.filter((p) => p.classification === 'already-correct');
  if (asJson) {
    console.log(JSON.stringify({
      save: savePath, dryRun, namesOnly, skipMyCoach,
      counts: { matched: plan.length, correcting: correcting.length, alreadyCorrect: alreadyOk.length, skipped: skipped.length },
      correcting: correcting.map((p) => ({ team: p.team, isUser: p.isUser, from: `${p.before.first} ${p.before.last}`, to: `${p.data.firstName} ${p.data.lastName}`, asset: p.data.asset ? p.data.asset.assetName : null, hasStats: !!p.data.stats && !!p.statsRef })),
      skipped,
    }, null, 2));
  } else {
    console.log(`${c.bold}Audit — ${plan.length} FBS coaches matched in this save${c.reset}\n`);
    if (correcting.length) {
      console.log(`${c.yellow}${c.bold}Coaches to correct (${correcting.length}):${c.reset}`);
      for (const p of correcting) {
        const face = p.data.asset ? `${c.green}face✓${c.reset}` : `${c.gray}no asset${c.reset}`;
        const stats = !p.data.stats ? `${c.gray}no stats${c.reset}` : (p.statsRef ? `${c.green}stats✓${c.reset}` : `${c.red}stats-ref empty${c.reset}`);
        const tag = p.isUser ? ` ${c.cyan}(your coach)${c.reset}` : '';
        console.log(`  ${c.bold}${p.team.padEnd(18)}${c.reset} ${p.before.first} ${p.before.last} ${c.dim}→${c.reset} ${c.green}${p.data.firstName} ${p.data.lastName}${c.reset}${tag}  [${face}, ${namesOnly ? c.gray + 'stats skipped' + c.reset : stats}]`);
      }
      console.log();
      if (correcting.some((p) => p.isUser)) {
        console.log(`${c.yellow}⚠ Your own coach is being corrected (name + face${namesOnly ? '' : ' + real career record, replacing your current win-loss'}).${c.reset}`);
        console.log(`${c.yellow}  Known risk: opening the in-game "Edit Coach" screen on an edited coach has crashed the game.${c.reset}`);
        console.log(`${c.yellow}  Use --skip-my-coach to leave your coach alone. (Either way this writes to a COPY — your original is safe.)${c.reset}\n`);
      }
    }
    console.log(`${c.dim}Already correct (name+face): ${alreadyOk.length} — left as shipped (EA's real career stats kept)${c.reset}`);
    if (skipped.length) {
      console.log(`${c.dim}Skipped: ${skipped.length}${c.reset}`);
      for (const s of skipped) console.log(`  ${c.gray}${s.team}: ${s.reason}${c.reset}`);
    }
  }

  if (dryRun) {
    if (!asJson) console.log(`\n${c.yellow}Dry run — no changes written.${c.reset}`);
    return;
  }

  // ---- Apply ----
  let idCount = 0, statCount = 0;
  for (const p of plan) {
    const d = p.data;
    // Identity (only when something differs — but always ensure Name matches convention).
    if (!p.nameMatches || !p.assetMatches) {
      const name = displayName(d.firstName, d.lastName);
      assertFits(d.firstName, 17, 'FirstName');
      assertFits(d.lastName, 21, 'LastName');
      assertFits(name, 18, 'Name');
      p.rec.FirstName = d.firstName;
      p.rec.LastName = d.lastName;
      p.rec.Name = name;
      if (d.asset) {
        assertFits(d.asset.assetName, 33, 'GenericHeadAssetName');
        assertFits(d.asset.assetName, 41, 'AssetName');
        p.rec.AssetName = d.asset.assetName;
        p.rec.GenericHeadAssetName = d.asset.assetName;
        p.rec.PresentationId = d.asset.presentationId;
        p.rec.Portrait = d.asset.portrait;
        p.rec.IsNIL = d.asset.isNIL !== false;
        p.rec.Portrait_Force_Silhouette = false;
      }
      if (d.age != null) {
        const r = coachRange.Age || { min: 0, max: 127 };
        const val = clamp(d.age, r.min, r.max);
        if (val != null) p.rec.Age = val;
      }
      if (d.seasonsWithTeam != null) {
        const r = coachRange.SeasonsWithTeam || { min: 0, max: 127 };
        const val = clamp(d.seasonsWithTeam, r.min, r.max);
        if (val != null) p.rec.SeasonsWithTeam = val;
      }
      idCount++;
    }
    // Historic stats — ONLY for coaches whose identity we just corrected. An
    // already-correct coach's stat slot already holds EA's shipped real record
    // (verified accurate), so we leave it untouched rather than overwrite it with
    // our hand-collected numbers. A replaced generic, by contrast, inherited the
    // placeholder's empty 0-0 record, so its real historic record must be written.
    // This includes your own coach by default (opt out with --skip-my-coach).
    if (!namesOnly && !p.nameMatches && d.stats && p.statsRef) {
      const cr = p.statsRef.record;
      for (const [key, field] of Object.entries(STAT_FIELDS)) {
        if (d.stats[key] == null) continue;
        const r = statRange[field] || { min: 0, max: 1024 };
        const val = clamp(d.stats[key], r.min, r.max);
        if (val != null) cr[field] = val;
      }
      statCount++;
    }
  }

  const outPath = flag('out') || `${savePath}-REALCOACHES`;
  if (fs.existsSync(outPath)) {
    fs.copyFileSync(outPath, `${outPath}.backup`);
    if (!asJson) console.log(`\n${c.dim}Existing output backed up to ${outPath}.backup${c.reset}`);
  }
  await file.save(outPath);
  if (!asJson) {
    console.log(`\n${c.green}${c.bold}Saved:${c.reset} ${outPath}`);
    console.log(`${c.dim}Corrected ${idCount} coach identities; wrote historic stats to ${statCount}.${c.reset}`);
    console.log(`${c.dim}Source save untouched. Load the -REALCOACHES copy in CFB27 to verify sidelines/menus.${c.reset}`);
  } else {
    console.log(JSON.stringify({ saved: outPath, identitiesChanged: idCount, statsWritten: statCount }));
  }
}

// Run directly (`node index.js`); when required by entry.js the packaged exe
// drives main() itself so it can pause before the console window closes.
if (require.main === module) {
  main().catch((err) => {
    console.error(`\n${c.red}Error: ${err.message || err}${c.reset}`);
    process.exit(1);
  });
}

module.exports = { main };
