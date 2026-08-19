import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../config/firebase";
import { COLLECTIONS } from "../../shared/constants";
import type { MonitoringEvent, MonitoringQualitySnapshot, MonitoringViolation } from "./monitoring.types";

const interviewRef = (interviewId: string) => db.collection(COLLECTIONS.INTERVIEWS).doc(interviewId);
const subcollection = { events: "monitoringEvents", violations: "violations", snapshots: "qualitySnapshots" } as const;

export const setSessionState = async (interviewId: string, state: "started" | "ended"): Promise<void> => {
  const now = Timestamp.now();
  await interviewRef(interviewId).set({ monitoring: { sessionState: state, ...(state === "started" ? { startedAt: now, endedAt: null } : { endedAt: now }), updatedAt: now }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
};

export const addEventIfStateChanged = async (interviewId: string, event: Omit<MonitoringEvent, "id" | "createdAt" | "occurredAt">): Promise<{ event: MonitoringEvent; created: boolean }> => {
  const ref = interviewRef(interviewId); const now = Timestamp.now(); const id = uuidv4();
  return db.runTransaction(async (tx) => {
    const interview = await tx.get(ref); const states = (interview.data()?.monitoring?.eventStates ?? {}) as Record<string, string>;
    if (states[event.type] === event.state) return { event: { id, ...event, occurredAt: now, createdAt: now }, created: false };
    const value: MonitoringEvent = { id, ...event, occurredAt: now, createdAt: now };
    tx.set(ref.collection(subcollection.events).doc(id), value);
    tx.set(ref, { monitoring: { eventStates: { ...states, [event.type]: event.state }, lastEventAt: now }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { event: value, created: true };
  });
};

export const addQualitySnapshot = async (interviewId: string, snapshot: Omit<MonitoringQualitySnapshot, "id" | "createdAt" | "capturedAt">): Promise<MonitoringQualitySnapshot> => {
  const now = Timestamp.now(); const value: MonitoringQualitySnapshot = { id: uuidv4(), ...snapshot, capturedAt: now, createdAt: now };
  const ref = interviewRef(interviewId);
  await db.runTransaction(async (tx) => { const current = await tx.get(ref); const last = current.data()?.monitoring?.lastQualitySnapshotAt as Timestamp | undefined; if (last && now.toMillis() - last.toMillis() < 5_000) throw new Error("QUALITY_SNAPSHOT_TOO_FREQUENT"); tx.set(ref.collection(subcollection.snapshots).doc(value.id), value); tx.set(ref, { monitoring: { lastQualitySnapshotAt: now }, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); });
  return value;
};

export const addViolation = async (interviewId: string, violation: Omit<MonitoringViolation, "id" | "createdAt" | "occurredAt">): Promise<MonitoringViolation> => {
  const now = Timestamp.now(); const value: MonitoringViolation = { id: uuidv4(), ...violation, occurredAt: now, createdAt: now };
  await interviewRef(interviewId).collection(subcollection.violations).doc(value.id).set(value);
  return value;
};

export const getMonitoringData = async (interviewId: string) => {
  const ref = interviewRef(interviewId);
  const [interview, events, violations, snapshots] = await Promise.all([ref.get(), ref.collection(subcollection.events).orderBy("createdAt", "desc").limit(500).get(), ref.collection(subcollection.violations).orderBy("createdAt", "desc").limit(500).get(), ref.collection(subcollection.snapshots).orderBy("capturedAt", "desc").limit(500).get()]);
  return { session: interview.data()?.monitoring as Record<string, unknown> | undefined, events: events.docs.map((d) => d.data() as MonitoringEvent), violations: violations.docs.map((d) => d.data() as MonitoringViolation), snapshots: snapshots.docs.map((d) => d.data() as MonitoringQualitySnapshot) };
};
