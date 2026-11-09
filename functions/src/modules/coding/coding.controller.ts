import { Request, Response } from "express";
import * as codingService from "./coding.service";
import { normalizeIdempotencyKey } from "./coding.execution-guard";
import { sendCreated, sendSuccess } from "../../shared/responses";
import type {
  GenerateCodingProblemInput,
  RunCodeInput,
  SubmitCodeInput,
} from "./coding.validation";
import type { CodingDifficulty, CodingLanguageId } from "./coding.types";

export const listLanguages = async (_req: Request, res: Response): Promise<void> => {
  const languages = codingService.listLanguages();
  sendSuccess(res, { languages }, "Coding languages loaded");
};

export const listQuestions = async (req: Request, res: Response): Promise<void> => {
  const questions = await codingService.listQuestions(req.user!.uid);
  sendSuccess(res, { questions }, "Coding questions loaded");
};

export const getQuestion = async (req: Request, res: Response): Promise<void> => {
  const questionId = String(req.params.questionId ?? "");
  const question = await codingService.getQuestion(req.user!.uid, questionId);
  sendSuccess(res, question, "Coding question loaded");
};

export const generateQuestion = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as GenerateCodingProblemInput;
  const question = await codingService.generateProblemForUser(req.user!.uid, {
    difficulty: body.difficulty as CodingDifficulty | undefined,
    focusTopic: body.focusTopic,
  });
  sendCreated(res, question, "Coding question generated from your profile");
};

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
  const idempotencyKey = normalizeIdempotencyKey(
    req.header("Idempotency-Key") ?? req.header("idempotency-key")
  );
  const result = await codingService.submitCode(
    req.user!.uid,
    body.problemId,
    body.language as CodingLanguageId | undefined,
    body.sourceCode,
    idempotencyKey,
    body.answerText
  );
  const message = result.solved
    ? "Accepted! Problem solved."
    : result.verdict === "pending_review"
      ? "Answer submitted for review"
      : "Submission recorded";
  sendSuccess(res, result, message);
};

export const getSubmission = async (req: Request, res: Response): Promise<void> => {
  const submissionId = String(req.params.submissionId ?? "");
  const result = await codingService.getSubmission(req.user!.uid, submissionId);
  sendSuccess(res, result, "Submission loaded");
};
