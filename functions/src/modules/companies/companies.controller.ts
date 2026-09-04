import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses';
import * as companiesService from './companies.service';
import type { NearbyCompanyQuery } from './companies.types';

export async function getNearby(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as NearbyCompanyQuery;
  const result = await companiesService.getNearbyCompanies(req.user!.uid, query);
  sendSuccess(res, result, 'Top 20 nearest companies fetched successfully');
}

