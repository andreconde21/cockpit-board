# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.
Releases are cut from `master` by tagging `X.Y.Z`; the release workflow uses
the matching section below as the GitHub release notes (falling back to
auto-generated notes when a section is missing).

Add new entries under `Unreleased`; move them into a version section when
cutting the release.

## [Unreleased]

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
- Case-insensitive label color matching (`Comparis` reuses the `COMPARIS`
  color).

## [1.0.10] - 2026-09-10

### Fixed
- Duplicate/split card filenames stay bounded instead of growing a
  `-copy`/`-cont` chain.

## [1.0.9] - 2026-09-08

### Fixed
- Keyboard shortcut, date handling, and rendering fixes.
