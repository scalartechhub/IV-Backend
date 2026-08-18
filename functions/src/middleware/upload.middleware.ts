import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { Readable } from "stream";
import { FILE_LIMITS } from "../shared/constants";
import { AppError } from "../shared/utils";

const memoryStorage = multer.memoryStorage();

const isPdfFile = (mimetype: string, originalname: string): boolean => {
  const allowedMimes = [
    "application/pdf",
    "application/x-pdf",
    "application/octet-stream",
  ];
  if (allowedMimes.includes(mimetype)) return true;
  return originalname.toLowerCase().endsWith(".pdf");
};

const pdfFileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (isPdfFile(file.mimetype, file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error("Only PDF files are allowed. Please upload a .pdf file."));
  }
};

export const uploadPDF = multer({
  storage: memoryStorage,
  limits: {
    fileSize: FILE_LIMITS.MAX_SIZE_BYTES,
    files: 1,
  },
  fileFilter: pdfFileFilter,
});

const uploadInterviewDocuments = multer({
  storage: memoryStorage,
  limits: {
    fileSize: FILE_LIMITS.MAX_SIZE_BYTES,
    files: 2,
  },
  fileFilter: pdfFileFilter,
}).fields([
  { name: "resume", maxCount: 1 },
  { name: "jd", maxCount: 1 },
]);

/**
 * Cloud Functions compatibility helper.
 * GCP Cloud Functions consumes the incoming HTTP request stream and populates req.rawBody.
 * Multer/Busboy expects an unconsumed stream; constructing a Readable stream from req.rawBody
 * allows Busboy to successfully parse multipart form data.
 */
function getStreamReq(req: Request): Request {
  const rawBody = (req as any).rawBody || (req as any).rawBuffer;
  if (rawBody && Buffer.isBuffer(rawBody) && rawBody.length > 0) {
    const readable = Readable.from(rawBody) as any;
    readable.headers = req.headers;
    readable.method = req.method;
    readable.url = req.url;
    readable.body = req.body;
    readable.user = (req as any).user;
    readable.query = req.query;
    readable.params = req.params;
    return readable as Request;
  }
  return req;
}

export const requirePdfUpload = (req: Request, res: Response, next: NextFunction): void => {
  const targetReq = getStreamReq(req);
  uploadPDF.single("file")(targetReq, res, (err) => {
    if (targetReq !== req) {
      req.file = targetReq.file;
      req.files = targetReq.files;
      req.body = { ...req.body, ...targetReq.body };
    }

    if (err) {
      next(err);
      return;
    }

    if (!req.file) {
      next(
        new AppError(
          400,
          'No file received. Use multipart form-data with field name "file" and upload a PDF file.'
        )
      );
      return;
    }

    next();
  });
};

export const requireInterviewDocumentsUpload = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const targetReq = getStreamReq(req);
  uploadInterviewDocuments(targetReq, res, (err) => {
    if (targetReq !== req) {
      req.file = targetReq.file;
      req.files = targetReq.files;
      req.body = { ...req.body, ...targetReq.body };
    }

    if (err) {
      next(err);
      return;
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const resume = files?.resume?.[0];
    const jd = files?.jd?.[0];

    if (!resume && !jd) {
      next(
        new AppError(
          400,
          'Please upload at least one PDF using multipart form-data fields "resume" and/or "jd".'
        )
      );
      return;
    }

    next();
  });
};

