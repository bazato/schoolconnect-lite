type Application = { close(): Promise<void> };
type Owner = { onModuleDestroy(): Promise<void> };
const applications = new Set<Application>();
const gateways = new Set<Application>();
const drains = new Set<() => Promise<void>>();
let registered = false;
let shuttingDown: Promise<void> | undefined;

export function registerApplicationShutdown(app: Application, gateway = false) {
  applications.add(app);
  if (gateway) gateways.add(app);
  if (registered) return;
  registered = true;
  const stop = () => { void shutdownApplications().catch(() => { console.error('APPLICATION_SHUTDOWN_FAILED'); process.exitCode=1; }); };
  process.once('SIGTERM',stop); process.once('SIGINT',stop);
}
export function bindEventingShutdown(owner: Owner, ...stops: Array<() => Promise<void>>) {
  const closeDatabase = owner.onModuleDestroy.bind(owner);
  let drained: Promise<void> | undefined;
  const drain=() => drained ??= Promise.all(stops.map((stop) => stop())).then(() => undefined);
  drains.add(drain);
  owner.onModuleDestroy = async () => {
    // Drain Kafka before Nest destroys the service-owned PostgreSQL pool.
    await drain();
    await closeDatabase();
  };
}
export function shutdownApplications() {
  shuttingDown ??= (async () => {
    // Gateway requests can still use internal services while they finish.
    await Promise.all([...gateways].map((app) => app.close()));
    // Legacy consumer lookups can still use every internal HTTP/DB boundary.
    await Promise.all([...drains].map((drain) => drain()));
    await Promise.all([...applications].filter((app) => !gateways.has(app)).map((app) => app.close()));
    applications.clear();gateways.clear();drains.clear();
  })();
  return shuttingDown;
}
