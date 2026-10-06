/**
 * Seeds the Firestore `plans` collection with all subscription plans.
 *
 * Usage:
 *   node scripts/seed-plans.js
 *   OR from root: npm run seed:plans
 *
 * NOTE: Preserves existing razorpayPlanId if already present in Firestore.
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

// Determine environment and target project
const args = process.argv.slice(2);
const envArg = args.find((a) => a.startsWith("--env="))?.split("=")[1] || process.env.APP_ENV;

// Load environment variables from corresponding .env file
let envFile = ".env";
if (envArg === "dev" || envArg === "development") {
  envFile = ".env.dev";
} else if (envArg === "prod" || envArg === "production") {
  envFile = ".env.production";
}
let envPath = path.resolve(__dirname, "..", envFile);
if (!fs.existsSync(envPath)) {
  envPath = path.resolve(__dirname, "..", ".env");
}
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

let targetProjectId = envArg === "dev" ? "interview-89e09" : (process.env.FB_PROJECT_ID || process.env.FIREBASE_PROJECT_ID);

const saCandidates = [
  targetProjectId ? path.resolve(__dirname, "..", `firebase-service-account.${targetProjectId}.json`) : null,
  targetProjectId === "interview-89e09" ? path.resolve(__dirname, "..", "firebase-service-account.dev.json") : null,
  process.env.GOOGLE_APPLICATION_CREDENTIALS,
  path.resolve(__dirname, "..", "firebase-service-account.json"),
  path.resolve(__dirname, "..", "service-account.json"),
].filter(Boolean);

let saPath = null;
let serviceAccount = null;

for (const p of saCandidates) {
  if (fs.existsSync(p)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
      const saProjectId = parsed.projectId || parsed.project_id;
      if (!targetProjectId || !saProjectId || saProjectId === targetProjectId) {
        saPath = p;
        serviceAccount = parsed;
        break;
      }
    } catch {}
  }
}

if (serviceAccount) {
  console.log(`[SeedPlans] Using service account (${saPath}) for project: ${serviceAccount.project_id}`);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
} else {
  console.log(`[SeedPlans] Initializing for project: ${targetProjectId || "default"} using application credentials...`);
  admin.initializeApp({
    ...(targetProjectId && { projectId: targetProjectId }),
  });
}

const db = admin.firestore();

const plans = [
  {
    id: "free",
    name: "Free",
    billingCycle: "none",
    currency: "INR",
    amount: 0,
    amountInr: 0,
    displayPriceInr: 0,
    annualAmountInr: null,
    amountUsd: 0,
    displayPriceUsd: 0,
    annualAmountUsd: null,
    displayPrice: 0,
    displayPeriod: "month",
    discountPercent: 0,
    monthlyInterviewLimit: 3,
    monthlyResumeAnalysisLimit: 1,
    description: "Get started with AI-powered interview practice.",
    active: true,
    features: [
      "3 AI interviews / month",
      "1 Resume analysis / month",
      "Basic interview feedback",
      "Standard support",
    ],
  },
  {
    id: "pro_monthly",
    name: "Pro",
    billingCycle: "monthly",
    currency: "INR",
    // INR Configuration (₹799/mo)
    amountInr: 799,
    displayPriceInr: 799,
    annualAmountInr: null,
    // USD Configuration ($10/mo)
    amountUsd: 10,
    displayPriceUsd: 10,
    annualAmountUsd: null,
    amount: 799,
    displayPrice: 799,
    displayPeriod: "month",
    discountPercent: 0,
    monthlyInterviewLimit: 15,
    monthlyResumeAnalysisLimit: 3,
    billingDescription: "Billed monthly. Cancel anytime.",
    description: "Perfect for active job seekers preparing for multiple rounds.",
    active: true,
    features: [
      "15 AI interviews / month",
      "3 Resume analyses / month",
      "Full AI learning roadmap",
      "Career progress tracking",
      "Nearby companies & company prep",
      "Comprehensive performance reports",
    ],
  },
  {
    id: "pro_yearly",
    name: "Pro",
    billingCycle: "yearly",
    currency: "INR",
    // INR Configuration (₹7,668/year -> ₹639/mo, Save 20%)
    amountInr: 7668,
    displayPriceInr: 639,
    annualAmountInr: 7668,
    // USD Configuration ($80/year -> $6.67/mo, Save 20%)
    amountUsd: 80,
    displayPriceUsd: 6.67,
    annualAmountUsd: 80,
    amount: 7668,
    displayPrice: 639,
    annualAmount: 7668,
    displayPeriod: "month",
    discountPercent: 20,
    monthlyInterviewLimit: 15,
    monthlyResumeAnalysisLimit: 3,
    billingDescription: "Billed annually (Save 20%).",
    description: "Perfect for active job seekers preparing for multiple rounds.",
    active: true,
    features: [
      "15 AI interviews / month",
      "3 Resume analyses / month",
      "Full AI learning roadmap",
      "Career progress tracking",
      "Nearby companies & company prep",
      "Comprehensive performance reports",
    ],
  },
  {
    id: "elite_monthly",
    name: "Elite",
    billingCycle: "monthly",
    currency: "INR",
    // INR Configuration (₹1,999/mo)
    amountInr: 1999,
    displayPriceInr: 1999,
    annualAmountInr: null,
    // USD Configuration ($20.86/mo)
    amountUsd: 20.86,
    displayPriceUsd: 20.86,
    annualAmountUsd: null,
    amount: 1999,
    displayPrice: 1999,
    displayPeriod: "month",
    discountPercent: 0,
    monthlyInterviewLimit: null, // Unlimited
    monthlyResumeAnalysisLimit: null, // Unlimited
    billingDescription: "Billed monthly. Cancel anytime.",
    description: "For professionals aiming for top-tier tech and leadership roles.",
    active: true,
    features: [
      "Unlimited AI interviews",
      "Unlimited Resume analyses",
      "Everything in Pro",
      "System design & architecture interviews",
      "Leadership & behavioral deep dives",
      "Executive career coach insights",
      "Priority early access & 24/7 support",
    ],
  },
  {
    id: "elite_yearly",
    name: "Elite",
    billingCycle: "yearly",
    currency: "INR",
    // INR Configuration (₹19,188/year -> ₹1,599/mo, Save 20%)
    amountInr: 19188,
    displayPriceInr: 1599,
    annualAmountInr: 19188,
    // USD Configuration ($200/year -> $16.67/mo, Save 20%)
    amountUsd: 200,
    displayPriceUsd: 16.67,
    annualAmountUsd: 200,
    amount: 19188,
    displayPrice: 1599,
    annualAmount: 19188,
    displayPeriod: "month",
    discountPercent: 20,
    monthlyInterviewLimit: null, // Unlimited
    monthlyResumeAnalysisLimit: null, // Unlimited
    billingDescription: "Billed annually (Save 20%).",
    description: "For professionals aiming for top-tier tech and leadership roles.",
    active: true,
    features: [
      "Unlimited AI interviews",
      "Unlimited Resume analyses",
      "Everything in Pro",
      "System design & architecture interviews",
      "Leadership & behavioral deep dives",
      "Executive career coach insights",
      "Priority early access & 24/7 support",
    ],
  },
];

async function seedPlans() {
  console.log("🌱 Seeding/Updating Firestore plans collection...\n");
  console.log("Reading configuration from Firestore collection 'config', document 'razorpay'...\n");

  const rzpConfigDoc = await db.collection("config").doc("razorpay").get();
  const rzpConfig = rzpConfigDoc.exists ? rzpConfigDoc.data() : {};

  const planKeyCamelMap = {
    pro_monthly: "proMonthlyPlanId",
    pro_yearly: "proYearlyPlanId",
    elite_monthly: "eliteMonthlyPlanId",
    elite_yearly: "eliteYearlyPlanId",
  };

  const planKeyCamelMapUsd = {
    pro_monthly: "proMonthlyPlanIdUsd",
    pro_yearly: "proYearlyPlanIdUsd",
    elite_monthly: "eliteMonthlyPlanIdUsd",
    elite_yearly: "eliteYearlyPlanIdUsd",
  };

  for (const plan of plans) {
    const docRef = db.collection("plans").doc(plan.id);
    const existingSnap = await docRef.get();
    const existingData = existingSnap.exists ? existingSnap.data() : {};

    const inrKey = planKeyCamelMap[plan.id];
    const usdKey = planKeyCamelMapUsd[plan.id];

    const configInrPlanId = inrKey ? (rzpConfig[inrKey] || rzpConfig[inrKey.toUpperCase()]) : undefined;
    const configUsdPlanId = usdKey ? (rzpConfig[usdKey] || rzpConfig[usdKey.toUpperCase()]) : undefined;

    // INR Razorpay plan ID
    const razorpayPlanId =
      configInrPlanId && String(configInrPlanId).trim()
        ? String(configInrPlanId).trim()
        : existingData?.razorpayPlanId && !String(existingData.razorpayPlanId).includes("Usd")
        ? existingData.razorpayPlanId
        : undefined;

    // USD Razorpay plan ID
    const razorpayPlanIdUsd =
      configUsdPlanId && String(configUsdPlanId).trim()
        ? String(configUsdPlanId).trim()
        : existingData?.razorpayPlanIdUsd || undefined;

    const dataToSave = {
      ...plan,
      amountInr: plan.amountInr,
      displayPriceInr: plan.displayPriceInr,
      annualAmountInr: plan.annualAmountInr,
      amountUsd: plan.amountUsd,
      displayPriceUsd: plan.displayPriceUsd,
      annualAmountUsd: plan.annualAmountUsd,
      updatedAt: new Date().toISOString(),
    };

    if (razorpayPlanId) {
      dataToSave.razorpayPlanId = razorpayPlanId;
    }
    if (razorpayPlanIdUsd) {
      dataToSave.razorpayPlanIdUsd = razorpayPlanIdUsd;
    }

    const cleanData = {};
    for (const [k, v] of Object.entries(dataToSave)) {
      if (v !== undefined) {
        cleanData[k] = v;
      }
    }

    await docRef.set(cleanData, { merge: true });

    console.log(
      `  ✅ plans/${plan.id.padEnd(14)} — ${plan.name.padEnd(5)} (${plan.billingCycle.padEnd(7)}) | INR Plan: ${(razorpayPlanId || "(none)").padEnd(22)} | USD Plan: ${(razorpayPlanIdUsd || "(none)").padEnd(22)}`
    );
  }

  console.log("\n✅ All plans seeded and updated successfully in Firestore!");
  process.exit(0);
}

seedPlans().catch((err) => {
  console.error("❌ Seeding failed:", err.message);
  process.exit(1);
});
