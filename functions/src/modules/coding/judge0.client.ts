import type { Judge0Result, Judge0Submission } from "./coding.types";
import { appConfig } from "../../config/app.config";

const getJudge0BaseUrl = (): string => appConfig.judge0Url.replace(/\/$/, "");

/** Judge0 memory_limit is in KB; compose MAX_MEMORY_LIMIT defaults to 512000. */
const MAX_MEMORY_KB = 512000;

const POLL_INTERVAL_MS = 500;
const MAX_POLL_ATTEMPTS = 120; // ~60s — allows cold compile + queue

const judge0Fetch = async (path: string, init?: RequestInit): Promise<Response> => {
  const url = `${getJudge0BaseUrl()}${path}`;
  const response = await fetch(url, init);
  return response;
};

const clampMemoryKb = (memoryLimitKb?: number): number | undefined => {
  if (memoryLimitKb === undefined) {
    return undefined;
  }
  return Math.min(Math.max(1, memoryLimitKb), MAX_MEMORY_KB);
};

export const createSubmission = async (
  payload: Judge0Submission
): Promise<string> => {
  const body: Judge0Submission = {
    ...payload,
    memory_limit: clampMemoryKb(payload.memory_limit),
  };

  const response = await judge0Fetch("/submissions?base64_encoded=false&wait=false", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Judge0 submission failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { token?: string };
  if (!data.token) {
    throw new Error("Judge0 did not return a submission token");
  }

  return data.token;
};

export const getSubmission = async (token: string): Promise<Judge0Result> => {
  const response = await judge0Fetch(
    `/submissions/${token}?base64_encoded=false&fields=stdout,stderr,compile_output,status,time,memory`
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Judge0 poll failed (${response.status}): ${text}`);
  }

  return (await response.json()) as Judge0Result;
};

/** Judge0 status ids: 1 In Queue, 2 Processing, >=3 terminal. */
const isTerminalStatus = (statusId?: number): boolean =>
  statusId !== undefined && statusId >= 3;

export const runSubmission = async (payload: Judge0Submission): Promise<Judge0Result> => {
  const token = await createSubmission(payload);
  let lastStatus = "unknown";

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const result = await getSubmission(token);
    const statusId = result.status?.id;
    lastStatus = result.status?.description ?? String(statusId ?? "none");

    if (isTerminalStatus(statusId)) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Judge0 execution timed out while polling (last status: ${lastStatus}). ` +
      "Ensure judge0 workers are running: cd judge0 && docker compose up -d"
  );
};

export const isJudge0Configured = (): boolean => Boolean(getJudge0BaseUrl());
