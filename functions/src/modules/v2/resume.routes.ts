/**

 * V2 resume Express routes.

 *

 * POST /v2/resumes/analyze

 *   multipart: file (PDF), optional targetRole, optional onboarding

 *   When onboarding=true (body/query), also generates the full interview-prep plan.

 */

import { Router } from "express";

import { asyncHandler } from "../../middleware/async.middleware";

import { requirePdfUpload } from "../../middleware/upload.middleware";

import { AppError } from "../../shared/utils";

import { sendCreated, sendSuccess } from "../../shared/responses";

import * as resumeService from "../../services/resume.service";

const router = Router();

/** Parse multipart/query boolean flags like "true" / "1" / true. */

function parseBooleanFlag(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;

  if (typeof raw === "number") return raw === 1;

  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();

    return normalized === "true" || normalized === "1" || normalized === "yes";
  }

  return false;
}

router.post(
  "/analyze",

  requirePdfUpload,

  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(
        400,
        "Resume PDF file is required (multipart field: file).",
      );
    }

    const targetRoleRaw = req.body?.targetRole;

    // Optional — onboarding flows omit this; ATS/plan infer role from the resume.
    const targetRole =
      typeof targetRoleRaw === "string" && targetRoleRaw.trim().length > 0
        ? targetRoleRaw.trim()
        : undefined;

    // Prefer body (multipart form field), fall back to query: ?onboarding=true

    const onboarding = parseBooleanFlag(
      req.body?.onboarding ?? req.query?.onboarding,
    );

    const result = await resumeService.analyzeResume(req.user!.uid, {
      fileBuffer: req.file.buffer,

      fileName: req.file.originalname || "resume.pdf",

      targetRole,

      onboarding,
    });

    sendCreated(
      res,

      result,

      onboarding
        ? "Resume analyzed and onboarding plan generated successfully"
        : "Resume analyzed successfully",
    );
  }),
);

router.get(
  "/active",

  asyncHandler(async (req, res) => {
    const result = await resumeService.getActiveResume(req.user!.uid);

    sendSuccess(res, result, "Active resume fetched");
  }),
);

export default router;
