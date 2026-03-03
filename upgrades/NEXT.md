# Upgrade Guide — vNEXT

<!-- bump: patch -->
<!-- Valid values: patch, minor, major -->
<!-- patch = bug fixes, refactors, test additions, doc updates -->
<!-- minor = new features, new APIs, new capabilities (backwards-compatible) -->
<!-- major = breaking changes to existing APIs or behavior -->

## What Changed

**Fix: Playbook commands (add, status, list, etc.) now correctly locate the manifest**

The `PLAYBOOK_CONFIG` environment variable was not being set when Instar launched playbook Python scripts. Without it, scripts fell back to using the Instar package directory as the playbook root instead of the agent's `.instar/playbook/` directory. This caused:
- `instar playbook add` → "Error: General error" (exit code 1)
- `instar playbook status` → "Error: General error" (exit code 1)
- `instar playbook list` → "0 items" despite manifest having items

Fixed by adding `makePlaybookEnv(stateDir)` helper that sets `PLAYBOOK_CONFIG` pointing to the agent's playbook config file, and passing it to all `execPython` calls.

## What to Tell Your User

- **Playbook commands fixed**: "The `instar playbook add`, `status`, and other commands were failing with a 'General error' — that's now fixed. If you saw this issue, update to this version and your playbook commands should work correctly."

## Summary of New Capabilities

| Capability | How to Use |
|-----------|-----------|
| Playbook add/status/list working | Run `instar playbook status` or `instar playbook add --content "..."` |
