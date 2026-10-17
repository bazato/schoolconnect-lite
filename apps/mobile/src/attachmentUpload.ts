import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { mobileApi, type MobileSession } from './api';

export type FileCapabilities = { attachmentsEnabled: boolean; maxByteSize: number; maxStoredByteSize?:number;mediaTypes: string[] };
export const attachmentsDisabledMessage = 'Document uploads are currently disabled on the server or the secure scanner is unavailable. Your draft is kept; please try again later.';
const pending=new Map<string,{fileId:string;uploadSessionId:string;started:number}>();
export function clearPendingAttachmentUploads(){pending.clear();}

export function attachmentErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'FILE_ATTACHMENTS_DISABLED') return attachmentsDisabledMessage;
  if (code === 'FILE_TOO_LARGE') return 'This file exceeds the server file-size limit. Choose a smaller file.';
  if (code === 'FILE_POLICY_REJECTED') return 'Choose a non-empty PDF, JPEG or PNG within the school file-size limit.';
  if (code === 'FILE_NOT_READY') return 'The file has not passed validation. It cannot be published yet.';
  if(code==='FILE_CANNOT_COMPRESS_TO_LIMIT')return 'This file could not be reduced below the secure scanning limit. Export a smaller PDF or image and try again. Your draft is kept.';
  if(code==='FILE_SIGNED_PDF_TOO_LARGE')return 'This signed PDF is too large to scan. We cannot compress it without invalidating its signature. Ask for a smaller signed copy.';
  if(/FILE_COMPRESSION_FAILED|FILE_IMAGE_DIMENSIONS_EXCEEDED|FILE_PDF_TOO_MANY_PAGES/.test(code))return 'This document could not be safely optimized. Choose a smaller PDF or image. Your draft is kept.';
  if (code === 'FILE_REJECTED') return 'This file failed the security or file-content checks. Choose another PDF, JPEG or PNG.';
  if (code === 'FILE_STORAGE_QUOTA_EXCEEDED') return 'The school document-storage limit has been reached. Contact your administrator.';
  if (/FILE_PROCESSING_BUSY|FILE_PROCESSING_UNAVAILABLE|FILE_SCANNER_UNAVAILABLE/.test(code)) return 'Secure file checking is busy or unavailable. Your draft is safe. Tap retry to finish checking the upload.';
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
  // Retain only identifiers, not signed URLs or document bytes; same-process retries resume completion.
  const key=[session.user.id,session.activeMembershipId ?? session.accessToken,asset.uri,checksumSha256].join('|');
  for(const [id,value] of pending)if(Date.now()-value.started>86400000)pending.delete(id);
  let upload=pending.get(key);
  if(!upload){
    const created = await mobileApi.createFileUpload(session, { ownerId: Crypto.randomUUID(), fileName: asset.name, mediaType, byteSize: bytes.length, checksumSha256 });
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
    let uploaded:Response;
    try{uploaded=await expoFetch(created.upload.url,{method:'PUT',headers:created.upload.requiredHeaders,body:bytes,signal:controller.signal});}finally{clearTimeout(timer);}
    if (!uploaded.ok) throw new Error(`UPLOAD_HTTP_${uploaded.status}`);
    upload={fileId:created.fileId,uploadSessionId:created.uploadSessionId,started:Date.now()};
    if(pending.size>=20)pending.delete(pending.keys().next().value!);pending.set(key,upload);
  }
  try{
    const completed=await mobileApi.completeFileUpload(session,upload.uploadSessionId);
    if(completed.status!=='READY'||completed.fileId!==upload.fileId)throw new Error('FILE_NOT_READY');
    pending.delete(key);return {fileId:completed.fileId,metadata:{name:asset.name,byteSize:completed.byteSize??bytes.length}};
  }catch(error){if(error instanceof Error && /FILE_REJECTED|UPLOAD_SESSION_NOT_FOUND_OR_EXPIRED|FILE_CANNOT_COMPRESS_TO_LIMIT|FILE_SIGNED_PDF_TOO_LARGE|FILE_COMPRESSION_FAILED|FILE_IMAGE_DIMENSIONS_EXCEEDED|FILE_PDF_TOO_MANY_PAGES|FILE_TOO_LARGE/.test(error.message))pending.delete(key);throw error;}
}
