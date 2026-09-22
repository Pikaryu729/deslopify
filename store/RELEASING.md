# Releasing

One ritual, two one-time setups.

## The ritual (after setup)

```bash
npm version patch          # or minor / major — package.json is the only version
npm run verify             # optional locally; CI runs it anyway
git push --follow-tags     # pushes the commit and the vX.Y.Z tag
```

Pushing the tag runs `.github/workflows/release.yml`, which:

1. runs the **same** pipeline a normal push runs (build, Mozilla lint, unit/DOM/e2e tests, both packages) — it calls
   `verify.yml` rather than duplicating it, so a release can never test something different from a commit;
2. refuses to continue if the tag disagrees with `package.json` (the stores would otherwise get a package nobody asked
   for);
3. creates the GitHub release with both store zips and the source archive attached;
4. uploads the new package to the Chrome Web Store and submits it for review;
5. signs and submits the new version to addons.mozilla.org for review.

Nothing is published if the secrets are missing: the workflow goes green and annotates what to set up. You can rehearse
the whole thing from **Actions → release → Run workflow** with *publish* left off — that builds, tests, and packages
without touching either store.

**The version must increase for every release.** Both stores reject an upload whose manifest version is not higher than
the published one, and `npm version` is what keeps `package.json`, the tag, and both manifests in step.

---

## One-time setup A — Chrome Web Store

The item must already exist (i.e. you have published v0.1.0 through the dashboard once). The API can only upload *new
versions* to an existing item; it cannot create one.

### 1. Enable the API and create a service account

1. <https://console.developers.google.com> → create or pick a project.
2. Search for **Chrome Web Store API** and **Enable** it.
3. <https://console.cloud.google.com/iam-admin/serviceaccounts> → **Create service account**. No project roles needed.
4. Open it → **Keys** → **Add key** → **Create new key** → **JSON** → download it.

### 2. Link the service account to your publisher account

In the [Developer Dashboard](https://chrome.google.com/webstore/devconsole/) → **Account** → add the service account's
email address. **This step is the one people miss**, and skipping it produces `Not a valid developer` from the API
rather than anything useful.

### 3. Collect three values

| Secret | Where |
| --- | --- |
| `CHROME_SERVICE_ACCOUNT_KEY` | the whole contents of the JSON key file |
| `CHROME_PUBLISHER_ID` | Dashboard → **Publisher → Settings** → Publisher ID |
| `CHROME_EXTENSION_ID` | the 32-character ID in your item's store URL |

```bash
gh secret set CHROME_SERVICE_ACCOUNT_KEY < ~/Downloads/your-key.json
gh secret set CHROME_PUBLISHER_ID --body "..."
gh secret set CHROME_EXTENSION_ID --body "..."
```

### Why a service account and not the OAuth flow

The older documented path (OAuth consent screen → OAuth Playground → refresh token) works, but refresh tokens issued
while the consent screen is in **Testing** expire after **7 days**. That is the classic "my store pipeline worked last
week and now it 401s" failure. Service accounts have no such cliff, and Google now documents them for CI. If you do use
OAuth instead, move the app out of Testing (or accept re-issuing a token every week).

---

## One-time setup B — addons.mozilla.org

1. The add-on must already exist on AMO (submit it once through the web UI).
2. <https://addons.mozilla.org/developers/addon/api/key/> → generate **JWT issuer** and **JWT secret**.

```bash
gh secret set AMO_JWT_ISSUER --body "..."
gh secret set AMO_JWT_SECRET --body "..."
```

`web-ext sign --channel=listed` submits a new version for review and, with `--approval-timeout=0`, returns immediately
instead of holding the job open for days. The workflow also attaches `deslopify-source.zip` via `--upload-source-code`,
because a bundle produced by esbuild counts as generated code and AMO reviewers may ask for readable source.

Prefer to keep the Firefox version private (self-distributed, no listing)? Change `--channel=listed` to
`unlisted` in the workflow: you get a signed `.xpi` artifact without review, and you distribute it yourself.

---

## Checklist before tagging

- [ ] `npm version patch` — never hand-edit a version.
- [ ] `git status` clean; CI green on `main`.
- [ ] Changelog-worthy things are in the commit message; `--generate-notes` turns PRs and commits into release notes.
- [ ] You have actually run the build against your own logged-in feed at least once since the last behaviour change.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Not a valid developer` (Chrome) | Service account email not added in the Dashboard **Account** section |
| Upload fails, `state: FAILED` | Manifest version not higher than the published one — `npm version patch`, re-tag |
| Upload returns `UPLOAD_IN_PROGRESS` forever | The workflow polls `fetchStatus` 20×; check the dashboard's *Package* tab for the real state |
| `403` from the release job | Repo workflow permissions: *Settings → Actions → General → Workflow permissions* must allow write (the workflow asks for `contents: write`) |
| Firefox job fails on `--channel=listed` | The add-on does not exist on AMO yet; submit v0.1.0 through the web UI first |
| Chrome publish rejected for visibility | Publish once manually with your chosen visibility; the API publishes with existing settings |
| Everything is skipped with a notice | Expected: the secrets are not set yet |
