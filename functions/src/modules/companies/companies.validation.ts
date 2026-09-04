import { z } from 'zod';

export const nearbyQuerySchema = z.object({
  lat: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v !== undefined && v !== '' ? Number(v) : undefined))
    .pipe(z.number().min(-90).max(90).optional()),
  lon: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v !== undefined && v !== '' ? Number(v) : undefined))
    .pipe(z.number().min(-180).max(180).optional()),
  city: z.string().trim().max(120).optional(),
  radiusKm: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v !== undefined && v !== '' ? Number(v) : 25))
    .pipe(z.number().min(1).max(100)),
  role: z.string().trim().max(120).optional(),
});

