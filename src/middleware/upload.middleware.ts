import { Request, Response, NextFunction } from "express";
import multer from "multer";
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

export const uploadPDF = multer({
  storage: memoryStorage,
  limits: {
    fileSize: FILE_LIMITS.MAX_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (isPdfFile(file.mimetype, file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed. Please upload a .pdf file."));
    }
  },
});

export const requirePdfUpload = (req: Request, res: Response, next: NextFunction): void => {
  uploadPDF.single("file")(req, res, (err) => {
    if (err) {
      next(err);
      return;
    }

    if (!req.file) {
      next(
        new AppError(
          400,
          'No file received. Use multipart form-data with field name "file" and select a PDF. In Postman: Body → form-data → key "file" → type File.'
        )
      );
      return;
    }

    next();
  });
};
