# Temporary remote mobile trial

This trial uses the Windows Docker host, not a cloud VM. When started, it runs a separate `schoolconnect-remote-demo` Compose project with its own PostgreSQL volume and only synthetic accounts/data. The existing local `schoolconnect-postgres` database is not connected to either public tunnel.

The setup uses two account-less Cloudflare Quick Tunnels over HTTP/2: one forwards the loopback-only API gateway on port 3000, and one forwards Expo Metro on port 8081. The most recently used URLs are in the ignored `apps/mobile/.env`; retrieve replacements after a tunnel restart with `docker logs schoolconnect-remote-demo-tunnel-http2` and `docker logs schoolconnect-remote-demo-expo-tunnel-http2`. Update both URLs in that local file, then restart Expo with `scripts/start-remote-mobile.ps1`. The Expo proxy URL must be present in the **process environment before** Expo starts; the launcher handles that. The previous QUIC tunnels were stopped.

Open the `exp://` Metro URL in Expo Go on a phone with internet access. The app calls the separate HTTPS API URL. On physical iOS devices, Expo Go and the CLI must be signed in to the same Expo account; Android can be tested without this step. The computer, Docker Desktop, both tunnel containers and Metro must remain running. Quick Tunnel hostnames can change after restart and have no uptime guarantee.

This is **public synthetic-data testing only**. OTP is fixed to `123456`, and known sample invitations are in the repository. Never enter real school, child, parent or teacher information. The trial currently has no reachable S3-compatible object store, so private attachment upload/preview is not available; the Files service's metadata and health endpoints still run. Use a real private S3-compatible bucket and scanner before treating attachments as complete. This setup is not a production deployment or an app-store distribution.

To stop public access, stop the two exact tunnel containers:

```powershell
docker stop schoolconnect-remote-demo-tunnel-http2 schoolconnect-remote-demo-expo-tunnel-http2
```

The isolated trial services and volume are left intact so test data can be resumed. Do not run `docker compose down -v` unless you intend to remove that synthetic trial data.
