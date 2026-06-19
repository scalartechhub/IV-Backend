import * as userRepo from "./auth.repository";
import { logger } from "../../shared/logger";

export class UserStatsService {
  async onInterviewCreated(userId: string): Promise<void> {
    await userRepo.incrementTotalInterviews(userId);
    logger.debug(`[UserStatsService] totalInterviews incremented uid=${userId}`);
  }

  async onInterviewCompleted(userId: string, overallScore: number): Promise<void> {
    await userRepo.updateUserStatsOnCompletion(userId, overallScore);
    logger.info(`[UserStatsService] stats updated uid=${userId} score=${overallScore}`);
  }
}

export const userStatsService = new UserStatsService();
