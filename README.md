# CFB27 Real Coach Importer

A small Windows tool that fixes the **generic / missing head coaches** in an
**EA Sports College Football 27** dynasty save. It gives each affected coach
their real name, their real in-game **likeness** (3D head + portrait, using the
game's own coach art), and their real-life **historic career record** — all as a
pure save edit. No game files are modified; your original save is never touched.

On a fresh CFB27 roster, EA ships most head coaches as real, correct likenesses,
but leaves a handful as generic placeholders — for example **Deion Sanders,
Kirk Ferentz, Mario Cristobal, Bill Belichick, Bronco Mendenhall, Blake
Anderson**. This tool detects those and restores them.

## Download & use (no install)

1. Download **`CFB27-Real-Coaches.zip`** from the
   [latest release](https://github.com/KivJoy/CFB27-Real-Coach-Importer/releases/latest).
2. Unzip it anywhere.
3. Make sure CFB27 is closed, then double-click **`Real-Coaches.exe`**.
4. Pick your dynasty save from the list (or paste a path).
5. Load the newly created **`<yoursave>-REALCOACHES`** copy in CFB27.

**Node.js is not required** — the `.exe` is self-contained. Keep the files that
ship next to it (`coaches.json`, `schema\`, `runtime\`) in the same folder; the
tool reads them at startup.

### Options

Open a Command Prompt in the unzipped folder to pass flags:

```
Real-Coaches.exe                 pick your save, then correct a COPY
Real-Coaches.exe --dry-run       audit only — show what would change, write nothing
Real-Coaches.exe --names-only    rename + face only; skip historic stats
Real-Coaches.exe --skip-my-coach leave the coach YOU control untouched
Real-Coaches.exe --json          machine-readable audit
Real-Coaches.exe "C:\path\to\DYNASTY-MYSAVE"
```

By default the tool corrects **every** generic coach, including the one you control
— so if you're playing as a made-up coach at one of the seven teams below, you get
the real name, face, and career record too. Add `--skip-my-coach` to leave your own
coach exactly as-is (handy mid-dynasty, so your win-loss record isn't replaced).

With no path given, it auto-detects your saves folder at
`Documents\EA SPORTS College Football 27\saves` (including a OneDrive-redirected
Documents), lists your dynasty saves, and lets you pick one by number.

## What it does

1. Checks the save's head coach at each of the seven known teams (below) against
   who's really coaching there.
2. For any of those seven that's generic/wrong **and** has a real likeness in the game,
   sets the correct name + face.
3. For those corrected coaches only, writes their real **age**, **seasons with
   team**, and **career record** (wins/losses, bowls, conference titles, national
   titles) — because a replaced generic inherited the placeholder's made-up
   age/tenure and empty `0-0` record. Coaches EA already ships correctly are
   **left untouched**; the game already gives them their real data, so there's
   nothing to fix.
4. Saves everything to a **new copy** named `<yoursave>-REALCOACHES`. Your
   original save is never touched — load the copy in the game.

The game **schema is auto-selected** to match the game build each save was written
by. Schemas for both the current (August 2026) patch and earlier builds ship in the
zip, so saves from either era work with no manual setup — **you never need to swap a
schema file in yourself.**

## Coaches actually imported

EA ships a fresh CFB27 roster with real, correct coaches for almost every FBS
team already — the tool only needs to *replace* the handful shipped as generic
placeholders. This is the full list of that correction:

| Team | Placeholder replaced with | Real likeness | Age | Seasons w/ team | Career record |
|---|---|---|---|---|---|
| Colorado | Deion Sanders | Yes | 59 | 3 | 16–21 |
| Iowa | Kirk Ferentz | Yes | 71 | 27 | 213–128 |
| Miami | Mario Cristobal | Yes | 55 | 4 | 97–79 |
| North Carolina | Bill Belichick | Yes | 74 | 1 | 4–8 (college only) |
| North Texas | Neal Brown | No — no shipped likeness, name only | 46 | 0 | 72–51 |
| Southern Miss | Blake Anderson | Yes | 57 | 0 | 74–54 |
| Utah State | Bronco Mendenhall | Yes | 60 | 1 | 146–95 |

These seven are the only coaches ever changed. Everyone else on the roster is
already correct as EA shipped them — name, face, and career stats — and is left
untouched.

> Career records are **college** head-coaching records (the game only tracks
> college coaching). Bill Belichick's is his 2025 UNC record, not his NFL career.

## Editing the coach data

`coaches.json` sits next to the `.exe` and is plain, editable JSON. Open it in
Notepad to add or change a coach, save, and re-run the tool — no rebuild needed.

## Safety notes

- **Writes a copy, never your original.** Load the `-REALCOACHES` file in-game.
- **Your own coach is corrected too, by default** (name + face + real record). Use
  `--skip-my-coach` to leave it untouched. Heads-up: editing a coach has crashed the
  in-game *Edit Coach* screen, so avoid that screen on your own coach afterward — or
  use `--skip-my-coach`. Sidelines and menus are fine.
- The **name + face** swap is confirmed working in-game. The **historic-stat**
  write has not been fully game-tested yet — if a save misbehaves, re-run with
  `--names-only` for the proven-safe path.
- One coach (Neal Brown) has no likeness shipped in the game — see
  [Coaches actually imported](#coaches-actually-imported) — so he gets the correct name but keeps a
  generic face. Some replaced coaches also have no career-stat slot in the save,
  so their record can't be attached (the audit labels these `stats-ref empty`).
  Confirmed by inspecting a real save: these coaches' `Coach.CareerStats`
  reference is genuinely all-zero (no row assigned), not a parsing gap on our
  end — Age/SeasonsWithTeam are unaffected since those live directly on the
  Coach record, not behind this reference.
  - **Allocating a fresh stats row (v2, not built):** the underlying franchise
    table format supports this — empty rows form a real linked free-list
    (`table.header.nextRecordToUse` + per-record next-pointers), and the
    `madden-franchise` library already has safe unempty/relink logic for it
    (used elsewhere for table3 overflow records), so it's a supported
    operation, not a binary hack. What's missing: this tool opens saves with
    `autoUnempty: false` (deliberately, so tables it merely reads aren't
    mutated as a side effect), so claiming a specific row needs a scoped
    unempty rather than a global one, and — more importantly — nobody has
    verified in-game that CFB27 is happy with a coach whose career-stats row
    goes from absent to populated mid-save. Tracked as a known gap in the
    sibling `CFB27-Dynasty-Engine` project's `REAL_COACHES.md` design doc.
    Low risk to prototype (writes only ever land in the disposable
    `-REALCOACHES` copy), but not implemented here until validated.

## Building from source (developers)

Requires [Node.js 20+](https://nodejs.org).

```
npm install
npm start                        run against a save (same flags as above)
node index.js --dry-run          audit only
npm run build-exe                produce build\dist\CFB27-Real-Coaches.zip
```

`npm run build-exe` bundles a Node runtime into a single Windows `.exe` (via
[`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg)) and assembles the distributable
folder + zip. It preflights first — validating `coaches.json` and loading every
bundled schema — so a broken asset fails the build rather than a user's run.

### Schemas & game patches

Every save records the game build that wrote it, and the tool picks a bundled
schema to match. Two ship in `schema\`:

| Bundled schema | Covers saves declaring |
|---|---|
| `CFB27_472_0.gz` | the release build and the July 2026 patch (809, 814) |
| `CFB27_833_0.gz` | the **August 2026 patch** (833) and later |

Selection is: exact filename match on the declared version, else the **newest
bundled schema whose version is at or below** what the save declares.

That "at or below" rule matters, and it is not just tidiness. Through the July
2026 patch the CFB27 table layouts really were stable across builds, so simply
using the newest schema was safe. **The August 2026 patch ended that.** The
`Coach` table — this tool's entire subject — changed layout, and the mismatch
breaks in *both* directions: the old schema reads zero named coach fields on a
new save, and the new schema reads zero named coach fields on an old save (the
parser silently falls back to generic `Field_N` names rather than erroring).
So a pre-patch save must keep resolving to `472` even though `833` is newer.
Both directions are verified against real saves of each era: 493 named coaches
read on both, and 0 when the schemas are deliberately crossed.

A future patch (say 840) resolves to `833` automatically until a newer schema is
bundled — no code change. If you ever need to force a specific schema, drop a
`CFB27_<major>_<minor>.gz` (or `C27_<major>_<minor>.gz`) file into `schema\` next
to the exe; name it for the **save-declared** build number, which is a different
counter from the version reported inside the schema file itself.

### Regenerating the dataset (optional)

`coaches.json` is generated from two hand-curated sources — `GENERIC_FILLS` in
`build-dataset.mjs` (which real coach + likeness belongs at each generic school)
and `stats-source.json` (their cited college career records). No game save is
needed:

```
node build-dataset.mjs
```

Edit either source and re-run to regenerate `coaches.json`.

## Credits & disclaimer

Built on the [`madden-franchise`](https://github.com/bep713/madden-franchise)
save library. This is an unofficial fan tool and is not affiliated with or
endorsed by EA Sports. Use at your own risk; always keep backups of your saves.
