export const fileUploadPolicy = { maxByteSize: 20 * 1024 * 1024, mediaTypes: ['application/pdf', 'image/jpeg', 'image/png'] };
export function fileCapabilities(provider = process.env.FILE_STORAGE_PROVIDER) {
  return { attachmentsEnabled: provider !== 'disabled', ...fileUploadPolicy };
}
