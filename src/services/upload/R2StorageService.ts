import {
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getR2Client } from '../../lib/r2';

export class R2StorageService {
  private bucketName: string;
  private publicBaseUrl: string;

  constructor() {
    this.bucketName = process.env.R2_BUCKET_NAME || '';
    if (!this.bucketName) {
      throw new Error('[R2StorageService] R2_BUCKET_NAME is not configured');
    }

    const devUrl = process.env.NEXT_PUBLIC_R2_DEV_URL || '';
    if (!devUrl) {
      throw new Error('[R2StorageService] NEXT_PUBLIC_R2_DEV_URL is not configured');
    }
    this.publicBaseUrl = devUrl.endsWith('/') ? devUrl.slice(0, -1) : devUrl;
  }

  /**
   * Generates a pre-signed URL for direct-to-S3 uploads.
   * Client can make a PUT request to this URL.
   *
   * @param key The destination key (e.g., 'pending/user1_abc.jpg')
   * @param contentType The exact MIME type the client will upload (must match client's Content-Type header)
   * @param maxSizeBytes (Optional) if you want to limit size, though R2 presigned URLs don't strictly enforce Content-Length-Range natively without POST policies. It's often handled client-side or during verify.
   */
  public async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    maxSizeBytes?: number,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
      // If we wanted to enforce length strictly in PUT, AWS SDK v3 has limited support for ContentLength in presign PUT.
      // Usually, POST policies are used for strict size limits. We will validate on verify or rely on Cloudflare rules.
    });

    // 15 minutes expiration
    const url = await getSignedUrl(getR2Client(), command, { expiresIn: 900 });
    return url;
  }

  /**
   * Fetches the first N bytes of an object.
   * Used for Magic Bytes validation without downloading the whole file.
   */
  public async getObjectHead(key: string, rangeBytes: number): Promise<Uint8Array> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Range: `bytes=0-${rangeBytes - 1}`,
      });

      const response = await getR2Client().send(command);
      
      if (!response.Body) {
        throw new Error('No body returned from R2');
      }

      const arrayBuffer = await response.Body.transformToByteArray();
      return arrayBuffer;
    } catch (err: any) {
      // If eventual consistency causes an issue where file isn't immediately available,
      // we could add a small retry delay here.
      console.error(`[R2StorageService] Failed to getObjectHead for ${key}:`, err);
      throw err;
    }
  }

  /**
   * Copies an object within the same bucket.
   */
  public async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    const command = new CopyObjectCommand({
      Bucket: this.bucketName,
      CopySource: `/${this.bucketName}/${sourceKey}`,
      Key: destinationKey,
    });

    await getR2Client().send(command);
  }

  /**
   * Deletes an object.
   */
  public async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    await getR2Client().send(command);
  }

  /**
   * Checks if an object exists by doing a HeadObject request.
   */
  public async objectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await getR2Client().send(command);
      return true;
    } catch (err: any) {
      if (err.name === 'NotFound') return false;
      throw err;
    }
  }

  /**
   * Returns the public URL for a given key.
   */
  public getPublicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  /**
   * Extracts the key from a public URL.
   * Useful for cleanup operations (extracting key from old avatar_url to delete it).
   */
  public extractKeyFromPublicUrl(publicUrl: string): string | null {
    try {
      const knownPrefixes = [
        this.publicBaseUrl,
        'https://img.rasyadazizan.site',
        'https://pub-a5593a1c76374ad6bcfeed25f8cd6e01.r2.dev',
      ].filter(Boolean) as string[];

      for (const prefix of knownPrefixes) {
        const baseUrl = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
        if (publicUrl.startsWith(baseUrl)) {
          const key = publicUrl.slice(baseUrl.length + 1); // +1 for the "/"
          if (key && !key.includes('..')) {
            return key;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}
