/**
 * Creates subscription plans in Razorpay Test Mode and updates:
 * 1. .env.dev
 * 2. Firestore 'config/razorpay' document (interview-89e09)
 * 3. Firestore 'plans' collection (interview-89e09)
 *
 * Usage:
 *   node scripts/create-razorpay-test-plans.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const admin = require('firebase-admin');

// 1. Read .env.dev
const envDevPath = path.resolve(__dirname, '..', '.env.dev');
const envContent = fs.readFileSync(envDevPath, 'utf8');

const keyId = envContent.match(/RAZORPAY_KEY_ID=([^\r\n]+)/)?.[1]?.trim();
const keySecret = envContent.match(/RAZORPAY_KEY_SECRET=([^\r\n]+)/)?.[1]?.trim();

if (!keyId || !keySecret) {
  console.error('❌ Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET in .env.dev');
  process.exit(1);
}

console.log(`🔑 Using Razorpay Key ID: ${keyId}`);

const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

function createRazorpayPlan(payload) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const req = https.request(
      'https://api.razorpay.com/v1/plans',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(data.error?.description || body));
            }
          } catch (e) {
            reject(new Error(body));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

const plansToCreate = [
  // INR Plans (Amount in paise)
  {
    key: 'proMonthlyPlanId',
    planId: 'pro_monthly',
    currency: 'INR',
    payload: {
      period: 'monthly',
      interval: 1,
      item: {
        name: 'Pro Monthly',
        amount: 79900, // ₹799.00
        currency: 'INR',
        description: 'Pro Plan Monthly Subscription (INR)',
      },
      notes: {
        planId: 'pro_monthly',
        currency: 'INR',
      },
    },
  },
  {
    key: 'proYearlyPlanId',
    planId: 'pro_yearly',
    currency: 'INR',
    payload: {
      period: 'yearly',
      interval: 1,
      item: {
        name: 'Pro Yearly',
        amount: 766800, // ₹7,668.00
        currency: 'INR',
        description: 'Pro Plan Yearly Subscription (INR)',
      },
      notes: {
        planId: 'pro_yearly',
        currency: 'INR',
      },
    },
  },
  {
    key: 'eliteMonthlyPlanId',
    planId: 'elite_monthly',
    currency: 'INR',
    payload: {
      period: 'monthly',
      interval: 1,
      item: {
        name: 'Elite Monthly',
        amount: 199900, // ₹1,999.00
        currency: 'INR',
        description: 'Elite Plan Monthly Subscription (INR)',
      },
      notes: {
        planId: 'elite_monthly',
        currency: 'INR',
      },
    },
  },
  {
    key: 'eliteYearlyPlanId',
    planId: 'elite_yearly',
    currency: 'INR',
    payload: {
      period: 'yearly',
      interval: 1,
      item: {
        name: 'Elite Yearly',
        amount: 1918800, // ₹19,188.00
        currency: 'INR',
        description: 'Elite Plan Yearly Subscription (INR)',
      },
      notes: {
        planId: 'elite_yearly',
        currency: 'INR',
      },
    },
  },
  // USD Plans (Amount in cents)
  {
    key: 'proMonthlyPlanIdUsd',
    planId: 'pro_monthly',
    currency: 'USD',
    payload: {
      period: 'monthly',
      interval: 1,
      item: {
        name: 'Pro Monthly USD',
        amount: 1000, // $10.00
        currency: 'USD',
        description: 'Pro Plan Monthly Subscription (USD)',
      },
      notes: {
        planId: 'pro_monthly',
        currency: 'USD',
      },
    },
  },
  {
    key: 'proYearlyPlanIdUsd',
    planId: 'pro_yearly',
    currency: 'USD',
    payload: {
      period: 'yearly',
      interval: 1,
      item: {
        name: 'Pro Yearly USD',
        amount: 8000, // $80.00
        currency: 'USD',
        description: 'Pro Plan Yearly Subscription (USD)',
      },
      notes: {
        planId: 'pro_yearly',
        currency: 'USD',
      },
    },
  },
  {
    key: 'eliteMonthlyPlanIdUsd',
    planId: 'elite_monthly',
    currency: 'USD',
    payload: {
      period: 'monthly',
      interval: 1,
      item: {
        name: 'Elite Monthly USD',
        amount: 2086, // $20.86
        currency: 'USD',
        description: 'Elite Plan Monthly Subscription (USD)',
      },
      notes: {
        planId: 'elite_monthly',
        currency: 'USD',
      },
    },
  },
  {
    key: 'eliteYearlyPlanIdUsd',
    planId: 'elite_yearly',
    currency: 'USD',
    payload: {
      period: 'yearly',
      interval: 1,
      item: {
        name: 'Elite Yearly USD',
        amount: 20000, // $200.00
        currency: 'USD',
        description: 'Elite Plan Yearly Subscription (USD)',
      },
      notes: {
        planId: 'elite_yearly',
        currency: 'USD',
      },
    },
  },
];

async function main() {
  console.log('\n🚀 Creating Razorpay Test Plans...\n');
  const createdMap = {};

  for (const p of plansToCreate) {
    try {
      const res = await createRazorpayPlan(p.payload);
      createdMap[p.key] = res.id;
      console.log(
        `  ✅ Created ${p.payload.item.name.padEnd(20)} (${p.currency}) -> ID: ${res.id} (${(p.payload.item.amount / 100).toFixed(2)} ${p.currency})`
      );
    } catch (err) {
      console.error(`  ❌ Failed creating ${p.payload.item.name}:`, err.message);
    }
  }

  console.log('\n📝 Summary of Created Test Plans:');
  console.log(JSON.stringify(createdMap, null, 2));

  // 2. Update .env.dev
  console.log('\n📝 Updating .env.dev...');
  let updatedEnv = fs.readFileSync(envDevPath, 'utf8');

  const envKeyMap = {
    proMonthlyPlanId: 'RAZORPAY_PRO_MONTHLY_PLAN_ID',
    proYearlyPlanId: 'RAZORPAY_PRO_YEARLY_PLAN_ID',
    eliteMonthlyPlanId: 'RAZORPAY_ELITE_MONTHLY_PLAN_ID',
    eliteYearlyPlanId: 'RAZORPAY_ELITE_YEARLY_PLAN_ID',
    proMonthlyPlanIdUsd: 'RAZORPAY_PRO_MONTHLY_PLAN_ID_USD',
    proYearlyPlanIdUsd: 'RAZORPAY_PRO_YEARLY_PLAN_ID_USD',
    eliteMonthlyPlanIdUsd: 'RAZORPAY_ELITE_MONTHLY_PLAN_ID_USD',
    eliteYearlyPlanIdUsd: 'RAZORPAY_ELITE_YEARLY_PLAN_ID_USD',
  };

  for (const [prop, envKey] of Object.entries(envKeyMap)) {
    const val = createdMap[prop];
    if (val) {
      const regex = new RegExp(`^${envKey}=.*$`, 'm');
      if (regex.test(updatedEnv)) {
        updatedEnv = updatedEnv.replace(regex, `${envKey}=${val}`);
      } else {
        updatedEnv += `\n${envKey}=${val}`;
      }
    }
  }

  fs.writeFileSync(envDevPath, updatedEnv, 'utf8');
  console.log('✅ .env.dev updated successfully!');

  // 3. Update Firestore (interview-89e09)
  console.log('\n🔥 Updating Firestore Dev (interview-89e09)...');
  const saCandidates = [
    path.resolve(__dirname, '..', 'firebase-service-account.interview-89e09.json'),
    path.resolve(__dirname, '..', 'firebase-service-account.dev.json'),
  ];
  const saPath = saCandidates.find((p) => fs.existsSync(p));
  if (!saPath) {
    console.error('❌ Service account file for dev not found.');
    process.exit(1);
  }

  const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  const app = admin.initializeApp(
    { credential: admin.credential.cert(sa), projectId: 'interview-89e09' },
    'dev-plans-creator'
  );
  const db = app.firestore();

  // Update config/razorpay
  await db.collection('config').doc('razorpay').set(createdMap, { merge: true });
  console.log('  ✅ Updated config/razorpay document');

  // Update plans collection
  const planUpdates = [
    {
      id: 'pro_monthly',
      razorpayPlanId: createdMap.proMonthlyPlanId,
      razorpayPlanIdUsd: createdMap.proMonthlyPlanIdUsd,
    },
    {
      id: 'pro_yearly',
      razorpayPlanId: createdMap.proYearlyPlanId,
      razorpayPlanIdUsd: createdMap.proYearlyPlanIdUsd,
    },
    {
      id: 'elite_monthly',
      razorpayPlanId: createdMap.eliteMonthlyPlanId,
      razorpayPlanIdUsd: createdMap.eliteMonthlyPlanIdUsd,
    },
    {
      id: 'elite_yearly',
      razorpayPlanId: createdMap.eliteYearlyPlanId,
      razorpayPlanIdUsd: createdMap.eliteYearlyPlanIdUsd,
    },
  ];

  for (const pu of planUpdates) {
    const updateObj = { updatedAt: new Date().toISOString() };
    if (pu.razorpayPlanId) updateObj.razorpayPlanId = pu.razorpayPlanId;
    if (pu.razorpayPlanIdUsd) updateObj.razorpayPlanIdUsd = pu.razorpayPlanIdUsd;
    await db.collection('plans').doc(pu.id).set(updateObj, { merge: true });
    console.log(`  ✅ Updated plans/${pu.id}`);
  }

  await app.delete();
  console.log('\n🎉 All test plans successfully created in Razorpay and synced to Firestore!');
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
