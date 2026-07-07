import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import verifyToken from "../../middleware/auth.middleware";
import { validate } from "../../middleware/validation.middleware";
import { sendCreated, sendSuccess } from "../../shared/responses";
import * as chatService from "./chat.service";

const router = Router();

const sendMessageSchema = z.object({
  conversationId: z.string().trim().min(1).max(128).optional(),
  message: z.string().trim().min(1, "Message is required").max(4_000),
});

const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.use(verifyToken);

router.post(
  "/messages",
  validate(sendMessageSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await chatService.sendMessage(req.user!.uid, req.body);
      sendCreated(res, result, "Message generated successfully");
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/conversations/:conversationId/messages",
  validate(listMessagesQuerySchema, "query"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await chatService.getMessages(
        req.user!.uid,
        String(req.params.conversationId),
        Number(req.query.limit)
      );
      sendSuccess(res, { messages: result, total: result.length });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
