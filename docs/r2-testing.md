# R2 connectivity acceptance test

Creating a bucket, storing credentials in Render, and a green API health check do not prove that files can be uploaded to R2. The current Files health check tests its database, not object storage. Genuine production malware scanning is still unimplemented; do not enable uploads or substitute the development no-op scanner in production.

## Run without posting credentials

The local, Git-ignored `.env.r2-test` contains the agreed bucket, endpoint and region. Enter the R2 Access Key ID and Secret Access Key in that file using the editor. Restrict the Cloudflare token to Object Read & Write on this bucket only. Never commit or share this file. Leave runtime and scanner settings unchanged.

From `C:\Documents\schoolapp`:

```powershell
node scripts/r2-smoke-test.mjs --check
node scripts/r2-smoke-test.mjs --run
```

`--check` makes no network requests. `--run` uploads one tiny synthetic PNG, checks its size and SHA-256 by downloading it, copies it to a second test key, verifies signed download bytes, checks unsigned S3 access is rejected, and deletes only these two test objects. There are no database writes and no changes to existing documents or bucket settings. This incurs a small number of normal R2 operations against the account's allowance.

The test prints safe pass/fail codes, never keys or signed URLs. If cleanup fails, it prints the exact unique test prefix for manual cleanup. It uses only `__nexqon_r2_smoke__/<fresh-random-UUID>/quarantine.png` and `private.png`.

This tests the S3 data path only, not malware protection, school/guardian authorization, browser CORS, r2.dev/custom-domain exposure, billing limits, or live application's environment configuration. Those need separate verification before release. A rejected unsigned S3 request alone does not prove r2.dev is disabled.

Credentials currently saved only in Render cannot be used by the local runner. The current connector has no remote command execution or secret-read tool; do not expose credentials in logs to work around that. The live API remains on its existing demo launcher. No deployment or runtime configuration change is required for this isolated test.

Test the smoke-test harness locally (fake storage/HTTP, not real R2):

```powershell
node --test scripts/r2-smoke-test.test.mjs
pnpm --filter @schoolconnect/files test
```
