// Mirrors src/app/interfaces/converters.ts — keep in sync
import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import type { UserDoc } from './user.interface';
import type { ResumeDoc } from './resume.interface';
import type { InterviewDoc } from './interview.interface';
import type { ConversationTurn } from './conversation-turn.interface';
import type { CodingSubmission } from './coding-submission.interface';
import type { ReportDoc, WeeklyStatsDoc } from './report.interface';
import type {
  AchievementCatalogDoc,
  UserAchievementDoc,
} from './achievement.interface';
import type { RoadmapDoc } from './roadmap.interface';
import type { CareerProgressDoc } from './career-progress.interface';
import type { NotificationDoc } from './notification.interface';
import type {
  JobListingDoc,
  JobMatchDoc,
  ApplicationDoc,
} from './job.interface';
import type {
  CodingProblemDoc,
  ProblemProgressDoc,
} from './coding-problem.interface';
import type { BookmarkDoc } from './bookmark.interface';
import type { FeedbackDoc } from './feedback.interface';
import type { AnalyticsEventDoc } from './analytics-event.interface';
import type { XpTransactionDoc } from './xp-transaction.interface';

function identityConverter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore(modelObject: T): DocumentData {
      return modelObject as DocumentData;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot): T {
      return snapshot.data() as T;
    },
  };
}

export const userConverter = identityConverter<UserDoc>();
export const resumeConverter = identityConverter<ResumeDoc>();
export const interviewConverter = identityConverter<InterviewDoc>();
export const conversationTurnConverter = identityConverter<ConversationTurn>();
export const codingSubmissionConverter = identityConverter<CodingSubmission>();
export const reportConverter = identityConverter<ReportDoc>();
export const weeklyStatsConverter = identityConverter<WeeklyStatsDoc>();
export const achievementCatalogConverter =
  identityConverter<AchievementCatalogDoc>();
export const userAchievementConverter = identityConverter<UserAchievementDoc>();
export const roadmapConverter = identityConverter<RoadmapDoc>();
export const careerProgressConverter = identityConverter<CareerProgressDoc>();
export const notificationConverter = identityConverter<NotificationDoc>();
export const jobListingConverter = identityConverter<JobListingDoc>();
export const jobMatchConverter = identityConverter<JobMatchDoc>();
export const applicationConverter = identityConverter<ApplicationDoc>();
export const codingProblemConverter = identityConverter<CodingProblemDoc>();
export const problemProgressConverter = identityConverter<ProblemProgressDoc>();
export const bookmarkConverter = identityConverter<BookmarkDoc>();
export const feedbackConverter = identityConverter<FeedbackDoc>();
export const analyticsEventConverter = identityConverter<AnalyticsEventDoc>();
export const xpTransactionConverter = identityConverter<XpTransactionDoc>();