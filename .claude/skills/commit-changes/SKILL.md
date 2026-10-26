---
name: commit-changes
description: Check the uncommitted changes in this repo for leaked secrets or private information, then group them into logical commits and commit each with a one-line Conventional Commits message. Use when the user says "commit", "commit changes", "commit this", or runs /commit-changes.
---

# Commit changes

Commit the uncommitted work as one or more logical commits, without asking for permission unless something is unclear.

## Steps

1. **See everything that changed.** Run `git status --short` and `git diff` (plus `git diff --cached` if anything is staged). Read new untracked files in full.

2. **Check for leaks before anything else.** Go through every changed line and every new file, looking for:
    - **Secrets:** API keys, tokens, passwords, private keys, connection strings with credentials, `.env` files or their contents. Watch for patterns like `sk-`, `ghp_`, `AKIA`, `Bearer `, `-----BEGIN`, and long random-looking strings assigned to names like `key`, `token`, or `secret`.
    - **Private information:** email addresses, phone numbers, home addresses, real names of people other than the repo owner, and private URLs (internal dashboards, signed links, private endpoints).
    - **Proprietary or internal information:** anything copied from a private source, such as company code, internal docs, or confidential data. In this repo, that includes hackathon strategy, prizes, credits, and judging notes, which belong in the private `readme-inprogress.md`, not in public files.

    If you find anything, **stop and commit nothing.** Show each finding with its file and line, say why it's a problem, and ask the user how to handle it. Don't remove or edit it yourself unless asked.

3. **Group the changes by purpose.** One commit per logical change, for example "add Prettier setup" vs. "rename sim folder". Files that change together for one reason go in the same commit. A file can belong to only one commit, so if a file mixes unrelated changes, put it with its main purpose.

4. **Write one line per commit** in Conventional Commits style: `type(scope): description`.
    - Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`, `perf`, `build`, `ci`.
    - The scope is optional and short, such as `engine`, `evaluation`, `ui`, or `ux`.
    - The description is lowercase, imperative ("add", not "added"), has no period, and stays under about 72 characters.
    - Examples: `chore: set up prettier with format on save`, `refactor(evaluation): rename sim folder to evaluation`, `fix(ux): keep focus on the approve button`.
    - No body, no co-author or attribution lines.

5. **Commit each group.** Stage only that group's files with `git add <paths>` (never `git add -A` or `git add .`), then `git commit -m "<message>"`. Repeat for each group.

6. **Report** each commit's hash and message, then run `git status --short` to show anything left over.

## When to ask first

Commit without asking, except in these cases. Then stop, show the proposed grouping and messages, and ask:

- The leak check in step 2 found something.
- You can't tell what a change is for, so you can't write an honest message.
- There are more than about 4 logical groups, or a single group is very large (roughly 500+ changed lines across many files), so the user should check the split.
- A file looks like it shouldn't be in git at all, such as large binaries or generated output not covered by `.gitignore`.

## Never

- Never push.
- Never amend, rebase, or rewrite existing commits.
- Never use `--no-verify`. If a hook fails, report the error and stop.
- Never commit files listed in `.gitignore`. In this repo, `steps.md` and `readme-inprogress.md` are private and must stay out of git.
