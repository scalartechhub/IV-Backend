import type { Interview, JDAnalysis, ResumeAnalysis } from "./interview.types";

export const buildInterviewDocuments = (fields: {
  resumeParsed?: ResumeAnalysis;
  jdParsed?: JDAnalysis;
}): Interview["documents"] | undefined => {
  if (!fields.resumeParsed && !fields.jdParsed) return undefined;

  return {
    ...(fields.resumeParsed && { resume: { parsed: fields.resumeParsed } }),
    ...(fields.jdParsed && { jd: { parsed: fields.jdParsed } }),
  };
};
