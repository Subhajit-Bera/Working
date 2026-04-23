import { prisma } from '../../../../prisma-client/index';
// USING ROOT PRISMA CLIENT - ensure `npx prisma generate` run at repo root
// import { UserRole } from '@prisma/client';

// declare global {
//   namespace Express {
//     interface Request {
//       user?: {
//         id: string;
//         email?: string;
//         role?: UserRole;
//         roles?: string[];
//         [key: string]: any;
//       } | null;
//     }
//   }
// }

// // This export makes it a module, which is required for global augmentation
// export {};


import type { UserRoleType } from "./prisma-role";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role: UserRoleType;
        adminRole?: 'SUPER_ADMIN' | 'ADMIN' | 'OPERATIONS_MANAGER' | 'FINANCE_MANAGER' | 'SUPPORT_AGENT';
        roles?: string[];
        [key: string]: any;
      } | null;
    }
  }
}

export { };
