/**
 * Email Service — Nodemailer-based email delivery.
 * Supports SMTP (Gmail, Google Workspace, custom SMTP) and simulated fallback for local development.
 */

import nodemailer, { Transporter } from 'nodemailer';
import { logger } from '../shared/logger';
import { firestoreConfigService } from '../config/firestore-config.service';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CandidateInviteEmailParams {
  candidateEmail: string;
  candidateName?: string;
  companyName: string;
  jobTitle: string;
  interviewLinkUrl: string;
  interviewType: string;
  durationMinutes: number;
  expiresAt?: string; // human-readable
}

interface EmailPayload {
  to: string;
  subject: string;
  text?: string;
  html: string;
  replyTo?: string;
}

// ─── Transporter Management ───────────────────────────────────────────────────

let transporter: Transporter | null = null;
let cachedFromEmail: string = 'noreply@interviewup.ai';
let activeConfigKey: string = '';

function parseSender(fromStr: string, defaultName = 'InterviewUp'): { name: string; address: string } {
  const match = fromStr.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].replace(/["']/g, '').trim() || defaultName,
      address: match[2].trim(),
    };
  }
  return { name: defaultName, address: fromStr.trim() };
}

function getTransporter(): { transport: Transporter | null; fromEmail: string } {
  const fsSmtp = firestoreConfigService.getSMTPConfig();
  const user = (fsSmtp.user || process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
  const pass = (fsSmtp.pass || process.env.SMTP_PASS || process.env.EMAIL_PASS || '').trim();
  const host = (fsSmtp.host || process.env.SMTP_HOST || (user.endsWith('@gmail.com') ? 'smtp.gmail.com' : '')).trim();
  const port = Number(fsSmtp.port || process.env.SMTP_PORT) || 465;
  const secure = fsSmtp.secure !== undefined ? fsSmtp.secure : (process.env.SMTP_SECURE === 'true' || port === 465);
  const from = (fsSmtp.from || process.env.SMTP_FROM || process.env.EMAIL_FROM || user || 'noreply@interviewup.ai').trim();

  cachedFromEmail = from;

  if (!user || !pass) {
    return { transport: null, fromEmail: cachedFromEmail };
  }

  const currentConfigKey = `${user}:${pass}:${host}:${port}:${secure}`;
  if (transporter && activeConfigKey !== currentConfigKey) {
    logger.info(`[EmailService] SMTP credentials updated in Firestore/env. Re-initializing transporter for ${user}...`);
    transporter = null;
  }

  if (!transporter) {
    const isGmail = host === 'smtp.gmail.com' || user.endsWith('@gmail.com');
    transporter = nodemailer.createTransport(
      isGmail && !process.env.SMTP_HOST && !fsSmtp.host
        ? {
            service: 'gmail',
            auth: { user, pass },
          }
        : {
            host: host || 'smtp.gmail.com',
            port,
            secure,
            auth: { user, pass },
          }
    );
    activeConfigKey = currentConfigKey;
    const source = fsSmtp.user ? 'Firestore (config/smtp)' : 'process.env';
    logger.info(`[EmailService] Nodemailer transporter initialized for ${user} (host: ${host || 'gmail'}, source: ${source})`);
  }

  return { transport: transporter, fromEmail: cachedFromEmail };
}

// ─── Core Send ─────────────────────────────────────────────────────────────────

async function sendEmail(payload: EmailPayload): Promise<string | undefined> {
  const { transport, fromEmail } = getTransporter();

  // If SMTP is not yet configured, log email to console and simulate success
  if (!transport) {
    const mockId = `simulated-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    logger.warn(`[EmailService] ⚠️ SMTP credentials not configured (set SMTP_USER and SMTP_PASS in .env).`);
    logger.info(`[EmailService] [SIMULATED EMAIL] To: ${payload.to} | Subject: "${payload.subject}" | mockId=${mockId}`);
    return mockId;
  }

  try {
    const sender = parseSender(fromEmail);
    const domain = sender.address.includes('@') ? sender.address.split('@')[1] : 'gmail.com';
    const cleanMessageId = `<${Date.now()}.${Math.random().toString(36).substring(2, 9)}@${domain}>`;

    const mailOptions: any = {
      from: {
        name: sender.name,
        address: sender.address,
      },
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      messageId: cleanMessageId,
      headers: {
        'X-Priority': '3',
        'Importance': 'normal',
      },
    };

    if (payload.replyTo) {
      mailOptions.replyTo = payload.replyTo;
    }

    const info = await transport.sendMail(mailOptions);

    logger.info(`[EmailService] Email delivered to ${payload.to} | messageId=${info.messageId}`);
    return info.messageId;
  } catch (error: any) {
    logger.error(`[EmailService] Failed to send email to ${payload.to}`, {
      code: error.code,
      message: error.message,
    });

    if (error.code === 'EAUTH') {
      throw new Error(
        'Email authentication failed. If using Gmail, make sure to generate and use a Google App Password (not your account password).'
      );
    }
    if (error.code === 'ESOCKET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      throw new Error(`Email server connection failed (${error.code}). Check your SMTP_HOST and SMTP_PORT.`);
    }

    throw new Error(`Email delivery failed: ${error.message}`);
  }
}

// ─── Candidate Invite Email ────────────────────────────────────────────────────

export async function sendCandidateInviteEmail(params: CandidateInviteEmailParams): Promise<string | undefined> {
  const greeting = params.candidateName ? `Hi ${params.candidateName}` : 'Hello';
  const expiryLine = params.expiresAt
    ? `<p style="margin:0 0 16px;color:#64748b;font-size:13px;">This invitation expires on <strong>${params.expiresAt}</strong></p>`
    : '';

  // Plain-text counterpart (crucial for spam score reduction)
  const text = `
${greeting},

You have been invited by ${params.companyName} to complete an interview assessment for the position of ${params.jobTitle}.

Assessment Summary:
• Position: ${params.jobTitle}
• Format: ${params.interviewType} Interview
• Estimated Duration: ${params.durationMinutes} minutes
${params.expiresAt ? `• Expiration: ${params.expiresAt}\n` : ''}
To start your interview, open the following link:
${params.interviewLinkUrl}

Please complete the assessment in a quiet environment with a working microphone and camera.

Best regards,
${params.companyName} Hiring Team & InterviewUp
InterviewUp • AI-Powered Talent Assessment Platform
  `.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Interview Assessment Invitation</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!-- Hidden Preheader Preview Text (prevents spam filters and email client snippet mess) -->
  <div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    You have been invited by ${params.companyName} to complete an assessment for ${params.jobTitle}.
  </div>

  <div style="max-width:600px;margin:30px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.05);border:1px solid #e2e8f0;">
    
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%);padding:28px 36px;">
      <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">InterviewUp</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.9);font-size:13px;font-weight:500;">Candidate Assessment Invitation</p>
    </div>
    
    <!-- Body -->
    <div style="padding:32px 36px;">
      <p style="margin:0 0 16px;color:#1e293b;font-size:15px;line-height:1.5;">${greeting},</p>
      
      <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">
        You have been invited by <strong style="color:#1e293b;">${params.companyName}</strong> to take an online interview assessment for the following position:
      </p>
      
      <!-- Role Card -->
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px 22px;margin:0 0 22px;">
        <h2 style="margin:0 0 8px;color:#1e293b;font-size:17px;font-weight:700;">${params.jobTitle}</h2>
        <div>
          <span style="display:inline-block;background:#ede9fe;color:#6d28d9;font-size:12px;font-weight:600;padding:3px 10px;border-radius:6px;margin-right:8px;">${params.interviewType}</span>
          <span style="display:inline-block;background:#f0f9ff;color:#0369a1;font-size:12px;font-weight:600;padding:3px 10px;border-radius:6px;">${params.durationMinutes} min</span>
        </div>
      </div>
      
      ${expiryLine}
      
      <!-- CTA Button -->
      <div style="text-align:center;margin:28px 0;">
        <a href="${params.interviewLinkUrl}" target="_blank" style="display:inline-block;background:#4F46E5;color:#ffffff;text-decoration:none;padding:13px 36px;border-radius:10px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
          Start Assessment
        </a>
      </div>
      
      <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.6;text-align:center;">
        If the button above does not work, copy and paste this link into your browser:<br>
        <a href="${params.interviewLinkUrl}" style="color:#4F46E5;word-break:break-all;">${params.interviewLinkUrl}</a>
      </p>
    </div>
    
    <!-- Footer compliant with CAN-SPAM best practices -->
    <div style="background:#f8fafc;padding:22px 36px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:600;">InterviewUp Talent Assessment</p>
      <p style="margin:0 0 6px;color:#94a3b8;font-size:11px;line-height:1.5;">
        You received this invitation because ${params.companyName} invited you to complete an assessment for the ${params.jobTitle} role.
      </p>
      <p style="margin:0 0 6px;color:#94a3b8;font-size:10px;line-height:1.4;">
        If you did not apply or believe you received this by mistake, please disregard this email.
      </p>
      <p style="margin:0;color:#94a3b8;font-size:10px;">
        © 2026 InterviewUp. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const candidatePrefix = params.candidateName?.trim() ? `${params.candidateName.trim()}, ` : '';
  const subject = `${candidatePrefix}Interview Invitation: ${params.jobTitle} - ${params.companyName}`;

  return sendEmail({
    to: params.candidateEmail,
    subject,
    text,
    html,
  });
}
