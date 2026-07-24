/**
 * Shared Firestore document / collection references with converters.
 */

import type { Firestore } from 'firebase-admin/firestore';
import {
  achievementCatalogConverter,
  applicationConverter,
  careerProgressConverter,
  codingProblemConverter,
  codingSubmissionConverter,
  conversationTurnConverter,
  interviewConverter,
  jobListingConverter,
  jobMatchConverter,
  notificationConverter,
  problemProgressConverter,
  reportConverter,
  resumeConverter,
  roadmapConverter,
  userAchievementConverter,
  userConverter,
  weeklyStatsConverter,
  xpTransactionConverter,
} from '../interfaces/converters';

export function userRef(db: Firestore, uid: string) {
  return db.collection('users').doc(uid).withConverter(userConverter);
}

export function resumeRef(db: Firestore, uid: string, resumeId: string) {
  return db
    .collection('users')
    .doc(uid)
    .collection('resumes')
    .doc(resumeId)
    .withConverter(resumeConverter);
}

export function resumesCol(db: Firestore, uid: string) {
  return db
    .collection('users')
    .doc(uid)
    .collection('resumes')
    .withConverter(resumeConverter);
}

export function interviewRef(db: Firestore, interviewId: string) {
  return db
    .collection('interviews')
    .doc(interviewId)
    .withConverter(interviewConverter);
}

export function conversationCol(db: Firestore, interviewId: string) {
  return db
    .collection('interviews')
    .doc(interviewId)
    .collection('conversation')
    .withConverter(conversationTurnConverter);
}

export function submissionsCol(db: Firestore, interviewId: string) {
  return db
    .collection('interviews')
    .doc(interviewId)
    .collection('submissions')
    .withConverter(codingSubmissionConverter);
}

export function skillRef(db: Firestore, uid: string, skillId: string) {
  return db.collection('users').doc(uid).collection('skills').doc(skillId);
}

export function skillsCol(db: Firestore, uid: string) {
  return db.collection('users').doc(uid).collection('skills');
}

export function weeklyStatsRef(db: Firestore, uid: string, weekStart: string) {
  return db
    .collection('users')
    .doc(uid)
    .collection('weeklyStats')
    .doc(weekStart)
    .withConverter(weeklyStatsConverter);
}

export function xpTransactionsCol(db: Firestore, uid: string) {
  return db
    .collection('users')
    .doc(uid)
    .collection('xpTransactions')
    .withConverter(xpTransactionConverter);
}

export function notificationsCol(db: Firestore, uid: string) {
  return db
    .collection('users')
    .doc(uid)
    .collection('notifications')
    .withConverter(notificationConverter);
}

export function achievementsCatalogCol(db: Firestore) {
  return db
    .collection('achievementsCatalog')
    .withConverter(achievementCatalogConverter);
}

export function userAchievementRef(
  db: Firestore,
  uid: string,
  achievementId: string,
) {
  return db
    .collection('users')
    .doc(uid)
    .collection('achievements')
    .doc(achievementId)
    .withConverter(userAchievementConverter);
}

export function reportsCol(db: Firestore, uid: string) {
  return db
    .collection('users')
    .doc(uid)
    .collection('reports')
    .withConverter(reportConverter);
}

export function roadmapCol(db: Firestore, uid: string) {
  return db
    .collection('users')
    .doc(uid)
    .collection('roadmap')
    .withConverter(roadmapConverter);
}

export function careerProgressRef(db: Firestore, uid: string) {
  return db
    .collection('users')
    .doc(uid)
    .collection('careerProgress')
    .doc('current')
    .withConverter(careerProgressConverter);
}

export function codingProblemRef(db: Firestore, problemId: string) {
  return db
    .collection('codingProblems')
    .doc(problemId)
    .withConverter(codingProblemConverter);
}

export function problemProgressRef(
  db: Firestore,
  uid: string,
  problemId: string,
) {
  return db
    .collection('users')
    .doc(uid)
    .collection('problemProgress')
    .doc(problemId)
    .withConverter(problemProgressConverter);
}

export function jobListingsCol(db: Firestore) {
  return db.collection('jobListings').withConverter(jobListingConverter);
}

export function jobMatchRef(db: Firestore, uid: string, jobId: string) {
  return db
    .collection('users')
    .doc(uid)
    .collection('jobMatches')
    .doc(jobId)
    .withConverter(jobMatchConverter);
}

export function applicationsCol(db: Firestore, uid: string) {
  return db
    .collection('users')
    .doc(uid)
    .collection('applications')
    .withConverter(applicationConverter);
}

export function goalsCol(db: Firestore, uid: string) {
  // TODO: goals collection not in architecture.md
  return db.collection('users').doc(uid).collection('goals');
}
