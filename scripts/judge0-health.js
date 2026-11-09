/**
 * Cross-platform Judge0 health check.
 * Usage: node scripts/judge0-health.js [baseUrl]
 */
const baseUrl = (process.argv[2] || process.env.JUDGE0_URL || "http://127.0.0.1:2358").replace(
  /\/$/,
  ""
);
const authToken = process.env.JUDGE0_AUTH_TOKEN || "";

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  ...(authToken ? { "X-Auth-Token": authToken } : {}),
};

async function main() {
  console.log(`Checking Judge0 at ${baseUrl} ...`);

  const aboutRes = await fetch(`${baseUrl}/about`, { headers });
  if (!aboutRes.ok) {
    throw new Error(`GET /about failed (${aboutRes.status}): ${await aboutRes.text()}`);
  }
  console.log("about:", await aboutRes.text());

  const submitRes = await fetch(`${baseUrl}/submissions?base64_encoded=false&wait=true`, {
    method: "POST",
    headers,
    body: JSON.stringify({ source_code: "print(42)", language_id: 71 }),
  });
  const bodyText = await submitRes.text();
  if (!submitRes.ok) {
    throw new Error(`POST /submissions failed (${submitRes.status}): ${bodyText}`);
  }

  const result = JSON.parse(bodyText);
  console.log("submission:", bodyText);
  if (result?.status?.description !== "Accepted") {
    throw new Error(`Expected Accepted, got ${result?.status?.description ?? "unknown"}`);
  }
  console.log("OK — Judge0 is healthy");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
