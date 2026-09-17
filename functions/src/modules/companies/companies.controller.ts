/**
 * Companies Controller.
 * Validates request parameters, extracts authenticated UID, invokes CompaniesService, and formats response.
 */

import { Request, Response } from 'express';
import { companiesService, CompaniesService, OnboardingIncompleteError } from './companies.service';
import { logger } from '../../shared/logger';

export class CompaniesController {
  private static readonly MAX_RADIUS_METERS = 50000;
  private static readonly MAX_LIMIT = 50;
  private static readonly DEFAULT_RADIUS = 25000;
  private static readonly DEFAULT_LIMIT = 20;

  constructor(private readonly service: CompaniesService = companiesService) {}

  public getNearbyOrganizations = async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. Authenticated UID check
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication token is required.',
          },
        });
        return;
      }

      // 2. Request body validation
      const body = req.body ?? {};

      // Latitude validation
      if (body.latitude === undefined || body.latitude === null || body.latitude === '') {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_LOCATION',
            message: 'Latitude is required.',
          },
        });
        return;
      }

      const latitude = Number(body.latitude);
      if (isNaN(latitude) || latitude < -90 || latitude > 90) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_LOCATION',
            message: 'Latitude must be between -90 and 90.',
          },
        });
        return;
      }

      // Longitude validation
      if (body.longitude === undefined || body.longitude === null || body.longitude === '') {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_LOCATION',
            message: 'Longitude is required.',
          },
        });
        return;
      }

      const longitude = Number(body.longitude);
      if (isNaN(longitude) || longitude < -180 || longitude > 180) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_LOCATION',
            message: 'Longitude must be between -180 and 180.',
          },
        });
        return;
      }

      // Radius validation
      let radius = CompaniesController.DEFAULT_RADIUS;
      if (body.radius !== undefined && body.radius !== null && body.radius !== '') {
        radius = Number(body.radius);
        if (isNaN(radius) || radius <= 0 || radius > CompaniesController.MAX_RADIUS_METERS) {
          res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_RADIUS',
              message: `Radius must be between 1 and ${CompaniesController.MAX_RADIUS_METERS} meters.`,
            },
          });
          return;
        }
      }

      // Limit validation
      let limit = CompaniesController.DEFAULT_LIMIT;
      if (body.limit !== undefined && body.limit !== null && body.limit !== '') {
        limit = Number(body.limit);
        if (isNaN(limit) || limit <= 0 || limit > CompaniesController.MAX_LIMIT) {
          res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_LIMIT',
              message: `Limit must be between 1 and ${CompaniesController.MAX_LIMIT}.`,
            },
          });
          return;
        }
      }

      // Optional targetRole and domain overrides from body
      const targetRole =
        typeof body.targetRole === 'string' && body.targetRole.trim()
          ? body.targetRole.trim()
          : undefined;

      const domain =
        typeof body.domain === 'string' && body.domain.trim()
          ? body.domain.trim()
          : undefined;

      // 3. Service execution
      const data = await this.service.getNearbyOrganizations(uid, {
        latitude,
        longitude,
        radius,
        limit,
        targetRole,
        domain,
      });


      // 4. Return success response
      res.status(200).json({
        success: true,
        data,
      });
    } catch (err: unknown) {
      if (err instanceof OnboardingIncompleteError) {
        res.status(400).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        });
        return;
      }

      logger.error('[CompaniesController] Failed to get nearby organizations', {
        error: err instanceof Error ? err.message : String(err),
      });

      res.status(502).json({
        success: false,
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Failed to retrieve nearby organizations. Please try again later.',
        },
      });
    }
  };
}

export const companiesController = new CompaniesController();
