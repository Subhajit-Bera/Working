export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  message?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext?: boolean;
  hasPrev?: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface QueryFilters {
  search?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface Location {
  latitude: number;
  longitude: number;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface DistanceMatrix {
  origin: Location;
  destination: Location;
  distance: number; // in kilometers
  duration: number; // in minutes
}