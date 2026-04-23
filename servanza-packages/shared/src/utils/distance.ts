import { Location, Coordinates } from '../types/api.types';

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in kilometers
 */
export const calculateDistance = (point1: Location | Coordinates, point2: Location | Coordinates): number => {
  const R = 6371; // Earth's radius in km

  const lat1 = 'latitude' in point1 ? point1.latitude : point1.lat;
  const lng1 = 'longitude' in point1 ? point1.longitude : point1.lng;
  const lat2 = 'latitude' in point2 ? point2.latitude : point2.lat;
  const lng2 = 'longitude' in point2 ? point2.longitude : point2.lng;

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

/**
 * Convert degrees to radians
 */
export const toRadians = (degrees: number): number => {
  return (degrees * Math.PI) / 180;
};

/**
 * Convert radians to degrees
 */
export const toDegrees = (radians: number): number => {
  return (radians * 180) / Math.PI;
};

/**
 * Estimate ETA based on distance
 * Assumes average speed of 30 km/h in urban areas
 */
export const estimateETA = (distanceKm: number, averageSpeedKmh: number = 30): number => {
  return Math.ceil((distanceKm / averageSpeedKmh) * 60); // Returns minutes
};

/**
 * Check if a point is within a radius of another point
 */
export const isWithinRadius = (
  point1: Location | Coordinates,
  point2: Location | Coordinates,
  radiusKm: number
): boolean => {
  return calculateDistance(point1, point2) <= radiusKm;
};

/**
 * Get bounding box coordinates for a center point and radius
 */
export const getBoundingBox = (
  center: Location | Coordinates,
  radiusKm: number
): {
  north: number;
  south: number;
  east: number;
  west: number;
} => {
  const lat = 'latitude' in center ? center.latitude : center.lat;
  const lng = 'longitude' in center ? center.longitude : center.lng;

  const latChange = (radiusKm / 111.32); // 1 degree latitude ≈ 111.32 km
  const lngChange = radiusKm / (111.32 * Math.cos(toRadians(lat)));

  return {
    north: lat + latChange,
    south: lat - latChange,
    east: lng + lngChange,
    west: lng - lngChange,
  };
};
