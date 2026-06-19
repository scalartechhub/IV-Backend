export const toAnswerDocId = (interviewId: string, questionId: string): string =>
  `${interviewId}__${questionId}`;

export const toEvaluationDocId = (interviewId: string, questionId: string): string =>
  `${interviewId}__${questionId}__eval`;

export const toReportDocId = (interviewId: string): string => `report__${interviewId}`;

export const isCanonicalReportId = (docId: string): boolean => docId.startsWith("report__");
