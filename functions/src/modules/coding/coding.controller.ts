import { Request, Response } from "express";
import * as codingService from "./coding.service";
import { sendSuccess } from "../../shared/responses";
import type { RunCodeInput, SubmitCodeInput } from "./coding.validation";
import type { CodingLanguageId } from "./coding.types";

export const runCode = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as RunCodeInput;
  const result = await codingService.runCode(
    req.user!.uid,
    body.problemId,
    body.language as CodingLanguageId,
    body.sourceCode,
    body.customInput
  );
  sendSuccess(res, result, "Code executed successfully");
};

export const submitCode = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as SubmitCodeInput;
  const result = await codingService.submitCode(
    req.user!.uid,
    body.problemId,
    body.language as CodingLanguageId,
    body.sourceCode
  );
  sendSuccess(res, result, result.solved ? "Accepted! Problem solved." : "Submission recorded");
};
