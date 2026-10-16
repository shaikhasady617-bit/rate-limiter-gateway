const { redis, publisher } = require("../config/redis");
const crypto = require("crypto");

const WINDOW_SEC = parseInt(process.env.RATE_LIMIT_WINDOW_SEC, 10) || 60;
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100;
const WINDOW_MS = WINDOW_SEC * 1000;
const STREAM_KEY = "api:logs";
const TELEMETRY_CHANNEL = "telemetry:events";

function rateLimiter(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress;
  const key = `rl:${ip}`;
  const now = Date.now();
  const requestId = `${now}:${crypto.randomBytes(4).toString("hex")}`;
  const startTime = process.hrtime.bigint();

  redis
    .slidingWindow(key, now, WINDOW_MS, MAX_REQUESTS, requestId)
    .then(([allowed, count]) => {
      res.set("X-RateLimit-Limit", String(MAX_REQUESTS));
      res.set("X-RateLimit-Remaining", String(Math.max(0, MAX_REQUESTS - count)));

      if (!allowed) {
        publishTelemetry("blocked", { ip, endpoint: req.path });
        return res.status(429).json({
          error: "Too Many Requests",
          retryAfterSec: WINDOW_SEC,
        });
      }

      res.on("finish", () => {
        const elapsed = Number(process.hrtime.bigint() - startTime) / 1e6;
        logToStream(ip, req.path, res.statusCode, Math.round(elapsed));
        publishTelemetry("allowed", { ip, endpoint: req.path });
      });

      next();
    })
    .catch((err) => {
      console.error("Rate limiter Redis error (fail-open):", err.message);
      next();
    });
}

function logToStream(ip, endpoint, statusCode, responseTime) {
  redis
    .xadd(STREAM_KEY, "*", "ip", ip, "endpoint", endpoint, "statusCode", String(statusCode), "responseTime", String(responseTime))
    .catch((err) => console.error("Stream log error:", err.message));
}

function publishTelemetry(type, data) {
  const payload = JSON.stringify({ type, ...data, timestamp: Date.now() });
  publisher
    .publish(TELEMETRY_CHANNEL, payload)
    .catch((err) => console.error("Pub/Sub publish error:", err.message));
}

module.exports = rateLimiter;
