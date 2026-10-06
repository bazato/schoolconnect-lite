# Render free-tier trial (30 days, synthetic data only)

> Historical trial instructions. The current backend requires Kafka, an Authorization service and a Read Model database/service, and no longer contains the standalone worker. The existing `render.yaml` does not provision a broker and must not be used for this revision without redesign and verification.

This is a disposable demo deployment, not the production architecture. `render.yaml` provisions **one Free web service** and **one Free Render Postgres instance**. The web service hosts the existing API, seven internal NestJS services, and the outbox worker in one Node.js process. Internal services bind to loopback. They remain separate code modules and databases, but no longer have independent runtime isolation in this trial. The single Postgres instance contains seven separate logical databases, one per service, using one Render database user.

## Deploy

1. Push this repository to GitHub. In the Render Dashboard choose **New → Blueprint**, connect `bazato/schoolconnect-lite`, and use the root `render.yaml`. Review the proposed resources before applying: both compute plans must say **Free**. Stop if Render asks you to select a paid plan or add a chargeable resource.
2. The first boot creates the seven logical databases, applies versioned SQL migrations, and inserts only the synthetic development seed. Later boots skip completed migration segments. Never import the local PostgreSQL data or real school/child records into this trial.
3. Wait until the service's `/api/v1/health/ready` endpoint returns `status: ok`. Use the actual `onrender.com` hostname shown in Render; do not assume a hostname from the resource name.
4. Set the local mobile development environment's `EXPO_PUBLIC_API_URL` to `https://<actual-render-host>/api/v1`, then run `./scripts/start-remote-mobile.ps1` in PowerShell and scan its temporary Expo Go QR code. Do not commit this machine-specific `.env`. The mobile app itself is not hosted by Render; the Expo tunnel works only while the development computer and Metro process are running. An installable build is separate work.

Synthetic test accounts: owner `+919876543200` with invitation `OWNER-INVITE`, parent `+919876543210` with `PARENT-INVITE`, and teacher `+919876543211` with `TEACHER-INVITE`. The fixed mock OTP is `123456`. After first activation, invitation codes are left blank. Never enter real data: anyone who has a known test number and the mock OTP can sign in.

## Accepted limitations

- Render's Free Postgres instance expires after 30 days, has 1 GB storage, and has no backups. Export anything you want to keep before expiry; this deployment is intentionally disposable.
- The Free web service sleeps after 15 minutes without inbound traffic. The next request can take about a minute to wake it. The outbox worker and scheduled jobs only run while the service is awake, though queued work can resume after wake-up.
- No S3-compatible private object store is configured. Attachment upload and private preview are unavailable; do not use a localhost presigned URL from a phone.
- One 512 MB/0.1 CPU web instance is for light testing, not a 100-user concurrency target or production traffic. The one-process runtime is a trial-only concession. Production should return to separate services and independent database credentials.
- The generated authentication and internal-service secrets remain in Render environment variables. The `render.yaml` must not contain literal secrets.

The local code check is `node --test scripts/render-demo-db.test.mjs`. A full end-to-end check requires an actual Render account and the newly provisioned database; passing the code check alone does not mean the cloud deployment is live.
