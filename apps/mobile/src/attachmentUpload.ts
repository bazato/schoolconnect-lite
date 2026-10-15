import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { mobileApi, type MobileSession } from './api';

export type FileCapabilities = { attachmentsEnabled: boolean; maxByteSize: number; mediaTypes: string[] };
export const attachmentsDisabledMessage = 'Document uploads are currently disabled on the server while secure file scanning is being completed. File-based results cannot be published yet. Your draft is kept.';

export function attachmentErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'FILE_ATTACHMENTS_DISABLED') return attachmentsDisabledMessage;
  if (code === 'FILE_TOO_LARGE') return 'This file exceeds the server file-size limit. Choose a smaller file.';
  if (code === 'FILE_POLICY_REJECTED') return 'Choose a non-empty PDF, JPEG or PNG within the school file-size limit.';
  if (code === 'FILE_NOT_READY') return 'The file has not passed validation. It cannot be published yet.';
  if (/Network request failed|Failed to fetch|SERVICE_UNAVAILABLE|AbortError/.test(code)) return 'Unable to reach the upload service. Your draft is safe; please retry when connected.';
  return 'The file could not be uploaded. Your draft is safe. Please retry or choose another file.';
}

export async function uploadPickedAttachment(session: MobileSession, asset: DocumentPickerAsset, capabilities: FileCapabilities) {
  if (capabilities.attachmentsEnabled !== true) throw new Error('FILE_ATTACHMENTS_DISABLED');
  if (!Number.isSafeInteger(capabilities.maxByteSize) || capabilities.maxByteSize < 1) throw new Error('FILE_POLICY_REJECTED');
  if (asset.size && asset.size > capabilities.maxByteSize) throw new Error('FILE_TOO_LARGE');
  const mediaType = asset.mimeType ?? '';
  if (!capabilities.mediaTypes.includes(mediaType)) throw new Error('FILE_POLICY_REJECTED');
  // React Native's Blob is not a browser Blob: arrayBuffer() is not available
  // consistently. Expo's native File.bytes() also handles cached picker URIs.
  const bytes = Platform.OS === 'web'
    ? new Uint8Array(await (asset.file ?? await (await expoFetch(asset.uri)).blob()).arrayBuffer())
    : await new File(asset.uri).bytes();
  if (!bytes.length) throw new Error('FILE_POLICY_REJECTED');
  if (bytes.length > capabilities.maxByteSize) throw new Error('FILE_TOO_LARGE');
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const checksumSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const created = await mobileApi.createFileUpload(session, { ownerId: Crypto.randomUUID(), fileName: asset.name, mediaType, byteSize: bytes.length, checksumSha256 });
  const uploaded = await expoFetch(created.upload.url, { method: 'PUT', headers: created.upload.requiredHeaders, body: bytes });
  if (!uploaded.ok) throw new Error(`UPLOAD_HTTP_${uploaded.status}`);
  const completed = await mobileApi.completeFileUpload(session, created.uploadSessionId);
  if (completed.status !== 'READY' || completed.fileId !== created.fileId) throw new Error('FILE_NOT_READY');
  return { fileId: completed.fileId, metadata: { name: asset.name, byteSize: bytes.length } };
}
