# COP — Claude Code Notes

## Architecture Explorer

- `docs/architecture.html` — interactive architecture reference (single self-contained HTML file)
- Regenerate after significant codebase changes (new services, config changes, proto changes, structural refactors)
- When regenerating, re-explore the codebase to pick up changes, update all sections, and bump the timestamp in the HTML comment at the top of the file
- Regenerate with the slash command: `/update-cop-architecture`
  - Checks for impacting commits since the last update; stops if nothing changed
  - Handles branching automatically: pulls main, creates `docs/cop-architecture-update-YYYY-MM-DD`, commits, then asks about push
