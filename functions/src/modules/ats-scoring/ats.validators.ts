export interface ValidationResult {
  valid: boolean;
  message: string;
}

export const validateAtsInput = (
  resumeText: string | undefined,
  jobDescription: string | undefined,
): ValidationResult => {
  if (!resumeText || !jobDescription) {
    return { valid: false, message: "Resume and Job Description are required" };
  }

  if (resumeText.trim().length < 100) {
    return {
      valid: false,
      message: "Resume text is too short (min 100 characters)",
    };
  }

  if (jobDescription.trim().length < 100) {
    return {
      valid: false,
      message: "Job Description is too short (min 100 characters)",
    };
  }

  if (resumeText.length > 15000 || jobDescription.length > 15000) {
    return {
      valid: false,
      message: "Text too long (max 15,000 characters each)",
    };
  }

  return {
    valid: true,
    message: "",
  };
};
