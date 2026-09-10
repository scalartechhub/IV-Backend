/**
 * Seeds the Firestore `plans` collection with all subscription plans.
 *
 * Usage:
 *   node scripts/seed-plans.js
 *
 * NOTE: razorpayPlanId must be updated manually after creating plans in the
 *       Razorpay Dashboard (Test Mode → Subscriptions → Plans).
 */

const admin = require("firebase-admin");
const path = require("path");

// Initialize Firebase Admin
const serviceAccountPath = path.resolve(__dirname, "..", "firebase-service-account.json");
admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

const db = admin.firestore();

const plans = [
  {
    id: "free",
    name: "Free",
    billingCycle: "none",
    currency: "USD",
    amount: 0,
    displayPrice: 0,
    displayPeriod: "month",
    discountPercent: 0,
    description: "Get started with AI-powered interview practice.",
    active: true,
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
    currency: "USD",
    amount: 6.26,
    displayPrice: 6.26,
    displayPeriod: "month",
    discountPercent: 0,
    description: "Everything you need to get interview-ready.",
    razorpayPlanId: "",  // Set after creating in Razorpay Dashboard
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
    currency: "USD",
    amount: 60.12,
    displayPrice: 5.01,
    displayPeriod: "month",
    annualAmount: 60.12,
    discountPercent: 20,
    billingDescription: "Billed annually",
    description: "Everything you need to get interview-ready.",
    razorpayPlanId: "",  // Set after creating in Razorpay Dashboard
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
    currency: "USD",
    amount: 10.86,
    displayPrice: 10.86,
    displayPeriod: "month",
    discountPercent: 0,
    description: "Maximum preparation with all premium features.",
    razorpayPlanId: "",  // Set after creating in Razorpay Dashboard
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
    currency: "USD",
    amount: 104.26,
    displayPrice: 8.69,
    displayPeriod: "month",
    annualAmount: 104.26,
    discountPercent: 20,
    billingDescription: "Billed annually",
    description: "Maximum preparation with all premium features.",
    razorpayPlanId: "",  // Set after creating in Razorpay Dashboard
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

async function seedPlans() {
  console.log("🌱 Seeding plans collection...\n");

  const batch = db.batch();

  for (const plan of plans) {
    const ref = db.collection("plans").doc(plan.id);
    batch.set(ref, plan, { merge: true });
    console.log(`  ✅ plans/${plan.id} — ${plan.name} (${plan.billingCycle})`);
  }

  await batch.commit();

  console.log("\n✅ All plans seeded successfully!");
  console.log("\n⚠️  IMPORTANT: Update razorpayPlanId for paid plans after creating");
  console.log("   subscription plans in the Razorpay Dashboard.");
  console.log("   Firestore path: plans/{planId}.razorpayPlanId\n");

  process.exit(0);
}

seedPlans().catch((err) => {
  console.error("❌ Seeding failed:", err.message);
  process.exit(1);
});
