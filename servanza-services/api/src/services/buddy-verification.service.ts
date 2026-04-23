import { prisma } from '../config/database';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';

export type VerificationField =
  | 'aadhaarFront'
  | 'aadhaarBack'
  | 'pan'
  | 'bankDetails'
  | 'emergencyContact';

export interface VerificationStatus {
  aadhaarFront: { verified: boolean; comment: string | null };
  aadhaarBack: { verified: boolean; comment: string | null };
  pan: { verified: boolean; comment: string | null };
  bankDetails: { verified: boolean; comment: string | null };
  emergencyContact: { verified: boolean; comment: string | null };
  allVerified: boolean;
}

export class BuddyVerificationService {
  /**
   * Get or create verification record for buddy
   */
  async getOrCreateVerification(buddyId: string) {
    let verification = await prisma.buddyVerification.findUnique({
      where: { buddyId },
    });

    if (!verification) {
      verification = await prisma.buddyVerification.create({
        data: { buddyId },
      });
      logger.info(`Created verification record for buddy ${buddyId}`);
    }

    return verification;
  }

  /**
   * Get verification status for a buddy
   */
  async getVerificationStatus(buddyId: string): Promise<VerificationStatus> {
    const verification = await this.getOrCreateVerification(buddyId);

    const status: VerificationStatus = {
      aadhaarFront: {
        verified: verification.aadhaarFrontVerified,
        comment: verification.aadhaarFrontComment,
      },
      aadhaarBack: {
        verified: verification.aadhaarBackVerified,
        comment: verification.aadhaarBackComment,
      },
      pan: {
        verified: verification.panVerified,
        comment: verification.panComment,
      },
      bankDetails: {
        verified: verification.bankDetailsVerified,
        comment: verification.bankDetailsComment,
      },
      emergencyContact: {
        verified: verification.emergencyContactVerified,
        comment: verification.emergencyContactComment,
      },
      allVerified: false,
    };

    status.allVerified = this.checkAllVerified(verification);

    return status;
  }

  /**
   * Verify a specific field
   */
  async verifyField(
    buddyId: string,
    field: VerificationField,
    comment?: string
  ): Promise<void> {
    // const verification = await this.getOrCreateVerification(buddyId);

    const updateData: any = {};

    switch (field) {
      case 'aadhaarFront':
        updateData.aadhaarFrontVerified = true;
        if (comment) updateData.aadhaarFrontComment = null; // Clear comment on verify
        break;
      case 'aadhaarBack':
        updateData.aadhaarBackVerified = true;
        if (comment) updateData.aadhaarBackComment = null;
        break;
      case 'pan':
        updateData.panVerified = true;
        if (comment) updateData.panComment = null;
        break;
      case 'bankDetails':
        updateData.bankDetailsVerified = true;
        if (comment) updateData.bankDetailsComment = null;
        break;
      case 'emergencyContact':
        updateData.emergencyContactVerified = true;
        if (comment) updateData.emergencyContactComment = null;
        break;
      default:
        throw new ApiError(400, `Invalid verification field: ${field}`);
    }

    await prisma.buddyVerification.update({
      where: { buddyId },
      data: updateData,
    });

    logger.info(`Field ${field} verified for buddy ${buddyId}`);

    // Check if all fields are verified and update buddy.isVerified
    await this.checkAndUpdateBuddyVerification(buddyId);
  }

