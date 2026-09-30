# Oracle Cloud Always Free trial deployment

## Status — 2026-09-30

The OCI account has not been created yet, so nothing has been deployed to Oracle and there is no public URL. The user must complete Oracle's registration, payment/identity verification, home-region choice and terms in a regular browser. The in-app browser displays a blank Oracle signup form. Do not request card details, passwords, OTPs or private SSH keys in chat.

`infra/oracle/compose.yaml` is a trial-only, single-VM deployment of nine separate Node processes (gateway, seven service backends, workers) and PostgreSQL. PostgreSQL initializes seven independently owned databases and service-specific runtime credentials. The gateway binds to the VM loopback address only; PostgreSQL and internal services have no host-published ports. The Files service alone has outbound access for OCI Object Storage. This preserves process and database boundaries but **does not** provide independent compute scaling or host-level fault isolation.

Local verification used disposable Docker projects: database initialization without seeds; per-service table access and denial of cross-database `CONNECT`; synthetic demo seed; current backend image build; API `/api/v1/health/ready` returning healthy for all seven services; and a worker container remaining running. The scratch projects and volumes were removed. This was an x86-64 local test, **not** an ARM, OCI, HTTPS, or private-upload test.

## Oracle account and resources

1. The owner signs up at [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) in Chrome or Edge, using their own details. Avoid creating multiple free accounts. Choose the home region deliberately; Always Free compute must run in that region. Registration usually needs phone and card verification. Do not switch to Pay As You Go or provision non-free resources just to complete this trial.
2. In the OCI Console, confirm availability of an **Always Free-eligible VM.Standard.A1.Flex** instance. The currently documented free tenancy allowance is 2 OCPUs and 12 GB memory in total. A 50 GB boot volume counts toward the 200 GB combined Always Free block-volume allowance. Capacity can be unavailable in the chosen home region and idle VMs can be reclaimed. Check the OCI resource's Always Free label and estimated cost before creation. [Oracle Always Free limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
3. Create a fresh SSH key for this VM, not the existing GitHub key. Allow SSH only from the owner's IP. Do not open PostgreSQL or service ports 3101–3107 to the internet. The Compose gateway publishes only to `127.0.0.1:3000` on the VM.
4. Create a **private** OCI Object Storage bucket and a restricted application identity/customer secret key for S3-compatible access. Keep the access key and secret out of Git and chat. OCI documents the path-style endpoint as `https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com`. The Files service requires this endpoint and credentials; presigned upload/download behavior still needs an actual bucket test. [Oracle S3 compatibility guide](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm).

## VM deployment (after account and resource provisioning)

Install Docker Engine and Compose from their official sources on an ARM64 Linux VM. Clone the private GitHub repository after the Oracle-specific files are committed and pushed. From the repository root:

```sh
cp infra/oracle/.env.example infra/oracle/.env
chmod 600 infra/oracle/.env
# Fill in unique 32+ character alphanumeric secrets, OCI bucket values and customer key.
docker build -t schoolconnect-backend:oci .
docker compose --env-file infra/oracle/.env -f infra/oracle/compose.yaml up -d
docker compose --env-file infra/oracle/.env -f infra/oracle/compose.yaml ps
curl -H 'x-forwarded-proto: https' http://127.0.0.1:3000/api/v1/health/ready
```

The `.env` file is ignored by Git. `SC_DEMO_SEED=false` is the default. Setting it to `true` initializes only synthetic owner/teacher/parent test records on a **fresh** database volume. It does not re-run on existing volumes. Mock OTP remains `123456`; Identity therefore runs in development mode, and Files uses the development-clean scanner. Neither is production-ready. Do not load real school, parent or student data on this trial stack.

The gateway intentionally has no public HTTPS ingress yet. Before mobile testing over the internet, choose a hostname and access control for the invited testers, configure a trusted TLS reverse proxy, and verify only the gateway is reachable. A fixed OTP plus known demo invitations must **not** be exposed to the public internet. The Expo app's API URL can then point to `https://<approved-host>/api/v1`, with `EXPO_PUBLIC_DEMO_MODE=false`. Native distribution is separate from backend hosting.

## Remaining deployment checks

- Confirm an Always Free A1 instance is available in the account's home region and the VM can build/run the ARM64 image within its memory and disk allowance.
- Verify an encrypted backup/restore procedure for the PostgreSQL volume; one VM is a single point of failure. Do not rely on the init scripts for updates to an existing database.
- Exercise the private OCI bucket with real presigned upload, promotion, and download; configure bucket CORS if a browser preview is used.
- Test an authorized synthetic Teacher publication, Parent timeline visibility, worker notification fan-out, and school isolation through the restricted HTTPS endpoint.
- Replace mock OTP and development-clean scanning before any genuine school data or open public access.
