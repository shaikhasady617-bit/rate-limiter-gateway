const { redis } = require("../config/redis");
const prisma = require("../config/db");

const STREAM_KEY = "api:logs";
const GROUP_NAME = "log-workers";
const CONSUMER_NAME = "worker-1";
const BATCH_SIZE = parseInt(process.env.LOG_BATCH_SIZE, 10) || 50;
const FLUSH_INTERVAL = parseInt(process.env.LOG_FLUSH_INTERVAL_MS, 10) || 5000;

async function ensureConsumerGroup() {
  try {
    await redis.xgroup("CREATE", STREAM_KEY, GROUP_NAME, "0", "MKSTREAM");
    console.log(`Consumer group "${GROUP_NAME}" created`);
  } catch (err) {
    if (err.message.includes("BUSYGROUP")) {
      console.log(`Consumer group "${GROUP_NAME}" already exists`);
    } else {
      throw err;
    }
  }
}

async function processBatch() {
  try {
    const results = await redis.xreadgroup(
      "GROUP", GROUP_NAME, CONSUMER_NAME,
      "COUNT", BATCH_SIZE,
      "BLOCK", 2000,
      "STREAMS", STREAM_KEY, ">"
    );

    if (!results || results.length === 0) return;

    const messages = results[0][1];
    const logs = [];
    const ackIds = [];

    for (const [id, fields] of messages) {
      const entry = {};
      for (let i = 0; i < fields.length; i += 2) {
        entry[fields[i]] = fields[i + 1];
      }

      logs.push({
        ip: entry.ip,
        endpoint: entry.endpoint,
        statusCode: parseInt(entry.statusCode, 10),
        responseTime: parseInt(entry.responseTime, 10),
      });
      ackIds.push(id);
    }

    if (logs.length > 0) {
      await prisma.requestLog.createMany({ data: logs });
      await redis.xack(STREAM_KEY, GROUP_NAME, ...ackIds);
      console.log(`Flushed ${logs.length} log(s) to PostgreSQL`);
    }
  } catch (err) {
    console.error("Analytics worker error:", err.message);
  }
}

async function startAnalyticsWorker() {
  await ensureConsumerGroup();
  console.log(`Analytics worker started (flush every ${FLUSH_INTERVAL}ms, batch ${BATCH_SIZE})`);
  processBatch();
  setInterval(processBatch, FLUSH_INTERVAL);
}

module.exports = { startAnalyticsWorker };
