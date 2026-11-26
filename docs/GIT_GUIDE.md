# Git guide for this public repository

Plain-language notes on how this repository is put together and how new releases reach it. Every command runs in a
terminal.

## What this repository is

This is the **public portfolio copy** of Arc40. Day-to-day development happens in a separate **private** repository,
which also holds the owner's personal setup notes. When a version is finished there, a copy of its code is made here as a
**release**: one commit named after the version (for example "Arc40 v2.1.0") and a GitHub Release with the same tag.

So the history here is short on purpose: one commit per release, each a clean snapshot. The detailed milestone history
lives in the private repository and is summarized in [CLAUDE.md](../CLAUDE.md).

Your money data is never in either repository. It lives in `data/` and in the backup folder (`~/Arc40Backups/` by
default). Both are outside Git, and a safety check blocks database, CSV and statement files from ever being committed.

## Running a copy of this repository

See the README's "Try it with demo data" and "Run it" sections. In short: clone, run `npm ci`, then `npm run demo` for a
fake person on `http://127.0.0.1:4041` (password `demo1234`), or `npm run build && npm start` for your own copy on
`http://127.0.0.1:4040`.

To get a newer release later:

```bash
git pull
```

Then start Arc40 again. When a release changes the database, Arc40 first makes a checked backup copy and only then
updates; if that copy cannot be made, it stops without changing anything and says why.

## The safety checks

Check that no private data files are tracked by Git (it prints nothing when all is well):

```bash
npm run check:data
```

The same check runs as a pre-commit hook (installed by `npm ci`) and again on GitHub Actions for every push.

Before a release, a second check scans every file for personal details:

```bash
node scripts/check-public.mjs . --denylist /path/to/denylist.txt
```

The denylist is a plain text file of words that must never appear in this repository (names, account names and similar).
It is kept privately and is **never committed**. The script prints every hit with its file and line and fails if there
is any, and it also fails if any file the data check would block is present. The file format is explained at the top of
`scripts/check-public.mjs`.

## How a new release is made

Each release is done in a new Claude Code session that works on this public repository and has **read-only** access to
the private one. The private repository is never changed by a release.

1. **Copy the private code over this folder.** Delete everything in the working folder except `.git`, so files removed in
   the private repository also disappear here. Then copy the private `main` with `git archive` (only tracked files, never
   local data):

   ```bash
   git -C /path/to/private-clone archive main | tar -x -C /path/to/arc40-public
   ```

2. **Redo the public cleanup.** The private copy has personal notes, so the same cleanup as the first release is done
   again: CLAUDE.md's personal details replaced with the neutral line, the README sections for this repository ("How this
   was built", "Try it with demo data", security and license), `LICENSE`, `SECURITY.md`, this guide and
   `scripts/check-public.mjs` with its tests kept. A `git diff` against the previous release shows anything that came back.
3. **Run every check:** `npm ci`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run check:data`, a secret
   scan, and `check-public.mjs` on the whole folder with the denylist the owner pastes in. All must pass with zero hits.
4. **Review, then one commit** named "Arc40 vX.Y.Z" on `main`, pushed to GitHub.
5. **Make the GitHub Release** `vX.Y.Z` (this creates the tag) with a few demo screenshots.

## What Git and GitHub words mean

- **Commit:** one saved snapshot of the code, with a message saying what changed.
- **Branch:** a separate line of commits. This repository only uses `main`.
- **Tag:** a permanent bookmark on one commit. Here each release tag (like `v2.1.0`) marks a release commit. Tags never
  move.
- **Release:** a GitHub page for a tag, with notes and pictures.
- **Ruleset:** a GitHub setting that protects `main`. Here it blocks force pushes and deleting the branch, so history can
  only grow.
