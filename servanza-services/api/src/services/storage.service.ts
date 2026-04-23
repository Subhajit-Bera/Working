import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { prisma } from '../config/database';
import crypto from 'crypto';

interface DocumentUploadResult {
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
}

// interface BuddyDocument {
//   url: string;
//   fileName: string;
//   uploadedAt: string;
//   verified: boolean;
//   verifiedAt: string | null;
//   fileSize: number;
//   mimeType: string;
// }

// Updated document types to match frontend requirements
type DocumentType = 'aadhaarFront' | 'aadhaarBack' | 'pan' | 'bankDocument' | 'profileImage';

export class StorageService {
  private s3Client: S3Client;
  private bucketName: string;
  private publicUrl: string;

  // Allowed file types for buddy documents
  private readonly ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
    'image/jpg',
  ];

  // Max file size: 10MB
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024;

  constructor() {
    try {
      // Cloudflare R2 Configuration
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      const accessKeyId = process.env.R2_ACCESS_KEY_ID;
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
      this.bucketName = process.env.R2_BUCKET_NAME || 'servanza-documents';
      this.publicUrl = process.env.R2_PUBLIC_URL || `https://${this.bucketName}.r2.cloudflarestorage.com`;

      if (!accountId || !accessKeyId || !secretAccessKey) {
        throw new Error('R2 credentials not configured');
      }

      // Initialize S3 Client for Cloudflare R2
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });

      logger.info('Cloudflare R2 Storage initialized successfully');
      logger.info(`R2 Bucket: ${this.bucketName}`);
    } catch (error) {
      logger.error('Failed to initialize R2 Storage:', error);
      throw new ApiError(500, 'Storage service unavailable');
    }
  }

  /**
   * Upload buddy document to Cloudflare R2
   * Updated to support new document types
   */
  async uploadBuddyDocument(
    buddyId: string,
    documentType: DocumentType,
    file: Express.Multer.File
  ): Promise<DocumentUploadResult> {
    try {
      // Validate file
      this.validateFile(file);

      // Determine category for better organization
      const category = this.getCategoryForDocumentType(documentType);

      // Generate unique filename
      const fileExtension = file.originalname.split('.').pop();
      const uniqueFileName = `buddies/${buddyId}/${category}/${documentType}/${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;

      // Upload to R2
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: uniqueFileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          buddyId,
          documentType,
          category,
          uploadedAt: new Date().toISOString(),
          originalName: file.originalname,
        },
      });

      await this.s3Client.send(command);

      // Construct public URL
      const publicUrl = `${this.publicUrl}/${uniqueFileName}`;

      logger.info(`Document uploaded successfully for buddy ${buddyId}: ${documentType}`);

      return {
        url: publicUrl,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        uploadedAt: new Date(),
      };
    } catch (error) {
      logger.error(`Failed to upload document for buddy ${buddyId}:`, error);
      throw new ApiError(500, 'Failed to upload document');
    }
  }

  /**
   * Get category for document type
   */
  private getCategoryForDocumentType(documentType: DocumentType): string {
    if (documentType === 'profileImage') {
      return 'profile';
    } else if (documentType === 'bankDocument') {
      return 'bank';
    } else {
      return 'identity';
    }
  }

  /**
   * Update buddy documents in database
   * Updated to use new 'documents' field and store only URL
   * Also resets verification status when a document is re-uploaded
   */
  async updateBuddyDocuments(
    buddyId: string,
    documentType: Exclude<DocumentType, 'profileImage'>,
    uploadResult: DocumentUploadResult
  ): Promise<void> {
    try {
      // Get current buddy data
      const buddy = await prisma.buddy.findUnique({
        where: { id: buddyId },
        select: { documents: true },
      });

      if (!buddy) {
        throw new ApiError(404, 'Buddy not found');
      }

      // Parse existing documents
      const documents = (buddy.documents as any) || {};

      // Delete old document from R2 if exists
      if (documents[documentType]) {
        await this.deleteDocumentByUrl(documents[documentType]).catch(err => {
          logger.warn(`Failed to delete old document: ${err.message}`);
        });
      }

      // Update document - store only URL as per frontend expectation
      documents[documentType] = uploadResult.url;

      // Save to database
      await prisma.buddy.update({
        where: { id: buddyId },
        data: {
          documents: documents,
        },
      });

      // Reset verification status for this document type
      // This clears the verified flag and comment when a document is re-uploaded
      await this.resetDocumentVerification(buddyId, documentType);

      logger.info(`Buddy documents updated in database: ${buddyId} - ${documentType}`);
    } catch (error) {
      logger.error(`Failed to update buddy documents in database:`, error);
      throw error;
    }
  }

  /**
   * Reset verification status when a document is re-uploaded
   */
  private async resetDocumentVerification(
    buddyId: string,
    documentType: Exclude<DocumentType, 'profileImage'>
  ): Promise<void> {
    try {
      // Map document type to verification fields
      const fieldMap: Record<string, { verified: string; comment: string }> = {
        aadhaarFront: { verified: 'aadhaarFrontVerified', comment: 'aadhaarFrontComment' },
        aadhaarBack: { verified: 'aadhaarBackVerified', comment: 'aadhaarBackComment' },
        pan: { verified: 'panVerified', comment: 'panComment' },
        bankDocument: { verified: 'bankDetailsVerified', comment: 'bankDetailsComment' },
      };

      const fields = fieldMap[documentType];
      if (!fields) return;

      // Check if verification record exists
      const verification = await prisma.buddyVerification.findUnique({
        where: { buddyId },
      });

      if (verification) {
        // Reset the verification status and clear the comment
        await prisma.buddyVerification.update({
          where: { buddyId },
          data: {
            [fields.verified]: false,
            [fields.comment]: null,
          },
        });
        logger.info(`Reset verification for ${documentType} for buddy ${buddyId}`);
      }
    } catch (error) {
      logger.warn(`Failed to reset verification for ${documentType}:`, error);
      // Don't throw - this is not critical, just log
    }
  }

  /**
   * Upload profile image and update user record
   */
  async uploadProfileImage(
    buddyId: string,
    file: Express.Multer.File
  ): Promise<string> {
    try {
      // Validate file
      this.validateFile(file);

      // Generate unique filename
      const fileExtension = file.originalname.split('.').pop();
      const uniqueFileName = `buddies/${buddyId}/profile/${crypto.randomBytes(16).toString('hex')}.${fileExtension}`;

      // Upload to R2
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: uniqueFileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          buddyId,
          type: 'profileImage',
          uploadedAt: new Date().toISOString(),
        },
      });

      await this.s3Client.send(command);

      // Construct public URL
      const publicUrl = `${this.publicUrl}/${uniqueFileName}`;

      // Update user profile image
      await prisma.user.update({
        where: { id: buddyId },
        data: { profileImage: publicUrl },
      });

      logger.info(`Profile image uploaded for buddy ${buddyId}`);

      return publicUrl;
    } catch (error) {
      logger.error(`Failed to upload profile image:`, error);
      throw new ApiError(500, 'Failed to upload profile image');
    }
  }

  /**
   * Delete document from R2 by URL
   */
  private async deleteDocumentByUrl(fileUrl: string): Promise<void> {
    try {
      // Extract key from URL
      const url = new URL(fileUrl);
      const key = url.pathname.substring(1); // Remove leading slash

      await this.deleteDocument(key);
    } catch (error) {
      logger.error('Failed to delete document by URL:', error);
      throw error;
    }
  }

  /**
   * Delete document from Cloudflare R2
   */
  async deleteDocument(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);

      logger.info(`Document deleted from R2: ${key}`);
    } catch (error) {
      logger.error('Failed to delete document:', error);
      // Don't throw error, just log it
    }
  }

  /**
   * Verify buddy document (admin function)
   */
  async verifyBuddyDocument(
    buddyId: string,
    documentType: Exclude<DocumentType, 'profileImage'>
  ): Promise<void> {
    try {
      const buddy = await prisma.buddy.findUnique({
        where: { id: buddyId },
        select: { documents: true, documentsJson: true },
      });

      if (!buddy) {
        throw new ApiError(404, 'Buddy not found');
      }

      // Check both new and legacy document fields
      const documents = (buddy.documents as any) || {};
      const legacyDocs = (buddy.documentsJson as any) || {};

      if (!documents[documentType] && !legacyDocs[documentType]) {
        throw new ApiError(404, 'Document not found');
      }

      // For legacy support, update documentsJson if it exists
      if (legacyDocs[documentType]) {
        legacyDocs[documentType].verified = true;
        legacyDocs[documentType].verifiedAt = new Date().toISOString();

        await prisma.buddy.update({
          where: { id: buddyId },
          data: {
            documentsJson: legacyDocs,
          },
        });
      }

      // Check if all required documents are verified (for legacy system)
      const allVerified =
        legacyDocs.aadhaar?.verified &&
        legacyDocs.pan?.verified;

      if (allVerified) {
        await prisma.buddy.update({
          where: { id: buddyId },
          data: {
            isVerified: true,
            verifiedAt: new Date(),
          },
        });
        logger.info(`Buddy ${buddyId} is now fully verified`);
      }

      logger.info(`Document verified: ${buddyId} - ${documentType}`);
    } catch (error) {
      logger.error('Failed to verify document:', error);
      throw error;
    }
  }

  /**
   * Get buddy documents
   */
  async getBuddyDocuments(buddyId: string): Promise<Record<string, any>> {
    try {
      const buddy = await prisma.buddy.findUnique({
        where: { id: buddyId },
        select: {
          documents: true,
          documentsJson: true, // For backward compatibility
        },
      });

      if (!buddy) {
        throw new ApiError(404, 'Buddy not found');
      }

      // Return new documents field, fallback to legacy if needed
      return (buddy.documents as any) || (buddy.documentsJson as any) || {};
    } catch (error) {
      logger.error('Failed to get buddy documents:', error);
      throw error;
    }
  }

  /**
   * Validate uploaded file
   */
  private validateFile(file: Express.Multer.File): void {
    // Check file size
    if (file.size > this.MAX_FILE_SIZE) {
      throw new ApiError(400, `File size exceeds maximum limit of ${this.MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    // Check mime type
    if (!this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new ApiError(400, 'Invalid file type. Allowed types: PDF, DOC, DOCX, PNG, JPEG, JPG');
    }
  }

  /**
   * Generate signed URL for private document access (R2 presigned URL)
   */
  async getSignedUrl(fileUrl: string, expiresIn: number = 3600): Promise<string> {
    try {
      // Extract key from URL
      const url = new URL(fileUrl);
      const key = url.pathname.substring(1);

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn,
      });

      return signedUrl;
    } catch (error) {
      logger.error('Failed to generate signed URL:', error);
      throw new ApiError(500, 'Failed to generate signed URL');
    }
  }

  /**
   * Upload service or category image to Cloudflare R2
   * Generic method for uploading service images and category icons
   */
  async uploadServiceAsset(
    assetType: 'service' | 'category',
    entityId: string,
    file: Express.Multer.File
  ): Promise<string> {
    try {
      // Validate file
      this.validateFile(file);

      // Generate unique filename
      const fileExtension = file.originalname.split('.').pop();
      const folder = assetType === 'service' ? 'services' : 'categories';
      const uniqueFileName = `${folder}/${entityId}/${crypto.randomBytes(8).toString('hex')}.${fileExtension}`;

      // Upload to R2
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: uniqueFileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          entityId,
          assetType,
          uploadedAt: new Date().toISOString(),
          originalName: file.originalname,
        },
      });

      await this.s3Client.send(command);

      // Construct public URL
      const publicUrl = `${this.publicUrl}/${uniqueFileName}`;

      logger.info(`${assetType} image uploaded successfully: ${entityId}`);

      return publicUrl;
    } catch (error) {
      logger.error(`Failed to upload ${assetType} image:`, error);
      throw new ApiError(500, `Failed to upload ${assetType} image`);
    }
  }
}