  /**
   * Reject a specific field with comment
   */
  async rejectField(
    buddyId: string,
    field: VerificationField,
    comment: string
  ): Promise<void> {
    if (!comment || comment.trim().length === 0) {
      throw new ApiError(400, 'Comment is required when rejecting a field');
    }

    // const verification = await this.getOrCreateVerification(buddyId);

    const updateData: any = {};

    switch (field) {
      case 'aadhaarFront':
        updateData.aadhaarFrontVerified = false;
        updateData.aadhaarFrontComment = comment;
        break;
      case 'aadhaarBack':
        updateData.aadhaarBackVerified = false;
        updateData.aadhaarBackComment = comment;
        break;
      case 'pan':
        updateData.panVerified = false;
        updateData.panComment = comment;
        break;
      case 'bankDetails':
        updateData.bankDetailsVerified = false;
        updateData.bankDetailsComment = comment;
        break;
      case 'emergencyContact':
        updateData.emergencyContactVerified = false;
        updateData.emergencyContactComment = comment;
        break;
      default:
        throw new ApiError(400, `Invalid verification field: ${field}`);
    }

    await prisma.buddyVerification.update({
      where: { buddyId },
      data: updateData,
    });

    // Only set isVerified to false for REQUIRED fields
    // bankDetails is OPTIONAL, so rejecting it should NOT affect buddy verification status
    const requiredFields: VerificationField[] = ['aadhaarFront', 'aadhaarBack', 'pan', 'emergencyContact'];
    if (requiredFields.includes(field)) {
      await prisma.buddy.update({
        where: { id: buddyId },
        data: { isVerified: false },
      });
      logger.info(`Required field ${field} rejected - buddy ${buddyId} isVerified set to false`);
    } else {
      logger.info(`Optional field ${field} rejected - buddy ${buddyId} isVerified NOT changed`);
    }

    logger.info(`Field ${field} rejected for buddy ${buddyId} with comment: ${comment}`);
  }

  /**
   * Check if all required fields are verified
   * Bank details are OPTIONAL - buddy can be verified without them
   * Required: aadhaarFront, aadhaarBack, pan, emergencyContact
   */
  checkAllVerified(verification: any): boolean {
    // Only require: Aadhaar (front & back), PAN, Emergency Contact
    // Bank details is OPTIONAL for verification
    return (
      verification.aadhaarFrontVerified &&
      verification.aadhaarBackVerified &&
      verification.panVerified &&
      verification.emergencyContactVerified
      // bankDetailsVerified is NOT required
    );
  }

  /**
   * Check all fields and update buddy.isVerified if all are verified
   */
  async checkAndUpdateBuddyVerification(buddyId: string): Promise<boolean> {
    const verification = await prisma.buddyVerification.findUnique({
      where: { buddyId },
    });

    if (!verification) {
      return false;
    }

    const allVerified = this.checkAllVerified(verification);

    if (allVerified) {
      await prisma.buddy.update({
        where: { id: buddyId },
        data: {
          isVerified: true,
          verifiedAt: new Date(),
        },
      });
      logger.info(`Buddy ${buddyId} is now fully verified`);
      return true;
    }

    return false;
  }

  /**
   * Reset verification for a field (when buddy re-uploads)
   */
  async resetFieldVerification(
    buddyId: string,
    field: VerificationField
  ): Promise<void> {
    // const verification = await this.getOrCreateVerification(buddyId);

    const updateData: any = {};

    switch (field) {
      case 'aadhaarFront':
        updateData.aadhaarFrontVerified = false;
        updateData.aadhaarFrontComment = null;
        break;
      case 'aadhaarBack':
        updateData.aadhaarBackVerified = false;
        updateData.aadhaarBackComment = null;
        break;
      case 'pan':
        updateData.panVerified = false;
        updateData.panComment = null;
        break;
      case 'bankDetails':
        updateData.bankDetailsVerified = false;
        updateData.bankDetailsComment = null;
        break;
      case 'emergencyContact':
        updateData.emergencyContactVerified = false;
        updateData.emergencyContactComment = null;
        break;
      default:
        throw new ApiError(400, `Invalid verification field: ${field}`);
    }

    await prisma.buddyVerification.update({
      where: { buddyId },
      data: updateData,
    });

    // Only set isVerified to false for REQUIRED fields
    // bankDetails is OPTIONAL, so resetting it should NOT affect buddy verification status
    const requiredFields: VerificationField[] = ['aadhaarFront', 'aadhaarBack', 'pan', 'emergencyContact'];
    if (requiredFields.includes(field)) {
      await prisma.buddy.update({
        where: { id: buddyId },
        data: { isVerified: false },
      });
      logger.info(`Required field ${field} reset - buddy ${buddyId} isVerified set to false`);
    } else {
      logger.info(`Optional field ${field} reset - buddy ${buddyId} isVerified NOT changed`);
    }

    logger.info(`Field ${field} verification reset for buddy ${buddyId}`);
  }
}


