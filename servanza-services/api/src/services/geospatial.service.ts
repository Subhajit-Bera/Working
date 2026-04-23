import { prisma } from '../config/database';
import axios from 'axios';
import { logger } from '../utils/logger';
import { cacheGet, cacheSet } from '../config/redis';

interface Location {
  latitude: number;
  longitude: number;
}

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in kilometers
 */
function calculateDistanceHaversine(point1: Location, point2: Location): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(point2.latitude - point1.latitude);
  const dLng = toRadians(point2.longitude - point1.longitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(point1.latitude)) * Math.cos(toRadians(point2.latitude)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export class GeoService {
  private googleApiKey: string;

  constructor() {
    this.googleApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  }

  calculateDistance(point1: Location, point2: Location): number {
    return calculateDistanceHaversine(point1, point2);
  }

  async getETA(origin: Location, destination: Location): Promise<number> {
    const cacheKey = `eta:${origin.latitude},${origin.longitude}:${destination.latitude},${destination.longitude}`;

    const cached = await cacheGet<number>(cacheKey);
    if (cached) {
      return cached;
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

        await cacheSet(cacheKey, etaMinutes, 900);

        return etaMinutes;
      } else {
        logger.warn(`Distance Matrix API error: ${response.data.status}`);
        return this.estimateETAFromDistance(this.calculateDistance(origin, destination));
      }
    } catch (error) {
      logger.error('Error fetching ETA from Google Distance Matrix:', error);
      return this.estimateETAFromDistance(this.calculateDistance(origin, destination));
    }
  }

  private estimateETAFromDistance(distanceKm: number): number {
    const averageSpeedKmh = 30;
    return Math.ceil((distanceKm / averageSpeedKmh) * 60);
  }

  /**
   * Find buddies within radius using PostGIS
   */
  async findBuddiesWithinRadius(
    location: Location,
    radiusKm: number
  ): Promise<Array<{ id: string; distance: number }>> {
    const radiusMeters = radiusKm * 1000;
    const lon = location.longitude;
    const lat = location.latitude;

    // Use parameterized raw query to avoid constructing PostGIS SQL with prisma.$raw
    const sql = `
      SELECT
        b.id,
        ST_Distance(
          b."lastKnownLocation",
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) as distance
      FROM "buddies" b
      WHERE
        b."isAvailable" = true
        AND b."isOnline" = true
        AND b."lastKnownLocation" IS NOT NULL
        AND ST_DWithin(
          b."lastKnownLocation",
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3
        )
      ORDER BY distance ASC;
    `;

    const result = await prisma.$queryRawUnsafe(sql, lon, lat, radiusMeters) as Array<{ id: string; distance: number }>;

    return result.map((row: any) => ({
      id: row.id,
      distance: row.distance / 1000,
    }));
  }

  /**
   * Get nearest N buddies using KNN index
   */
  async getNearestBuddies(
    location: Location,
    limit: number = 10
  ): Promise<Array<{ id: string; distance: number }>> {
    const lon = location.longitude;
    const lat = location.latitude;

    const sql = `
      SELECT
        b.id,
        ST_Distance(
          b."lastKnownLocation",
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) / 1000 as distance
      FROM "buddies" b
      WHERE
        b."isAvailable" = true
        AND b."isOnline" = true
        AND b."lastKnownLocation" IS NOT NULL
      ORDER BY b."lastKnownLocation" <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geometry
      LIMIT $3;
    `;

    // const result = await prisma.$queryRawUnsafe<Array<{ id: string; distance: number }>>(sql, lon, lat, limit);
    const result = await prisma.$queryRawUnsafe(sql, lon, lat, limit) as Array<{ id: string; distance: number }>;
    return result;
  }

  /**
   * Update buddy location (PostGIS-safe)
   */
  async updateBuddyLocation(buddyId: string, location: Location): Promise<void> {
    const lon = location.longitude;
    const lat = location.latitude;

    // Use callback form of $transaction so every operation runs on the same transaction context
    // await prisma.$transaction(async (tx) => {
    //   // 1) Update buddy record (use geography)
    //   await tx.$executeRawUnsafe(
    //     `UPDATE "buddies"
    //      SET
    //        "lastKnownLocation" = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
    //        "lastLocationTime" = NOW(),
    //        "lastLocationLat" = $2,
    //        "lastLocationLong" = $1
    //      WHERE id = $3`,
    //     lon,
    //     lat,
    //     buddyId
    //   );

    //   // 2) create location_event and attach geometry
    //   const event = await tx.locationEvent.create({
    //     data: {
    //       buddyId,
    //       latitude: lat,
    //       longitude: lon,
    //       timestamp: new Date(),
    //     },
    //   });

    //   // 3) update the event 'location' geometry using the new event ID
    //   await tx.$executeRawUnsafe(
    //     `UPDATE "location_events"
    //      SET "location" = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
    //      WHERE id = $3`,
    //     lon,
    //     lat,
    //     event.id
    //   );
    // });


    await prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(
        `UPDATE "buddies"
     SET
       "lastKnownLocation" = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
       "lastLocationTime" = NOW(),
       "lastLocationLat" = $2,
       "lastLocationLong" = $1
     WHERE id = $3`,
        lon,
        lat,
        buddyId
      );

      const event = await tx.locationEvent.create({
        data: {
          buddyId,
          latitude: lat,
          longitude: lon,
          timestamp: new Date(),
        },
      });

      await tx.$executeRawUnsafe(
        `UPDATE "location_events"
     SET "location" = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
     WHERE id = $3`,
        lon,
        lat,
        event.id
      );
    });
  }

  /**
   * Get buddy location history
   */
  async getBuddyLocationHistory(
    buddyId: string,
    startTime: Date,
    endTime: Date
  ): Promise<Array<{ latitude: number; longitude: number; timestamp: Date }>> {
    const events = await prisma.locationEvent.findMany({
      where: {
        buddyId,
        timestamp: {
          gte: startTime,
          lte: endTime,
        },
      },
      orderBy: { timestamp: 'asc' },
      select: {
        latitude: true,
        longitude: true,
        timestamp: true,
      },
    });

    return events;
  }

  /**
   * Reverse geocode coordinates to address
   */
  async reverseGeocode(location: Location): Promise<string> {
    const cacheKey = `geocode:${location.latitude},${location.longitude}`;

    const cached = await cacheGet<string>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/geocode/json',
        {
          params: {
            latlng: `${location.latitude},${location.longitude}`,
            key: this.googleApiKey,
          },
          timeout: 5000,
        }
      );

      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const address = response.data.results[0].formatted_address;
        await cacheSet(cacheKey, address, 3600 * 24);
        return address;
      }

      return 'Unknown location';
    } catch (error) {
      logger.error('Error reverse geocoding:', error);
      return 'Unknown location';
    }
  }
}
