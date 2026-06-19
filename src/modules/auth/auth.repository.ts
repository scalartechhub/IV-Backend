import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase";
import { COLLECTIONS } from "../../shared/constants";
import { AppError } from "../../shared/utils";
import type { User, UserProfile } from "./auth.types";

export const upsertUser = async (
  uid: string,
  fields: Partial<Omit<User, "isActive" | "createdAt" | "updatedAt">>
): Promise<User> => {
  const ref = db.collection(COLLECTIONS.USERS).doc(uid);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    await ref.set({
      ...fields,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await ref.update({
      ...fields,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return (await ref.get()).data() as User;
};

export const findUserById = async (uid: string): Promise<User | null> => {
  const snapshot = await db.collection(COLLECTIONS.USERS).doc(uid).get();
  return snapshot.exists ? (snapshot.data() as User) : null;
};

export const requireUserById = async (uid: string): Promise<User> => {
  const user = await findUserById(uid);
  if (!user) throw new AppError(404, "User not found");
  return user;
};

export const getUserProfile = async (uid: string): Promise<UserProfile> => {
  const snapshot = await db.collection(COLLECTIONS.USERS).doc(uid).get();
  if (!snapshot.exists) throw new AppError(404, "User profile not found");
  return snapshot.data() as UserProfile;
};
