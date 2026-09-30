# Repository workflow

- Work on the `test` branch by default. The user explicitly requested this branch name.
- After each completed change, run relevant checks, commit the change, and push `test` to the GitHub remote `github` (`https://github.com/Smak0001/Stem-de-hit.git`). Report any failed checks or blocked pushes; never claim success without verification.
- Do not commit or push directly to `main`. Merge into `main` only when the user explicitly authorizes that merge.
- A push to `test` is not authorization to publish to the live site or to push to the separate Sites remote `origin`.
- Never commit secrets, `.env` files, credentials, or unrelated local artifacts. Preserve unrelated user changes.
