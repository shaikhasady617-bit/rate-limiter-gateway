const Redis = require("ioredis");
const fs = require("fs");
const path = require("path");

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 3000);
  },
});

redis.on("connect", () => console.log("Redis connected"));
redis.on("error", (err) => console.error("Redis error:", err.message));

const luaPath = path.join(__dirname, "..", "scripts", "slidingWindow.lua");
const slidingWindowScript = fs.readFileSync(luaPath, "utf-8");

redis.defineCommand("slidingWindow", {
  numberOfKeys: 1,
  lua: slidingWindowScript,
});

const subscriber = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  maxRetriesPerRequest: 3,
});

const publisher = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  maxRetriesPerRequest: 3,
});

module.exports = { redis, subscriber, publisher };
