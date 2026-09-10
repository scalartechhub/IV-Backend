/**
 * Automatically creates subscription plans in Razorpay (INR)
 * and links their razorpayPlanId into the Firestore `plans` collection.
 *
 * Usage:
 *   node scripts/setup-razorpay-plans.js
 */

const path = require("path");
const functionsNodeModules = path.resolve(__dirname, "..", "functions", "node_modules");
require(path.join(functionsNodeModules, "dotenv")).config({ path: path.resolve(__dirname, "..", ".env") });
const Razorpay = require(path.join(functionsNodeModules, "razorpay"));
const admin = require(path.join(functionsNodeModules, "firebase-admin"));

// Initialize Firebase Admin
const serviceAccountPath = path.resolve(__dirname, "..", "firebase-service-account.json");
admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});
const db = admin.firestore();

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const planConfigs = [
  {
    id: "free",
    name: "Free",
    billingCycle: "none",
    currency: "INR",
    amount: 0,
    displayPrice: 0,
    displayPeriod: "month",
    discountPercent: 0,
    description: "Get started with AI-powered interview practice.",
    active: true,
    razorpayPlanId: null,
    features: [
      "3 AI interviews / month",
      "Basic resume analysis",
      "Limited coding practice",
      "Basic learning roadmap",
      "Basic career progress",
    ],
  },
  {
    id: "pro_monthly",
    name: "Pro",
    billingCycle: "monthly",
    period: "monthly",
    interval: 1,
    currency: "INR",
    amount: 499,
    amountInPaise: 49900,
    displayPrice: 499,
    displayPeriod: "month",
    discountPercent: 0,
    description: "Everything you need to get interview-ready.",
    active: true,
    features: [
      "Unlimited AI interviews",
      "Advanced resume analysis",
      "ATS scan",
      "Unlimited coding practice",
      "Company preparation",
      "Personalized roadmap",
      "Interview reports",
      "AI Career Coach",
    ],
  },
  {
    id: "pro_yearly",
    name: "Pro",
    billingCycle: "yearly",
    period: "yearly",
    interval: 1,
    currency: "INR",
    amount: 4788,
    amountInPaise: 478800,
    displayPrice: 399,
    annualAmount: 4788,
    displayPeriod: "month",
    discountPercent: 20,
    description: "Everything you need to get interview-ready.",
    billingDescription: "Billed annually (₹4,788/yr)",
    active: true,
    features: [
      "Unlimited AI interviews",
      "Advanced resume analysis",
      "ATS scan",
      "Unlimited coding practice",
      "Company preparation",
      "Personalized roadmap",
      "Interview reports",
      "AI Career Coach",
    ],
  },
  {
    id: "elite_monthly",
    name: "Elite",
    billingCycle: "monthly",
    period: "monthly",
    interval: 1,
    currency: "INR",
    amount: 899,
    amountInPaise: 89900,
    displayPrice: 899,
    displayPeriod: "month",
    discountPercent: 0,
    description: "Maximum preparation with all premium features.",
    active: true,
    features: [
      "Everything in Pro",
      "Custom company mock interviews",
      "System design interviews",
      "Behavioral interview prep",
      "Job match insights",
      "Early access to features",
      "Priority support",
    ],
  },
  {
    id: "elite_yearly",
    name: "Elite",
    billingCycle: "yearly",
    period: "yearly",
    interval: 1,
    currency: "INR",
    amount: 8628,
    amountInPaise: 862800,
    displayPrice: 719,
    annualAmount: 8628,
    displayPeriod: "month",
    discountPercent: 20,
    description: "Maximum preparation with all premium features.",
    billingDescription: "Billed annually (₹8,628/yr)",
    active: true,
    features: [
      "Everything in Pro",
      "Custom company mock interviews",
      "System design interviews",
      "Behavioral interview prep",
      "Job match insights",
      "Early access to features",
      "Priority support",
    ],
  },
];

async function main() {
  console.log("🚀 Setting up Razorpay plans and syncing with Firestore...\n");

  for (const config of planConfigs) {
    let rzpPlanId = config.razorpayPlanId;

    if (config.billingCycle !== "none" && config.amountInPaise) {
      console.log(`Creating Razorpay plan for ${config.id} (${config.name} ${config.billingCycle})...`);
      try {
        const rzpPlan = await razorpay.plans.create({
          period: config.period,
          interval: config.interval || 1,
          item: {
            name: `${config.name} (${config.billingCycle === "yearly" ? "Yearly" : "Monthly"})`,
            amount: config.amountInPaise,
            currency: config.currency,
            description: config.description,
          },
        });
        rzpPlanId = rzpPlan.id;
        console.log(`  ✅ Razorpay plan created: ${rzpPlanId}`);
      } catch (err) {
        console.error(`  ❌ Failed to create Razorpay plan for ${config.id}:`, err.message || err);
        continue;
      }
    }

    const { amountInPaise, period, interval, ...firestoreDoc } = config;
    if (rzpPlanId) {
      firestoreDoc.razorpayPlanId = rzpPlanId;
    }

    await db.collection("plans").doc(config.id).set(firestoreDoc, { merge: true });
    console.log(`  ✅ Firestore plans/${config.id} updated successfully.\n`);
  }

  console.log("🎉 All plans configured in Razorpay and synced to Firestore!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
