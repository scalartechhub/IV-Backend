import type { Judge0Result, Judge0Submission } from "./coding.types";
import { appConfig } from "../../config/app.config";
import { AppError } from "../../shared/utils";

const getJudge0BaseUrl = (): string => {
  const url = (appConfig.judge0Url || "").replace(/\/$/, "");
  if (!url) {
    throw new AppError(
      503,
      "Judge0 is not configured. Set JUDGE0_URL or Firestore config/judge0.url " +
        "(local: http://127.0.0.1:2358/). See judge0/README.md."
    );
  }
  return url;
};

/**
 * Judge0 memory_limit is in KB.
 * Must stay <= judge0 compose MAX_MEMORY_LIMIT (default 512000).
 * 256 MiB problems need 262144 KB, so the Judge0 cap cannot be 256000.
 */
export const JUDGE0_MAX_MEMORY_KB = 512000;
const MAX_MEMORY_KB = JUDGE0_MAX_MEMORY_KB;

/** Prefer wait=true (compose ENABLE_WAIT_RESULT=true). Poll is fallback only. */
const WAIT_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 90;

const judge0Headers = (extra?: Record<string, string>): Record<string, string> => {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const token = appConfig.judge0AuthToken;
  if (token) {
    headers["X-Auth-Token"] = token;
  }
  return headers;
};

const judge0Fetch = async (path: string, init?: RequestInit): Promise<Response> => {
  const url = `${getJudge0BaseUrl()}${path}`;
  const mergedHeaders = judge0Headers(
    init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined
  );

  try {
    return await fetch(url, {
      ...init,
      headers: mergedHeaders,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot reach Judge0 at ${getJudge0BaseUrl()}: ${detail}. ` +
        "Start it with: cd judge0 && docker compose up -d (API must be on 127.0.0.1 or a private URL)."
    );
  }
};

const clampMemoryKb = (memoryLimitKb?: number): number | undefined => {
  if (memoryLimitKb === undefined) {
    return undefined;
  }
  return Math.min(Math.max(1, memoryLimitKb), MAX_MEMORY_KB);
};

const withClampedBody = (payload: Judge0Submission): Judge0Submission => ({
  ...payload,
  memory_limit: clampMemoryKb(payload.memory_limit),
});

/** Judge0 status ids: 1 In Queue, 2 Processing, >=3 terminal. */
const isTerminalStatus = (statusId?: number): boolean =>
  statusId !== undefined && statusId >= 3;

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

const pollUntilDone = async (token: string): Promise<Judge0Result> => {
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
      "Workers may be stuck — run: npm run judge0:down && npm run judge0:up"
  );
};

/**
 * Execute one submission.
 * Uses wait=true first (blocks until workers finish). Falls back to async+poll
 * if the wait endpoint returns only a token / non-terminal status.
 */
export const runSubmission = async (payload: Judge0Submission): Promise<Judge0Result> => {
  const body = withClampedBody(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WAIT_TIMEOUT_MS);

  try {
    const response = await judge0Fetch(
      "/submissions?base64_encoded=false&wait=true",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Judge0 submission failed (${response.status}): ${text}`);
    }

    const result = (await response.json()) as Judge0Result;
    if (isTerminalStatus(result.status?.id)) {
      return result;
    }

    if (result.token) {
      return pollUntilDone(result.token);
    }

    throw new Error("Judge0 wait=true returned neither a terminal result nor a token");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "Judge0 execution timed out waiting for workers. " +
          "Restart workers: npm run judge0:down && npm run judge0:up"
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const isJudge0Configured = (): boolean => Boolean((appConfig.judge0Url || "").trim());
