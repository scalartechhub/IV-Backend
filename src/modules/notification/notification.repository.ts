import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { COLLECTIONS } from "../../shared/constants";

interface CreateNotificationInput {
  userId: string;
  interviewId: string;
  title: string;
  description: string;
  type: string;
  actionUrl?: string;
  read?: boolean;
}

export const createNotification = async (input: CreateNotificationInput): Promise<void> => {
  const ref = db.collection(COLLECTIONS.NOTIFICATIONS).doc();

  await ref.set({
    userId: input.userId,
    interviewId: input.interviewId,
    title: input.title,
    description: input.description,
    type: input.type,
    ...(input.actionUrl && { actionUrl: input.actionUrl }),
    read: input.read ?? false,
    createdAt: FieldValue.serverTimestamp(),
  });
};
