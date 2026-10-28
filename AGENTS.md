# AGENTS.md

## Coding standards

How code is written here: @CODING_STANDARDS.md

Those rules are normative and apply to **every** change, trivial or complex.

## Commit messages

Conventional Commits, as semantic-release parses them: `feat: …`, `fix: …`, `docs: …`.
While the version is below 1.0, do not mark anything breaking: semantic-release would jump
straight to 1.0.0. Only the maintainer decides when 1.0 comes.

## Agent skills

### Issue tracker

Features, specs, maps, tickets and bugs live as GitHub issues in
`lharzenetter/order-processor`, driven with the `gh` CLI. Never write them as local files under
`.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, unchanged (`needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: the glossary is `CONTEXT.md` at the repo root, ADRs go in `docs/adr/`. See
`docs/agents/domain.md`.
