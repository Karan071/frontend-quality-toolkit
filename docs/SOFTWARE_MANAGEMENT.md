# Software Management Policy

## Change management

- Work on a short-lived branch created from `main`, using `feat/`, `fix/`, `chore/` or `docs/` prefixes. Do not push changes directly to `main`.
- Keep each pull request focused on one concern. Describe the user impact, implementation, validation performed and any security or permission implications in the pull request template.
- Require CI to pass and code-owner approval before merging. Prefer squash merges to keep `main` linear.
- Use imperative commit subjects of 72 characters or fewer. Explain non-obvious decisions in the commit body.

## Engineering quality

- Install from the committed pnpm lockfile with `pnpm install --frozen-lockfile`.
- Before proposing a change, run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`. Run `pnpm e2e` when changing the side panel, simulator or service worker.
- Add or update focused unit tests for behavior changes. Keep generated build output, local screenshots and secrets out of commits.
- Keep analyzers pure and page access in `extension/content`. Document new extension permissions in `PRIVACY.md`; avoid new runtime dependencies unless justified.

## Versioning

- Use semantic versioning (`MAJOR.MINOR.PATCH`). While the product is pre-1.0, treat the public API as evolving and document behavior changes in release notes.
- Keep the root `package.json`, `extension/manifest.json` and every `packages/*/package.json` at the same release version.
- A release updates `CHANGELOG.md`, adds `docs/releases/<version>.md`, and updates the latest-release link in `README.md`.
- Refresh `pnpm-lock.yaml` when dependency or workspace metadata changes. A version-only bump does not require a lockfile diff if the lockfile content is unchanged.

## Release procedure

1. Create `chore/release-X.Y.Z` from an up-to-date `main` branch.
2. Update all version fields together, the changelog, the versioned release note and the README latest-release link.
3. Run the required engineering checks and verify that all version fields match and the extension manifest is valid.
4. Open a pull request to `main`; wait for passing CI and code-owner approval before merging.
5. After merge, create the `vX.Y.Z` tag on the merge commit and publish the matching GitHub release using the versioned release note. Build distributables from the tagged source; do not commit `dist/`.
6. Upload the built extension to the Chrome Web Store and confirm the listing and package pass store validation.

## Operational follow-up

- Track defects found after release as focused issues and ship fixes through the same review and CI process.
- For a release-blocking defect, pause publication or supersede the release with a new patch version. Do not rewrite a published release tag; document corrections in a follow-up release.
