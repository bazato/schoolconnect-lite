// Decimal MB. Leave room below a provider's 3.5 MB limit, including request overhead.
export const fileUploadPolicy = { maxByteSize: 5_000_000, maxStoredByteSize:3_400_000,mediaTypes: ['application/pdf', 'image/jpeg', 'image/png'] };
export function fileCapabilities(provider = process.env.FILE_STORAGE_PROVIDER) {
  const scanner=process.env.FILE_SCANNER_PROVIDER ?? (process.env.NODE_ENV==='production'?'':'development-clean');
  const enabled=provider==='s3' && (['clamd','clamav-http','cloudmersive'].includes(scanner) || (process.env.NODE_ENV!=='production'&&scanner==='development-clean'));
  return { attachmentsEnabled: enabled, ...fileUploadPolicy };
}
