/**
 * Job Worker — Cadencia CreditFlow
 *
 * Scalable BullMQ worker consuming "job_tasks" queue.
 * Handles background tasks that don't require blockchain signing:
 *
 *   NOTIFICATION_EMAIL    — Send email/webhook on loan events
 *   REPAYMENT_REMINDER    — 3-day-before-due reminders
 *   DEFAULT_CHECK         — Daily cron: scan active loans, flag overdue
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { Worker, Queue } = require('bullmq');
const Redis = require('ioredis');
const { createClient } = require('@supabase/supabase-js');

// ── Config ──

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// Reference to oracle queue for escalation
const oracleQueue = new Queue('oracle_tasks', { connection: redis });

// ── Job Processors ──

/**
 * NOTIFICATION_EMAIL: Dispatch notification for a loan event.
 * For MVP, logs to console. In production, integrates with SendGrid/Resend.
 */
async function handleNotification(data) {
  const { type, walletAddress, details } = data;
  console.log(`[Jobs] 📧 Notification: ${type} for ${walletAddress}`);
  console.log(`[Jobs]   Details: ${JSON.stringify(details)}`);

  // In production: call email API (SendGrid, Resend, etc.)
  // For MVP: log only
  return { notified: true, type, walletAddress };
}

/**
 * REPAYMENT_REMINDER: Send reminder for upcoming loan due date.
 */
async function handleRepaymentReminder(data) {
  const { loanId, walletAddress, dueDate } = data;
  console.log(`[Jobs] ⏰ Repayment reminder: loan=${loanId} due=${dueDate} borrower=${walletAddress}`);

  // In production: send email/push notification
  return { reminded: true, loanId };
}

/**
 * DEFAULT_CHECK: Scan active loans and flag overdue ones.
 * This is triggered by a cron schedule (daily).
 */
async function handleDefaultCheck() {
  console.log('[Jobs] 🔍 Running daily default check...');

  const { data: activeLoans, error } = await supabase
    .from('loan_applications')
    .select('*')
    .eq('status', 'active');

  if (error) {
    console.error('[Jobs] Default check query error:', error);
    throw error;
  }

  if (!activeLoans || activeLoans.length === 0) {
    console.log('[Jobs] No active loans to check');
    return { checked: 0, flagged: 0 };
  }

  let flagged = 0;
  const now = new Date();

  for (const loan of activeLoans) {
    // Calculate due date from creation + tenure
    const created = new Date(loan.created_at);
    const dueDate = new Date(created.getTime() + loan.tenure_days * 24 * 60 * 60 * 1000);

    if (now > dueDate) {
      // Loan is overdue — flag for oracle to mark as defaulted
      console.log(`[Jobs] ⚠️ Loan ${loan.id} is overdue (due: ${dueDate.toISOString()})`);

      await oracleQueue.add('SCORE_UPDATE', {
        address: loan.wallet_address,
        action: 'decrease',
        delta: 100, // DELTA_DEFAULT
        idempotencyKey: `default:${loan.id}:${Date.now()}`,
      });

      await supabase
        .from('loan_applications')
        .update({ status: 'defaulted' })
        .eq('id', loan.id);

      flagged++;
    } else {
      // Check if due within 3 days — send reminder
      const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      if (dueDate <= threeDaysFromNow) {
        console.log(`[Jobs] 📩 Loan ${loan.id} due soon: ${dueDate.toISOString()}`);
        // In production: enqueue notification
      }
    }
  }

  console.log(`[Jobs] Default check complete: ${activeLoans.length} checked, ${flagged} flagged`);
  return { checked: activeLoans.length, flagged };
}

// ── Worker Setup ──

const worker = new Worker(
  'job_tasks',
  async (job) => {
    console.log(`[Jobs] Processing: ${job.name} (id=${job.id})`);

    switch (job.name) {
      case 'NOTIFICATION_EMAIL':
        return await handleNotification(job.data);

      case 'REPAYMENT_REMINDER':
        return await handleRepaymentReminder(job.data);

      case 'DEFAULT_CHECK':
        return await handleDefaultCheck();

      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection: redis,
    concurrency: 5, // Scalable — no blockchain signing
  }
);

worker.on('completed', (job, result) => {
  console.log(`[Jobs] ✅ ${job.name} (${job.id}) completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Jobs] ❌ ${job.name} (${job.id}) failed: ${err.message}`);
});

worker.on('error', (err) => {
  console.error('[Jobs] Worker error:', err.message);
});

// ── Cron: Daily default check ──

const { Queue: CronQueue } = require('bullmq');
const jobQueue = new CronQueue('job_tasks', { connection: redis });

// Schedule daily default check at midnight
jobQueue.add('DEFAULT_CHECK', {}, {
  repeat: {
    pattern: '0 0 * * *', // Every day at midnight
  },
  jobId: 'daily-default-check',
});

console.log('[Jobs] Worker started — listening on job_tasks queue');
console.log('[Jobs] Cron: daily default check scheduled at midnight');
