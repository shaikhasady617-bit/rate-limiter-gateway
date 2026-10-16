require("dotenv").config();

const http = require("http");
const express = require("express");
const rateLimiter = require("./middleware/rateLimiter");
const { startAnalyticsWorker } = require("./services/analyticsService");
const { createTelemetryServer } = require("./websocket/telemetryServer");
const prisma = require("./config/db");

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

app.use(express.json());
app.use(rateLimiter);

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/data", (req, res) => {
  res.json({
    message: "Here is your data!",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/slow", (req, res) => {
  const delay = Math.floor(Math.random() * 500) + 100;
  setTimeout(() => {
    res.json({ message: "Slow response", delayMs: delay });
  }, delay);
});

app.get("/api/analytics", async (req, res) => {
  try {
    const logs = await prisma.requestLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ count: logs.length, logs });
  } catch (err) {
    console.error("Analytics query error:", err.message);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

const server = http.createServer(app);

createTelemetryServer(server);

server.listen(PORT, async () => {
  console.log(`\nAPI Gateway running on http://localhost:${PORT}`);
  console.log(`WebSocket telemetry at ws://localhost:${PORT}/ws/telemetry\n`);

  await startAnalyticsWorker();
});

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await prisma.$disconnect();
  server.close();
  process.exit(0);
});
