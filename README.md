# Conference Desk 2026

A conference participant dashboard with a warm liquid-glass interface, interactive world map, country-grouped cards, attendance tracking, priority flags, and an Excel export. Built for the Publishers Conference in Sharjah, 1–3 November 2026.

This public repository contains application code and an **empty participant template only**. Real participant contacts, notes, progress, backups, and original spreadsheets are kept locally. There is no public hosted dashboard.

## Features

- An icon-only navigation rail with panels for all participants, priority, non-attendees, and countries. Panels start folded.
- A large offline world map. Hover or focus to see participants; click a country to filter its cards. Countries without attendees are dimmed, and countries with priority participants glow red.
- Contact cards with separate first and last names, organization, email, available phone numbers, and country flags.
- **Add participant** in FH and SM opens a glass form for a new card. Enter any known details; email, phone, names, organization, and country may be left blank. At least one identifying detail is needed. Attendance, visa requirement, priority, completed arrangements, and an initial note can be set when creating the card. A repeated email is flagged before another card is added.
- New cards appear in the owner's workspace and PR automatically, including filters, country navigation, the map, totals, and Excel exports. Cards with no country are grouped under **Country not provided**. PR cannot create cards.
- Green/red attendance toggles and independent Visa, Flight, and Hotel checkboxes. Arrangement totals count attending participants; changing attendance preserves completed work.
- Foldable notes with editable to-do items, completion checkboxes, deletion undo, and autosaved drafts.
- Search and combined country, attendance, priority, and completion filters.
- All dropdowns use matching glass menus, with searchable country lists, flags, selected checkmarks, keyboard navigation, and placement that adapts to the screen.
- The bottom-left avatar switches between **FH**, **SM**, and **PR**. FH and SM show their assigned guests; PR combines both by country. Cards display their owner, and the map, filters, counts, navigation, and Excel export follow the selected workspace.
- Workspaces share one saved record per guest. Visible tabs refresh from the local server every two seconds and when focused. PR can change Visa/Flight/Hotel completion and mark notes reviewed or done; other card edits and restore are available in FH and SM.
- A green/orange visa requirement button distinguishes not-required from required. Visa completion totals include only attending guests who require a visa, and waived visas are excluded from the card’s required-arrangement count.
- Pasted working-list statuses remain reference text, separate from completion checkboxes. Uploaded documents do not automatically mean a visa or flight booking is complete.
- Soft focus highlights, fluid drawer and note transitions, a fixed map overview, and subtle button feedback. Card updates preserve the focused control and note input. The operating system's reduced-motion preference is respected.
- **Export Data** downloads a real `.xlsx` workbook with Participants and Notes worksheets, frozen headings, and filters. It includes the complete list, statuses, notes, and drafts regardless of the current screen filters.

## Run locally

First, place your private `participants.js` file alongside `index.html`. This file is ignored by Git. When moving an existing dashboard, also copy its private `data/` folder locally so its saved progress remains available. Neither file should be uploaded to GitHub. Optional private `workspaces` labels supply the names shown for FH and SM; generic labels appear when none are supplied.

For an empty installation, copy `participants.example.js` to `participants.js` and populate it with your own private participant list. The public example contains no real or sample contacts.

On Windows, double-click **Start Dashboard.cmd**. The launcher uses the Python bundled with Codex if installed, then falls back to Python on your PATH. It opens `http://127.0.0.1:8765/` and reuses an existing local server when possible.

On other systems, or from a terminal with Python 3.10 or later:

```sh
python server.py --open
```

The local server uses Python's standard library. The browser app has no package installation or external service dependency. Flag assets and map geometry are bundled.

## Saving and backups

With the local server, edits first save in browser storage and then in `data/progress.json` using atomic replacement. The latest 100 previous file saves are retained in `data/backups/`. The save indicator shows when the file is up to date, and failed requests retry from a browser queue.

New cards are confirmed only after the local server saves them. Their contact details live in the private progress file, rather than in application source. Interrupted creation requests can be retried safely without duplicating a card. JSON backups include added cards and their progress; restoring an older backup preserves cards created since that backup. Existing FH and SM records are preserved when this feature is installed.

When served as a static website, including GitHub Pages, progress saves **only in the current browser on the current device**. The site does not synchronize notes between browsers or devices. Clearing site data removes that browser's copy.

To transfer existing work, use **How saving works → Download restore backup** on the original dashboard, then **Restore** on the destination. Restore uses JSON backups with matching participant IDs, previews the change, and downloads the current progress before replacement. The Excel export is for reviewing and working with data outside the dashboard.

Local progress, backups, spreadsheets, logs, and test output are excluded from this repository. Keep a separate backup when moving computers or changing site addresses.

## Participant data

Your local `participants.js` supplies the participant list. Each record has a stable `id`, `email`, `firstName`, `lastName`, `organization`, `country`, lower-case `countryCode`, `phones` array, and initial `attending` boolean. Optional fields include `owners` (FH or SM), `visaRequired`, `sourceStatus`, and `contactReview`. Existing records without an owner default to FH. IDs use email where available; missing contacts use stable local IDs. Names remain separate from organizations, and missing contact details stay blank.

When an existing FH roster is extended with SM records, the server preserves the original records and writes a migration backup before saving the expanded list. Restoring a legacy FH-only backup preserves current SM progress. JSON restore backups cover both workspaces; Excel exports cover the currently selected workspace and include ownership, visa requirement, source reference, and note review columns.

Participant files in a public repository or static website are public. A static frontend cannot hide data that it downloads. Keep private contact lists and personal progress outside public version control.

## Hosting

Use the local launcher or Python server for this installation. The server binds to `127.0.0.1` and keeps the progress file on this computer. GitHub is used for the application source only; GitHub Pages is not enabled. A private remote deployment with authentication and shared storage would be a separate hosting step.

## Tests

```sh
node tests/core.test.cjs
python -m unittest discover -s tests -p "test_*.py"
```

Core checks cover filters, completion totals, state validation, country counts, map geometry, and country-code coverage. Persistence checks use isolated temporary folders and verify backups, atomic validation, replay handling, notes, and restart recovery.

`tests/add_participant.cjs` runs browser integration checks with invented contacts and a separate local test server. It requires Playwright and Chrome, and accepts `DASHBOARD_PYTHON` and `DASHBOARD_CHROME` for runtime paths. It covers creation, optional details, duplicate detection, PR synchronization, new countries, mobile layout, keyboard interaction, safe retries, backups, and server restarts.

## Map and flag credits

Country boundaries come from [Natural Earth](https://www.naturalearthdata.com/), which provides public-domain geographic data. Map paths were prepared with the Natural Earth I projection through [D3 Geo](https://d3js.org/d3-geo); D3 is not needed at runtime.

Flags come from [flag-icons](https://github.com/lipis/flag-icons), version 7.5.0, under its MIT license. The included license and source notice are in `assets/flags/`.
