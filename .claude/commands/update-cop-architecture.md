# Update COP Architecture Explorer

Update the `common-operating-picture/docs/architecture.html` interactive architecture reference, with a proper git branching workflow.

## Step 1 — Check for impacting changes

1. Read the HTML comment on line 1 of `common-operating-picture/docs/architecture.html` to extract the last-updated timestamp (format: `Generated: YYYY-MM-DD HH:MM:SS UTC`).
2. Run `git log --oneline --since="<that date>" -- common-operating-picture/proto common-operating-picture/api common-operating-picture/pkg common-operating-picture/cmd common-operating-picture/db/schema.sql common-operating-picture/config.example.yaml common-operating-picture/compose common-operating-picture/cop.Dockerfile common-operating-picture/ui/src` to find commits that touch architecture-relevant paths.
3. If the log is **empty** (no impacting changes): report "No significant changes to the COP codebase since the last architecture update (YYYY-MM-DD). Nothing to do." and **stop**.

## Step 2 — Show the user what changed

Display a short summary of the commits found (date, hash, message). Confirm you're about to proceed with a branch + update.

## Step 3 — Git workflow

Run these commands in sequence, stopping if any fails:

1. Verify the working tree is clean (`git status`). If there are uncommitted changes, warn the user and stop — do not proceed.
2. `git checkout main`
3. `git pull`
4. `git checkout -b docs/cop-architecture-update-YYYY-MM-DD` (use today's actual date)

## Step 4 — Re-explore and update the architecture document

1. Re-explore the `common-operating-picture/` directory thoroughly to pick up any changes since the last update — focus on the paths that had commits (from Step 1), but also do a general pass for anything structural that may have shifted.
2. Update `common-operating-picture/docs/architecture.html`:
   - Revise all sections that are affected by the changes found
   - Bump the timestamp in the HTML comment on line 1 and in the top bar `<span class="updated">` to today's date and current UTC time (HH:MM:SS UTC)
3. Keep the same visual style, interactivity, and structure — only update content.

## Step 5 — Commit

```
git add common-operating-picture/docs/architecture.html
git commit -m "docs(cop): update architecture explorer

Reflects changes since <previous date>:
<one-line summary of what changed>"
```

## Step 6 — Ask about pushing

Ask the user: "Branch `docs/cop-architecture-update-YYYY-MM-DD` is committed locally. Would you like me to push it to GitHub (`git push -u origin <branch>`)?"

Only push if the user confirms.