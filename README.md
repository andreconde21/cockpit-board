# Cockpit Board

A dynamic Kanban board for [Obsidian](https://obsidian.md) driven by frontmatter properties. Drag-and-drop updates files instantly. Includes calendar views, timers, recurring tasks, and a checklist editor.

## Features

- **Kanban Board** — Cards auto-sort into columns based on configurable rules (`status:`, `date:`, `label:`, `no-date`)
- **Drag & Drop** — Move cards between columns or reorder within. Bulk drag with multi-select (Ctrl+Click)
- **Calendar Views** — Week, month, and year views with time grid, all-day cards, and year heatmap
- **Timers** — Start/stop timers on cards, time tracked in `time_spent` frontmatter
- **Recurring Tasks** — Cron-based rules create tasks automatically each day
- **Checklist Editor** — Click the checklist count to open a drag-and-drop editor modal
- **Archive Search** — Search completed tasks in a YYYY/MM/DD folder structure
- **Due-Soon Notifications** — Get notified 15 minutes before a task's scheduled time
- **Mobile Optimized** — Tab-based column switching with swipe gestures
- **Privacy Mode** — Blur card titles (hover to reveal) for screen sharing
- **Focus Mode** — Show only Today + In Progress columns (press `F`)
- **Split & Close** — Split a partially-completed checklist into done + continuation cards

## Installation

### From Community Plugins (recommended)

1. Open **Settings > Community plugins**
2. Click **Browse** and search for "Cockpit Board"
3. Click **Install**, then **Enable**

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/andreconde21/cockpit-board/releases)
2. Create a folder `<vault>/.obsidian/plugins/cockpit-board/`
3. Copy the three files into that folder
4. Enable the plugin in Settings > Community plugins

## Quick Start

1. Create a folder for your tasks (e.g., `Tasks`)
2. Go to **Settings > Cockpit Board** and set the **Tasks folder**
3. Open the board with the ribbon icon or command palette: "Open Cockpit Board"
4. Create task files with frontmatter:

```yaml
---
title: "My Task"
status: scheduled
due: 2026-04-15
time: "14:00"
completed:
project: "Project X"
labels: [Work, DEADLINE]
created: 2026-04-01
source: manual
---

# My Task

Task description here.

## Checklist: Steps
- [ ] Step one
- [ ] Step two
```

## Frontmatter Properties

| Property | Type | Description |
|----------|------|-------------|
| `title` | string | Card title (falls back to filename) |
| `status` | string | `scheduled`, `in-progress`, `pending`, `done`, or custom |
| `due` | date | Due date (`YYYY-MM-DD`) |
| `due_end` | date | End date for multi-day tasks |
| `time` | string | Time (`HH:MM`) — shows in calendar time grid |
| `completed` | date | Date marked as done |
| `project` | string | Project name — shown as `[Project] Title` |
| `labels` | list | Labels for filtering and color-coding |
| `order` | number | Custom sort order within a column |
| `time_spent` | number | Timer minutes tracked |
| `source` | string | `manual`, `recurring`, etc. |
| `created` | date | Creation date |

## Column Rules

Rules determine which column a card belongs to. Evaluated in order: status rules first, then date/label rules.

| Rule | Matches |
|------|---------|
| `status:done` | Cards with `status: done` |
| `status:in-progress` | Cards with `status: in-progress` |
| `status:pending` | Cards with `status: pending` |
| `date:today` | Due today or overdue |
| `date:tomorrow` | Due tomorrow |
| `date:future` | Due after tomorrow |
| `no-date` | No due date set |
| `label:Personal` | Has the "Personal" label |
| `NOT label:Work` | Does not have "Work" label |
| `no-date AND label:Personal` | Combine with AND |

## Recurring Tasks

Create a JSON file (e.g., `Scripts/recurring.json`) and set its path in Settings:

```json
{
  "tasks": [
    {
      "title": "Weekly review",
      "cron": "0 7 * * 5",
      "labels": ["Work"],
      "project": ""
    }
  ]
}
```

Cron format: `minute hour dayOfMonth month dayOfWeek` (standard cron).

Special frequencies: `biweekly-2nd-sat`, `monthly-1st-mon`.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `F` | Toggle focus mode |
| `T` | Move selected cards to today |
| `D` | Mark selected cards as done |
| `N` | New card |
| `Delete` | Delete selected cards |
| `Escape` | Clear selection |
| `Ctrl+Click` | Toggle card selection |
| `Shift+Click` | Range select cards |

## Settings

- **Tasks folder** — Folder to scan for task files
- **Archive folder** — Folder for archived tasks (YYYY/MM/DD structure)
- **Recurring config path** — Path to `recurring.json`
- **Card open mode** — Split pane, sidebar, or modal
- **Mobile default column** — Which column shows first on mobile
- **Privacy mode** — Blur card titles
- **Checklist editor** — Enable click-to-edit checklists
- **Card label tint** — Subtle background color from primary label
- **Custom card order** — Enable drag-and-drop reordering
- **Label Colors** — Assign custom colors to labels (auto-assigned from palette when not set)
- **Columns** — Add, remove, reorder, and configure column rules

## License

[MIT](LICENSE)
