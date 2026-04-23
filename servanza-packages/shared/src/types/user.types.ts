export enum UserRole {
  USER = 'USER',
  BUDDY = 'BUDDY',
  ADMIN = 'ADMIN',
}

export enum AuthProvider {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  GOOGLE = 'GOOGLE',
}

export interface User {
  id: string;
  email?: string;
  phone?: string;
  name: string;
  role: UserRole;
  authProvider: AuthProvider;
  isActive: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  profileImage?: string;
  deviceTokens?: string[];
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}

export interface Address {
  id: string;
  userId: string;
  label: string;
  formattedAddress: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserDto {
  email?: string;
  phone?: string;
  password?: string;
  name: string;
  role?: UserRole;
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
  phone?: string;
  profileImage?: string;
}

export interface LoginDto {
  email?: string;
  phone?: string;
  password?: string;
  otp?: string;
}

export interface AuthResponse {
  user: Omit<User, 'passwordHash'>;
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

export interface CreateAddressDto {
  label: string;
  formattedAddress: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  latitude: number;
  longitude: number;
  isDefault?: boolean;
}