# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.
Releases are cut from `master` by tagging `X.Y.Z`; the release workflow uses
the matching section below as the GitHub release notes (falling back to
auto-generated notes when a section is missing).

Add new entries under `Unreleased`; move them into a version section when
cutting the release.

## [Unreleased]

## [1.3.0] - 2026-09-22

### Added
- Quick-add deep link: `obsidian://cockpit-board?vault=MyVault&quickadd=Title&due=today&time=18:00`
  files a task without opening the board UI. Optional `project`, `labels`
  (comma-separated), and `open` (`board`|`calendar`|`archive`|`none`,
  default `none`). For phone home-screen and dictation shortcuts.

## [1.2.0] - 2026-09-22

### Added
- Deep link `obsidian://cockpit-board?vault=MyVault&view=board|calendar|archive`
  for one-tap access to the board, calendar, or archive. Works on desktop,
  Android, and iOS — pin it as a home-screen shortcut. Cold-start safe.
- "Open archive search" and "Open calendar view" commands now share the same
  entry point as the deep link.

## [1.1.1] - 2026-09-19

### Fixed
- Community review compliance: settings inputs styled via CSS classes
  instead of inline styles; pruned calendar cards go through the trash per
  the user's deletion preference.
- Stricter external-sync typings (no unsafe assignments or assertions on
  frontmatter reads).

## [1.1.0] - 2026-09-18

### Added
- External calendar sync (Outlook/ICS): import events as cards with a
  per-calendar label, project, sync window, and sync interval.
- Sources: published ICS URL, vault `.ics` file, or desktop absolute path
  (e.g. `~/Downloads/client.ics`).
- One-way editable import: imported cards are never overwritten; a known
  meeting whose key changed (Outlook move, timezone correction) updates in
  place instead of duplicating, while user-edited times always win.
- Cancellation handling: `STATUS:CANCELLED` and `Canceled:`/`Cancelled:`
  subjects never import and suppress that day's series occurrence (no ghosts);
  vanished events are pruned per the calendar's "when events disappear"
  policy (keep / mark done / delete).
- Recurring series expansion (daily/weekly/monthly/yearly) with
  `RECURRENCE-ID` overrides and `EXDATE` support.
- Timezone alignment: UTC and zoned times convert to device time; naive
  times use the calendar's IANA source timezone (e.g. `Europe/Zurich`);
  common Outlook (Windows) zone names are mapped automatically.
- Manual sync via the "Sync external calendars now" command and settings
  button; auto-sync on startup, hourly, and on a configurable interval.
- Chronological time ordering within day columns (all-day cards first;
  explicit drag order still wins).
- Case-insensitive label color matching (`ClientAcme` reuses the
  `CLIENTACME` color).

## [1.0.10] - 2026-09-10

### Fixed
- Duplicate/split card filenames stay bounded instead of growing a
  `-copy`/`-cont` chain.

## [1.0.9] - 2026-09-08

### Fixed
- **Set due next week** picked *today* on Mondays; card and bulk menus now
  agree on the following Monday.
- **N (new card)** works whenever the board is active, not just with a
  selection.
- Board shortcuts (`F`, `D`, `T`, `N`, `Delete`) no longer fire while another
  pane is active.
- Overdue badge no longer counts cards with unparsable due dates.
- Week view stretches past 07:00–22:00 for early/late cards.
- Recurring tasks quote `project`/`labels` YAML (fixes values like
  `[[Client]]` or `Ops: infra`) and dedupe no longer matches unrelated
  filename prefixes.

### Changed
- Board only re-renders on changes inside the tasks/archive folders, not on
  any vault change.

## [1.0.8] - 2026-09-04

### Added
- Configurable reminder lead times (default `15,1`), each firing once per
  card per day, checked every 30 seconds.
- Optional desktop notifications so reminders arrive with Obsidian in the
  background.

## [1.0.7] - 2026-09-01

### Added
- Optional auto-archive of done cards into the archive folder.

## [1.0.6] - 2026-08-20

### Fixed
- Card title and bulk interaction fixes.

## [1.0.5] - 2026-06-18

### Fixed
- Portal review-blocking errors.

## [1.0.4] - 2026-06-16

### Fixed
- Scorecard risks/warnings: timers, document handling, deprecations.

## [1.0.3] - 2026-06-08

### Fixed
- Scorecard warnings from `text-decoration` usage.

## [1.0.2] - 2026-05-27

### Added
- `CONTRIBUTING.md`.

### Changed
- Minimum app version bumped to 1.5.0.

## [1.0.1] - 2026-05-26

### Fixed
- Drag-and-drop reliability: atomic frontmatter writes, metadata-cache sync,
  scroll preservation, and refresh gating.
- CI install fixes (peer deps, pinned provenance action).

## [1.0.0] - 2026-04-01

### Added
- Initial release: dynamic Kanban board for Obsidian driven by frontmatter
  properties.
