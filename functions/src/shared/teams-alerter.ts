/**
 * teams-alerter.ts  (now backed by Discord Incoming Webhook)
 *
 * Sends error alert notifications to a Discord channel via an Incoming
 * Webhook URL stored in the DISCORD_WEBHOOK_URL environment variable.
 *
 * - Only fires in production unless TEAMS_ALERT_IN_DEV=true is set.
 * - Fire-and-forget: errors are logged but never re-thrown so alerting
 *   never breaks the primary request/function flow.
 *
 * Discord webhook format reference:
 * https://discord.com/developers/docs/resources/webhook#execute-webhook
 */

import { logger } from './logger';
import { firestoreConfigService } from '../config/firestore-config.service';

function getDiscordWebhookUrl(): string | undefined {
  return (
    firestoreConfigService.getDiscordConfig().webhookUrl ||
    process.env.DISCORD_WEBHOOK_URL
  )?.trim();
}

const TEAMS_ALERT_IN_DEV = process.env.TEAMS_ALERT_IN_DEV === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MAX_STACK_LENGTH = 1000;
const FIREBASE_CONSOLE_URL =
  'https://console.firebase.google.com/project/interview-prod-dd24f/functions/logs';

/** Discord embed color: red for errors */
const COLOR_ERROR = 0xe74c3c;

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n… (truncated)';
}

interface AlertOptions {
  /** Human-readable name: function name or "POST /v2/interviews/start" */
  context: string;
  error: Error | unknown;
  /** Extra key-value pairs to surface as embed fields */
  extras?: Record<string, string>;
}

/**
 * Builds a Discord webhook payload with a rich embed card.
 */
function buildPayload(opts: AlertOptions): Record<string, unknown> {
  const err = opts.error instanceof Error ? opts.error : null;
  const message = err?.message ?? String(opts.error);
  const stack = err?.stack ? truncate(err.stack, MAX_STACK_LENGTH) : 'No stack trace available';
  const env = IS_PRODUCTION ? '🔴 Production' : '🟡 Development';
  const timestamp = new Date().toISOString();

  const extraFields = opts.extras
    ? Object.entries(opts.extras).map(([name, value]) => ({
        name,
        value: `\`${value}\``,
        inline: true,
      }))
    : [];

  return {
    username: 'IV Backend Alerts',
    embeds: [
      {
        title: '🚨 Function Failure Detected',
        color: COLOR_ERROR,
        timestamp,
        fields: [
          {
            name: '📍 Context',
            value: `\`${opts.context}\``,
            inline: true,
          },
          {
            name: '🌍 Environment',
            value: env,
            inline: true,
          },
          ...extraFields,
          {
            name: '❌ Error Message',
            value: truncate(message, 300),
            inline: false,
          },
          {
            name: '📋 Stack Trace',
            value: `\`\`\`\n${stack}\n\`\`\``,
            inline: false,
          },
        ],
        footer: {
          text: 'IV-Backend • Firebase Functions',
        },
        url: FIREBASE_CONSOLE_URL,
      },
    ],
  };
}

/**
 * Sends an error alert to the configured Discord channel.
 * Safe to call from anywhere — never throws.
 */
export async function notify(opts: AlertOptions): Promise<void> {
  const webhookUrl = getDiscordWebhookUrl();

  if (!webhookUrl) {
    logger.debug('[alerter] DISCORD_WEBHOOK_URL not configured — skipping alert');
    return;
  }

  if (!IS_PRODUCTION && !TEAMS_ALERT_IN_DEV) {
    logger.debug('[alerter] Skipping alert in non-production environment');
    return;
  }

  try {
    const payload = buildPayload(opts);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn(`[alerter] Discord webhook returned ${response.status}: ${body}`);
    } else {
      logger.info(`[alerter] Discord alert sent for: ${opts.context}`);
    }
  } catch (sendError) {
    // Never let alerting crash the process
    logger.warn('[alerter] Failed to send Discord alert', sendError);
  }
}
