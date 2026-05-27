# Contributing to Cockpit Board

Thanks for your interest in contributing! This document explains how to set up the project locally, where to report issues, and what to expect from the review process.

## Reporting issues

Please file bugs and feature requests at https://github.com/andreconde21/cockpit-board/issues. When reporting a bug, include:

- Your Obsidian version (Help → About)
- Your operating system
- Steps to reproduce
- What you expected vs. what happened
- A screenshot or screen recording if the bug is visual

## Development setup

```bash
git clone https://github.com/andreconde21/cockpit-board.git
cd cockpit-board
npm install --legacy-peer-deps
```

### Build

```bash
npm run build       # type-check + production bundle
npm run dev         # esbuild in watch mode for development
npm run deploy      # build and copy to your local vault plugin folder
```

The `deploy` script expects an Obsidian vault at `~/Dropbox/Obsidian/Cockpit/`. Adjust the script in `package.json` to point to your own vault when developing.

### Project layout

```
src/
├── CockpitBoardPlugin.ts    # entry point, command registration, lifecycle
├── CockpitBoardView.ts      # the board view (rendering, drag/drop, persistence)
├── CockpitCard.ts           # card model
├── rule-engine.ts           # column resolution and drop-update logic
├── types.ts                 # shared types
├── ui/                      # card/column renderers, modals, helpers
├── calendar/                # week/month/year views
├── archive/                 # archive search
└── ...
styles.css                   # all plugin CSS
```

## Pull requests

1. Fork the repo and create a branch off `master`.
2. Make your change. Keep commits focused and descriptive.
3. Run `npm run build` and confirm it passes with no errors.
4. Open a PR against `master`. Include a short summary of the change and any relevant screenshots.
5. The maintainer will review and either merge or leave feedback.

## Coding conventions

- TypeScript strict-friendly (use real Obsidian types from the `obsidian` package — `App`, `TFile`, `TFolder`, `Menu`, etc. — instead of ad-hoc interface shapes)
- Prefer `processFrontMatter` for frontmatter edits — Obsidian guarantees metadata-cache consistency
- Use `activeWindow.setTimeout` / `activeDocument` instead of bare `setTimeout` / `document` for popout-window compatibility
- CSS: no `!important`; raise specificity instead
- DOM: use `createDiv`/`createSpan`/`createEl` helpers, never `innerHTML`

## Releases

Releases are tagged from `master` and pushed to the `*.*.*` tag pattern, which triggers `.github/workflows/release.yml`. The workflow builds, attests provenance via `actions/attest-build-provenance`, and creates the GitHub release with the three plugin assets (`main.js`, `manifest.json`, `styles.css`).

To cut a release:

```bash
# bump version in manifest.json, package.json, versions.json
git add manifest.json package.json versions.json
git commit -m "release: X.Y.Z"
git tag -a X.Y.Z -m "Release X.Y.Z"
git push origin master
git push origin X.Y.Z
```

## License

By contributing you agree that your contributions will be licensed under the MIT license (see `LICENSE`).
