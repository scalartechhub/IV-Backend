import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { sendContactEmail, ContactFormData } from './email.service';
import { asyncHandler } from '../../middleware/async.middleware';
import { AppError } from '../../shared/utils';
import { sendSuccess } from '../../shared/responses';

const router = Router();

export const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many messages sent from this IP, please try again in 15 minutes.',
  },
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_LENGTHS = {
  fullName: 100,
  subject: 200,
  message: 5000,
};

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    const { fullName, email, subject, message } = req.body as Record<string, unknown>;

    // Presence check
    if (!fullName || !email || !subject || !message) {
      throw new AppError(400, 'Missing required fields: fullName, email, subject, message');
    }

    // Type check — all must be non-empty strings
    if (
      typeof fullName !== 'string' ||
      typeof email !== 'string' ||
      typeof subject !== 'string' ||
      typeof message !== 'string'
    ) {
      throw new AppError(400, 'All fields must be strings.');
    }

    // Format validation
    if (!EMAIL_REGEX.test(email)) {
      throw new AppError(400, 'Invalid email address format.');
    }

    // Length guards to prevent payload abuse
    if (fullName.trim().length > MAX_LENGTHS.fullName) {
      throw new AppError(400, `Name must be ${MAX_LENGTHS.fullName} characters or fewer.`);
    }
    if (subject.trim().length > MAX_LENGTHS.subject) {
      throw new AppError(400, `Subject must be ${MAX_LENGTHS.subject} characters or fewer.`);
    }
    if (message.trim().length > MAX_LENGTHS.message) {
      throw new AppError(400, `Message must be ${MAX_LENGTHS.message} characters or fewer.`);
    }

    const formData: ContactFormData = {
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      subject: subject.trim(),
      message: message.trim(),
    };

    await sendContactEmail(formData);

    sendSuccess(res, { fullName: formData.fullName, email: formData.email, subject: formData.subject }, 'Your message has been sent successfully.');
  })
);

export default router;
