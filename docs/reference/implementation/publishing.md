# Publishing to GitHub

Target repository: [arcazj/openbexi_timeline2.0](https://github.com/arcazj/openbexi_timeline2.0). The default branch is `master`.

## Version 2.0.0 publication

The owner requested release 2.0 and live demos for every bundled dataset.
Publish the validated source commit to `master`, tag it `v2.0.0`, and create a
stable release using [these notes](../../releases/v2.0.0.md). Enable the existing
GitHub Pages workflow for the standalone demos and verify its deployment.
The version 1.0.0 exception below is historical and does not describe this release.

## Version 1.0.0 Publication (historical)

The owner directed publication of version `1.0.0` to `master`, with tag `v1.0.0`, without a required verification, test, or build gate. Publish this release directly from the source commit. Existing candidate and demo workflows remain available, but their results are not prerequisites for this owner-directed publication. No new test, build, browser, or production qualification is claimed by the version or tag.

The project code and authored documentation use [PolyForm Noncommercial License 1.0.0](../../../LICENSE). Commercial use requires a separate written license from the owner. Third-party dependencies, fonts, Unicode data, and legacy assets retain their own notices and terms; see [third-party notices](../../third-party-notices.md) and [data licensing](../../data-licensing.md).

The publication sequence is:

```sh
git remote set-url origin https://github.com/arcazj/openbexi_timeline2.0.git
git commit -m "Release OpenBEXI Timeline 1.0.0"
git push -u origin master
git tag -a v1.0.0 -m "OpenBEXI Timeline 1.0.0"
git push origin v1.0.0
gh release create v1.0.0 --repo arcazj/openbexi_timeline2.0 --target master --title "OpenBEXI Timeline 1.0.0" --notes-file docs/releases/v1.0.0.md --latest
```

Commit the prepared release changes while preserving Git history. GitHub provides source archives for the tag; this publication does not require rebuilding or attaching the earlier standalone preview. The owner requested removal of the old `arcazj/open_timeline2.0` repository after migration, without archiving it. Keep the local working directory and its data separate from that remote repository removal.

See [preview commit verification](preview-commit-verification.md) and [earlier publication verification](publication-verification.md) for historical results. Those records describe earlier commits and do not qualify version `1.0.0`.

## Publication Boundaries

Commit source, locked dependencies, shared contracts, tests, reviewed fixtures, screenshots, and documentation. Do not commit installed dependencies, the standalone build, runtime identities, local archives, tokens, private source exports, browser traces, or temporary PDF tooling.

`.gitignore` excludes the entire `runtime/`, `var/`, `tmp/`, `artifacts/`, and
`output/` trees, IDE state, and private configuration overrides under `yaml/local/`
and `config/local/`. Redundant PDF reports and their dedicated build scripts were
removed; Markdown specifications, licenses, provenance and reference images remain.
Removed tracked files remain recoverable from Git history.

`npm run check:repo` checks publication paths, common credential patterns, portable filenames, and local links in the entry documentation. `--staged` reads the Git index instead of the working tree; `--build` checks that first-party standalone build inputs are included. These checks cannot prove the absence of every secret or establish redistribution rights. Review screenshots and PDFs manually as well.

Original fixtures use `-text` Git attributes so that cloning on another OS does not change source hashes. Other text uses LF line endings. Existing screenshot verification JSON and PDFs describe the build captured at that time, not every later commit.

## Historical Preview Preparation

The following process records the earlier preview qualification workflow. Its tests and checks remain available for development; they are not a publication gate for the owner-directed `1.0.0` source release above.

1. Include the project license and existing third-party notices. The original preview used GPL-3.0; version `1.0.0` uses the license described above.
2. The owner approved the current preview's dataset/image redistribution on September 14, 2026; see [the approval record](../../data-licensing.md). Review newly added material separately. Do not infer permissions from JavaScript dependency licenses.
3. Inspect the staged diff, filenames, and file sizes. Keep real server exports and identity state out of Git.
4. Run the commands below from the repository root. Review failing/skipped cases before calling a release qualified.

```sh
npm ci
npm run check:repo
npm run build:demo
npm run check:repo -- --build
npx playwright install chromium
npm run test:demo
git status --short
git diff --cached --stat
npm run check:repo -- --staged --build
```

Stage only reviewed files. When the publication review is complete:

```sh
git commit -m "Prepare OpenBEXI Timeline 2.0 development preview"
git push -u origin master
```

Do not force-push. If GitHub has acquired commits since preparation, fetch and reconcile them first. The intended remote is `https://github.com/arcazj/openbexi_timeline2.0.git`. A prepared index is not a pushed commit, and a configured URL is not a live deployment.

## Enable the Live Demo

The [Standalone Demo workflow](../../../.github/workflows/demo.yml) builds on pull requests and pushes to `master`, with manual dispatch available. It runs client tests and a project-path browser smoke suite before creating an `openbexi-standalone` artifact. This contains only `index.html` and third-party notices, plus the Pages `.nojekyll` marker. It does not upload the checkout, Python service, `var/`, source exports, or credential files. A demo deployment is separate from the `1.0.0` GitHub source release.

The standalone HTML embeds all six local fixtures and the three supplied visual references. The demo therefore needs their redistribution review even though the original source files are not copied as separate web assets.

After completing that review:

1. Open repository **Settings > Pages** and choose **GitHub Actions** as the publishing source.
2. Under **Settings > Secrets and variables > Actions > Variables**, add `PUBLIC_DEMO_APPROVED` with value `true`. This is an approval flag, not a credential. No personal access token is required by the workflow.
3. Optionally require owner approval on the `github-pages` deployment environment, and restrict it to `master`.
4. Run **Actions > Standalone Demo > Run workflow** on `master`, or push a reviewed commit to `master`.
5. Wait for both build and deployment to succeed before describing the new demo as deployed.

Expected address: [https://arcazj.github.io/openbexi_timeline2.0/](https://arcazj.github.io/openbexi_timeline2.0/). The URL is a deployment target until the workflow succeeds. A custom domain or changed repository name changes it.

The old repository's first approved deployment succeeded on September 14, 2026:
[workflow run 34821760189](https://github.com/arcazj/open_timeline2.0/actions/runs/34821760189).
That repository used workflow publishing and `PUBLIC_DEMO_APPROVED=true`; both settings were
read back from GitHub at that time. Its live URL returned HTTP 200 and was exercised in a browser. These historical observations do not establish deployment or settings for the new repository.

The workflow uses GitHub's documented [custom Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), with pinned action commits and write/OIDC permissions confined to the deployment job. Pull requests never deploy. With the approval variable absent, the build/download remains available and the deploy job is skipped.

## Verify the Hosted Site

- Open the project URL in a fresh browser profile. Confirm Local mode and the default timeline/overview, with no Python service running.
- Switch through all six datasets from Help, search, move time, change row pages, and inspect a record.
- Test at desktop and mobile sizes. Check the browser console and make sure canvases and labels are nonblank.
- Disconnect networking after loading and continue navigating. For a durable offline copy, download the standalone artifact and open its `index.html` directly.
- Confirm server credentials and private archives are not in the HTML. Local JSON imports are processed in-browser; a user can still explicitly choose to connect to a server.

`npm run build:demo` and `npm run test:demo` exercise this packaging locally under `/openbexi_timeline2.0/`. Browser evidence goes to ignored `artifacts/browser/`; it does not overwrite the documentation captures.

## Release Versus Demo

Linux Firefox verification runs with a virtual display so WebGL2 can use the
installed Mesa libraries. The verification image and CI install `libegl1`,
`libgl1`, `xauth`, and `xvfb`; `verify-candidate.py --matrix` wraps the matrix in
`xvfb-run -a`. For a manual headless-Linux run, use
`xvfb-run -a npm run test:matrix`. Windows Firefox remains headless. This follows
[Playwright's Linux CI setup](https://playwright.dev/docs/ci); canvas assertions
remain mandatory rather than being skipped when graphics initialization fails.

A green static-demo build is not a full Python/API or production release certificate. The separate [Candidate Verification workflow](../../../.github/workflows/verify.yml), [release checklist](release-checklist.md), [implementation status](implementation-status.md), and platform evidence retain their independent scope. The owner-directed `1.0.0` publication does not require those qualification gates and does not claim they passed.

## Repository Controls

Private vulnerability reporting was enabled and read back from GitHub for the old repository. Settings for the new repository must be read separately before claiming they are active. Weekly dependency updates are configured in `.github/dependabot.yml` for npm, uv, GitHub Actions, and Docker. No automatic merging is configured. Dependabot's supported uv version may lag the developer tool version; review any lockfile update failures instead of bypassing the lock.

The checked-in branch policy can be applied to `master` for subsequent development. It is not required for the owner-directed `1.0.0` publication:

```sh
uv run python scripts/configure-github.py --protection --apply
```

It requires the `Candidate checks` and `Standalone demo checks` aggregate jobs, including for administrators. Force-pushes and branch deletion are disabled. Linear history and conversation resolution are required; an additional human reviewer is not mandatory for this single-maintainer repository. Each aggregate fails if its required jobs fail, cancel, or skip. Repository settings are read back after applying them.

This policy was applied and read-back verified on the old repository after its first push on September
14, 2026. Where that policy is enabled, changes must pass its required checks before merging. Owner
approval variables can be configured with the same credential-safe helper:

```sh
uv run python scripts/configure-github.py --approve-demo --publication-approved --apply
uv run python scripts/configure-github.py --approve-preview --publication-approved --apply
```

These flags authorize publication only. They neither skip CI nor mark a preview
production-ready. The helper uses GitHub's [repository variables API](https://docs.github.com/en/rest/actions/variables).

The helper uses an existing Git credential or `GH_TOKEN`/`GITHUB_TOKEN` in memory, never writes it to a file, and refuses credential-bearing redirects. Without `--apply`, it only prints the intended policy. It does not push code, select a license, or invent publication approval.

## Historical Preview Packaging Workflow

This separate workflow publishes preview tags only. It is not used to publish stable version `1.0.0`. The example below belongs to the earlier `0.1.0` source revision; for a future preview, use a tag and release-notes filename matching that revision's package version.

```sh
npm run build:demo
npm run test:demo
uv run python scripts/package-preview.py --tag v0.1.0-preview.1 --publication-approved
```

The ZIP uses fixed metadata and sorted files for reproducibility. It includes the complete HTML, the project `LICENSE` and `NOTICE`, third-party notices, offline instructions, and release notes. The manifest takes its license identifier from `package.json`. `SHA256SUMS` covers the ZIP and the commit-linked `release-manifest.json`. A stale HTML/build-manifest mismatch fails packaging. `ownerPublicationApproved` records redistribution authorization; `releaseApproved` remains false because the preview is not production/G0-G5 certification. The matching tagged source is available beside release downloads in GitHub's Source code archives.

The owner's [licensing/data approval](../../data-licensing.md) covers the recorded preview material. When using the automated preview workflow, configure `PUBLIC_RELEASE_APPROVED=true` and the `preview-release` environment for preview tags; an additional manual approval can be enabled when desired. Push a reviewed `v<package-version>-preview.N` tag that matches the package version and release-notes filename. The [Preview Release workflow](../../../.github/workflows/preview-release.yml) runs the reusable full candidate matrix and standalone demo tests, then creates a GitHub **prerelease**, not a stable/latest release. Manual dispatch must select an existing preview tag.

The release workflow never runs from an unapproved tag or bypasses failed qualification checks. A locally generated ZIP is not proof of a published GitHub release. Approval flags are not test results; disable them if later content needs a renewed publication review.

## Measure Startup

```sh
npm run build:demo
npm run measure:demo -- --runs 3
```

The benchmark serves the real bundle with gzip under a project-site path and uses fresh browser contexts/cache-disabled requests. It records desktop and simulated 1.6 Mbps, 150 ms latency, 4x CPU mobile results, verifies nonblank canvas pixels, and captures screenshots. These are small-sample observations on the current machine, not percentile certification or real-device measurements.

After Pages is actually deployed, use `npm run measure:demo -- --hosted --runs 3` for the real URL. It fails on a non-200 response instead of recording a 404 page as a fast application load. Results stay in ignored `artifacts/performance/` and do not rewrite reviewed README screenshots.
