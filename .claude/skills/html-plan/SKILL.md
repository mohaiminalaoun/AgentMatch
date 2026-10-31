---
name: html-plan
description: Turn a Claude plan (a plan-mode plan file or a plan written in the conversation) into one readable, self-contained HTML page and open it in the browser. Use when the user says "write the plan as html", "make the plan readable", "html plan", or runs /html-plan.
---

# HTML plan

Write the current plan as one HTML page that someone can read top to bottom and understand without having seen the conversation.

## Steps

1. **Find the plan.** Use the plan file named in this session's plan-mode messages, or the plan in the conversation if there's no file. If the user names a file, use that one. Read it in full; don't work from memory.

2. **Decide what the reader needs.** The page is for the user to understand and judge the plan, so it must answer, in this order:
    - **Why:** the problem, with the concrete evidence that prompted it (log lines, numbers, examples), in plain words.
    - **The aimed result:** what will be true when the plan is done, as checkable outcomes. If the plan doesn't state one, write it from the plan's goals and say nothing it doesn't support.
    - **Ground rules:** the principles and constraints, as a two-column table (rule, what it means).
    - **The steps:** one numbered card per step: a short title, what changes (bullets), and one muted line on why it's in that place, when the plan gives a reason. Mark checkpoints and decisions the user must make with a small tag.
    - **How we'll know it worked:** the verification, as short blocks.
    - **Parked / later:** anything deferred.

3. **Write for reading, not for executing.**
    - Lead each bullet with a bold phrase, then plain-language detail. No walls of text: at most about 4 lines per bullet, nested bullets instead of long sentences.
    - Keep every decision, constraint, and step from the plan. Rephrase, don't drop. File paths, commands, and function names go in `<code>`, but explain what each is for the first time it appears.
    - Explain jargon from the codebase once, in passing. Use real names and numbers from the plan, not placeholders.
    - Don't add steps, promises, or numbers the plan doesn't contain.

4. **Build the page from [template.html](template.html).** Copy it and fill in the sections. Keep its tokens, light and dark colors, and components (`.card`, `.step`, `.num`, `.result`, `.check`, `.tag`, `.why`, tables in `.table-wrap`). No external scripts, fonts, or images: the page must work offline. Set `<title>` to a 2–4 word name for the plan.

5. **Save it outside the repo.** Write it to the session's scratchpad directory (or `/tmp` if there's none) as `<short-plan-name>.html`, never in the project, unless the user asks for a location. Then open it with `open <path>` (macOS) or `xdg-open <path>`.

6. **Report** the full absolute path, and the aimed result in 3–6 bullets, so the user can check the page matches what they expect.

## Never

- Never change the plan's substance while making it readable. If something in the plan looks wrong or unclear, say so in your reply; don't fix it silently on the page.
- Never put secrets, `.env` contents, or private data (real people's profiles, private notes, run log rationales) on the page.
- Never commit the HTML file.
