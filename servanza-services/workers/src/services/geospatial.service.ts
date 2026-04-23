import axios from 'axios';
import { logger } from '../utils/logger';
import { cacheGet, cacheSet } from '../config/redis';

// Note: This is a simplified version for the worker.
// It does not interact with the Prisma DB, only fetches external data.

interface Location {
  latitude: number;
  longitude: number;
}

export class GeoService {
  private googleApiKey: string;

  constructor() {
    this.googleApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  }

  /**
   * Calculate straight-line distance between two points (Haversine formula)
   */
  calculateDistance(point1: Location, point2: Location): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(point2.latitude - point1.latitude);
    const dLon = this.toRad(point2.longitude - point1.longitude);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(point1.latitude)) *
        Math.cos(this.toRad(point2.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  /**
   * Get ETA in minutes using Google Distance Matrix API
   */
  async getETA(origin: Location, destination: Location): Promise<number> {
    const cacheKey = `eta:${origin.latitude},${origin.longitude}:${destination.latitude},${destination.longitude}`;
    const cached = await cacheGet<number>(cacheKey);
    if (cached) {
      return cached;
    }

    if (!this.googleApiKey) {
      logger.warn('GOOGLE_MAPS_API_KEY not set, falling back to estimated ETA.');
      return this.estimateETAFromDistance(this.calculateDistance(origin, destination));
    }

    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/distancematrix/json',
        {
          params: {
            origins: `${origin.latitude},${origin.longitude}`,
            destinations: `${destination.latitude},${destination.longitude}`,
            mode: 'driving',
            key: this.googleApiKey,
          },
          timeout: 5000,
        }
      );

      if (
        response.data.status === 'OK' &&
        response.data.rows[0]?.elements[0]?.status === 'OK'
      ) {
        const durationSeconds = response.data.rows[0].elements[0].duration.value;
        const etaMinutes = Math.ceil(durationSeconds / 60);

        await cacheSet(cacheKey, etaMinutes, 900); // Cache for 15 minutes
        return etaMinutes;
      } else {
        logger.warn(`Distance Matrix API error: ${response.data.status}. Falling back to estimate.`);
        return this.estimateETAFromDistance(this.calculateDistance(origin, destination));
      }
    } catch (error) {
      logger.error('Error fetching ETA from Google Distance Matrix:', error);
      return this.estimateETAFromDistance(this.calculateDistance(origin, destination));
    }
  }

  /**
   * Fallback ETA estimation based on distance
   */
  private estimateETAFromDistance(distanceKm: number): number {
    const averageSpeedKmh = 30; // 30 km/h average
    return Math.ceil((distanceKm / averageSpeedKmh) * 60);
  }
}