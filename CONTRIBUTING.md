# Contributing

## Workflow

1. Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>` or `docs/<short-name>`. Never push straight to `main`.
2. Keep each pull request to one concern. Unrelated clean-ups go in their own PR.
3. Open a PR against `main` and fill in the template. The PR title is the commit message on merge, so write it in the imperative ("Add device frames", not "Added" or "WIP").
4. CI must pass and the code owner must approve before merging. Prefer squash merges to keep `main` linear.

## Before you push

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

These are the checks CI runs (`.github/workflows/ci.yml`). Run `pnpm e2e` too when you change the side panel, simulator or service worker, and `pnpm validate` when you change a collector, analyzer or the audit pipeline (it compares reported numbers with ground truth). Test code that calls `bg:probe` or `bg:fetch-css` must pass `pageUrl`, as the panel does.

## Code rules

- Analyzers in `packages/*` are pure functions (data in, findings out). Put page access in `extension/content`, not in analyzers.
- Every new rule or behaviour gets a unit test in `tests/unit`. A rule id emitted by an analyzer must also exist in the `recommendation-engine`.
- No new runtime dependencies without a reason in the PR description. Avoid new extension permissions; if one is needed, explain it and update `PRIVACY.md`.
- Build output must stay ASCII (the build guard rejects non-ASCII in bundled JS). Write glyphs in source as escapes or inside strings esbuild can escape.
- Match the surrounding code style; `pnpm lint:fix` fixes most formatting.

## Commits

- Imperative subject line, 72 characters or fewer, with a body that explains _why_ when it is not obvious.
- Do not commit `dist/`, local screenshots, or secrets.

## Releases

Follow [the software management and release policy](docs/SOFTWARE_MANAGEMENT.md). Keep the root package, extension manifest and every workspace package on the same version. Add a changelog entry and a release note under `docs/releases/`, update the README's latest-release link, and verify whether the lockfile needs changes.
