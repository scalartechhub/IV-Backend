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
    amount: 799,
    displayPrice: 8.34,
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
    amount: 7668,
    displayPrice: 6.67,
    displayPeriod: "month",
    annualAmount: 80,
    discountPercent: 20,
    monthlyInterviewLimit: 15,
    monthlyResumeAnalysisLimit: 3,
    billingDescription: "Billed annually at $80/year (Save 20%).",
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
    amount: 1999,
    displayPrice: 20.86,
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
    amount: 19188,
    displayPrice: 16.68,
    displayPeriod: "month",
    annualAmount: 200.19,
    discountPercent: 20,
    monthlyInterviewLimit: null, // Unlimited
    monthlyResumeAnalysisLimit: null, // Unlimited
    billingDescription: "Billed annually at $200.19/year (Save 20%).",
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

  const planKeyUpperMap = {
    pro_monthly: "RAZORPAY_PRO_MONTHLY_PLAN_ID",
    pro_yearly: "RAZORPAY_PRO_YEARLY_PLAN_ID",
    elite_monthly: "RAZORPAY_ELITE_MONTHLY_PLAN_ID",
    elite_yearly: "RAZORPAY_ELITE_YEARLY_PLAN_ID",
  };

  for (const plan of plans) {
    const docRef = db.collection("plans").doc(plan.id);
    const existingSnap = await docRef.get();
    const existingData = existingSnap.exists ? existingSnap.data() : {};

    const camelKey = planKeyCamelMap[plan.id];
    const upperKey = planKeyUpperMap[plan.id];
    const configPlanId = camelKey ? (rzpConfig[camelKey] || rzpConfig[upperKey]) : undefined;

    // Prioritize ID from config/razorpay so updates in config take effect; fall back to existing data if unset in config
    const razorpayPlanId =
      configPlanId && String(configPlanId).trim()
        ? String(configPlanId).trim()
        : (existingData?.razorpayPlanId || undefined);

    const dataToSave = {
      ...plan,
      updatedAt: new Date().toISOString(),
    };

    if (razorpayPlanId) {
      dataToSave.razorpayPlanId = razorpayPlanId;
    }

    await docRef.set(dataToSave, { merge: true });

    const sourceLabel =
      configPlanId && String(configPlanId).trim()
        ? "from config/razorpay"
        : existingData?.razorpayPlanId
        ? "from existing plan"
        : "not configured";

    console.log(
      `  ✅ plans/${plan.id.padEnd(14)} — ${plan.name.padEnd(5)} (${plan.billingCycle.padEnd(7)}) | Razorpay Plan: ${(razorpayPlanId || "(none)").padEnd(24)} [${sourceLabel}]`
    );
  }

  console.log("\n✅ All plans seeded and updated successfully in Firestore!");
  process.exit(0);
}

seedPlans().catch((err) => {
  console.error("❌ Seeding failed:", err.message);
  process.exit(1);
});
