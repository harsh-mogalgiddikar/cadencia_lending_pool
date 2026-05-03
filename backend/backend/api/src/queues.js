/**
 * BullMQ Queue definitions — shared between API (enqueue) and workers (consume).
 *
 * Queue: oracle_tasks  — consumed by oracle-worker (single instance)
 * Queue: job_tasks     — consumed by job-worker (scalable)
 */

const { Queue } = require('bullmq');
const { getRedis } = require('./redis');

let oracleQueue = null;
let jobQueue = null;

function getOracleQueue() {
  if (!oracleQueue) {
    oracleQueue = new Queue('oracle_tasks', {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return oracleQueue;
}

function getJobQueue() {
  if (!jobQueue) {
    jobQueue = new Queue('job_tasks', {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 2000 },
      },
    });
  }
  return jobQueue;
}

module.exports = { getOracleQueue, getJobQueue };
