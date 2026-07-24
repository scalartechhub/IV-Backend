import sgMail from '@sendgrid/mail';
import { appConfig } from '../../config/app.config';
import { AppError } from '../../shared/utils';

export interface ContactFormData {
  fullName: string;
  email: string;
  subject: string;
  message: string;
}

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Initialises the SendGrid client once using the runtime API key.
 * Called lazily on the first send so that Firebase secrets are available.
 */
function getSgClient(): typeof sgMail {
  const apiKey = appConfig.sendgridApiKey ?? process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    throw new AppError(503, 'Email service is not configured. Please contact support.');
  }
  sgMail.setApiKey(apiKey);
  return sgMail;
}

const OWNER_EMAIL = 'ashishgupta95652@gmail.com';

export async function sendContactEmail(data: ContactFormData): Promise<void> {
  const client = getSgClient();

  const { fullName, email, subject, message } = data;
  const fromEmail = appConfig.sendgridFromEmail ?? process.env.SENDGRID_FROM_EMAIL;
  if (!fromEmail) {
    throw new AppError(503, 'Email sender is not configured. Please contact support.');
  }

  await client.send({
    to: OWNER_EMAIL,
    from: { email: fromEmail, name: 'Scalar Techhub' },
    replyTo: { email, name: fullName },
    subject: `Contact Form: ${esc(subject)}`,
    // Multipart (text + html) avoids content-based spam scoring
    text: `New contact form submission\n\nName: ${fullName}\nEmail: ${email}\nSubject: ${subject}\n\nMessage:\n${message}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #4c38dd; padding: 20px; border-radius: 8px 8px 0 0; color: white;">
          <h2 style="margin: 0;">${esc(subject)}</h2>
        </div>
        <div style="background: #f8f9fa; padding: 20px; border-radius: 0 0 8px 8px;">
          <p><strong>Name:</strong> ${esc(fullName)}</p>
          <p><strong>Email:</strong> <a href="mailto:${esc(email)}" style="color: #4c38dd;">${esc(email)}</a></p>
          <hr style="border: 0; border-top: 1px solid #ddd; margin: 15px 0;">
          <h3>Message:</h3>
          <p style="white-space: pre-wrap; line-height: 1.5;">${esc(message)}</p>
        </div>
      </div>
    `,
    categories: ['contact-form', 'transactional'],
    mailSettings: {
      bypassSpamManagement: { enable: true },
      bypassUnsubscribeManagement: { enable: true },
    },
  });
}
