import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { UserRole} from '@prisma/client'; //, AdminRole 
import { AuthenticationError, AuthorizationError } from '../utils/errors';


export const authenticate = async (
  req: Request, // Using the standard Request type
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('No token provided');
    }

    const token = authHeader.substring(7);

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
      userId: string;
      role: UserRole;
      type: string;
    };

    if (decoded.type !== 'access') {
      throw new AuthenticationError('Invalid token type');
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        role: true,
        email: true,
        isActive: true,
        adminRole: true, // Fetch adminRole for RBAC
      },
    });

    if (!user || !user.isActive) {
      throw new AuthenticationError('Invalid token or user not found/deactivated');
    }

    req.user = {
      id: user.id,
      role: user.role,
      email: user.email || undefined,
      adminRole: user.adminRole || undefined, // Attach adminRole for RBAC
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AuthenticationError('Invalid token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new AuthenticationError('Token expired'));
    } else {
      next(error);
    }
  }
};

export const authorize = (...allowedRoles: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => { //Using the standard Request type
    if (!req.user) {
      throw new AuthenticationError('Not authenticated');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AuthorizationError('Insufficient permissions');
    }

    next();
  };
};