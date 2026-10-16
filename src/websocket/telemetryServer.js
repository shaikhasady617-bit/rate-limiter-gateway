const { WebSocketServer } = require("ws");
const { subscriber } = require("../config/redis");

const TELEMETRY_CHANNEL = "telemetry:events";

let allowedCount = 0;
let blockedCount = 0;

function createTelemetryServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/telemetry" });

  wss.on("connection", (ws) => {
    console.log("WebSocket client connected");
    ws.send(JSON.stringify({ type: "connected", message: "Telemetry stream active" }));
    ws.on("close", () => console.log("WebSocket client disconnected"));
  });

  subscriber.subscribe(TELEMETRY_CHANNEL, (err) => {
    if (err) {
      console.error("Failed to subscribe to telemetry channel:", err.message);
      return;
    }
    console.log(`Subscribed to "${TELEMETRY_CHANNEL}" for live telemetry`);
  });

  subscriber.on("message", (channel, message) => {
    if (channel !== TELEMETRY_CHANNEL) return;

    try {
      const event = JSON.parse(message);

      if (event.type === "allowed") allowedCount++;
      if (event.type === "blocked") blockedCount++;

      broadcast(wss, message);
    } catch (err) {
      console.error("Telemetry parse error:", err.message);
    }
  });

  setInterval(() => {
    const metrics = JSON.stringify({
      type: "metrics",
      requestsPerSecond: allowedCount + blockedCount,
      allowedPerSecond: allowedCount,
      blockedPerSecond: blockedCount,
      timestamp: Date.now(),
    });

    broadcast(wss, metrics);

    allowedCount = 0;
    blockedCount = 0;
  }, 1000);

  console.log("WebSocket telemetry server ready on /ws/telemetry");
  return wss;
}

function broadcast(wss, data) {
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  }
}

module.exports = { createTelemetryServer };
