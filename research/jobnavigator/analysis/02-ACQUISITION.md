# Controlled Acquisition Result

## Result

Gate 1 passed.

- Repository: `https://github.com/vesaias/JobNavigator`
- GitHub repository ID: `1211525664`
- Default branch: `main`
- Exact revision: `387b2c9bd7f1bd627c396c6dddc8d750ce3c4bfb`
- Commit date: `2026-07-21T17:33:54+02:00`
- Commit subject: `Model updates + Resumes rename`
- Tracked files: 227
- Checkout size excluding `.git`: 12,198,045 bytes
- Clone: shallow, one commit, no tags, no submodules
- `git fsck --full`: no integrity errors
- Worktree after acquisition: clean
- Push URL: disabled

No package manager, Docker build, application script, migration, browser
extension or upstream test was run.

## Acquisition command

```powershell
git -c core.hooksPath=NUL -c submodule.recurse=false clone `
  --depth 1 `
  --no-tags `
  --filter=blob:none `
  --no-recurse-submodules `
  --config core.autocrlf=false `
  https://github.com/vesaias/JobNavigator.git `
  JobNavigator
```

## License evidence

The repository declares MIT in `LICENSE`. Its captured SHA-256 is:

`BFE3C2F18948E74EE54A9A229D67A1E300B8B457A3BEB64C910472B8A87B8480`

MIT permits use, modification and distribution subject to preserving the
copyright and permission notice. Any copied or adapted code must be recorded in
a future `THIRD_PARTY_NOTICES.md`.

## Reproducibility note

All static conclusions in this intake refer only to the captured revision.
Upstream may change after this review; a future refresh must be acquired into a
new revision record and compared explicitly.
