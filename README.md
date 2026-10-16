# Distributed Rate Limiter & API Analytics Gateway

A high-throughput, fault-tolerant API gateway built with **Node.js**, **Express**, **Redis**, **PostgreSQL**, **Prisma**, and **WebSockets**.

Designed to handle high concurrency, prevent denial-of-service (DoS/DDoS) and brute-force traffic, decouple logging from critical API paths using streaming message queues, and broadcast live observability telemetry.

---

## Architecture Overview

```
                      Client Request
                            │
                            ▼
      ┌───────────────────────────────────────────────┐
      │               Express Gateway                 │
      │                                               │
      │  ┌─────────────────────────────────────────┐  │
      │  │        Rate Limiter Middleware          │  │
      │  │  ┌───────────────────────────────────┐  │  │
      │  │  │  Redis Lua Script (Atomic Window) │  │  │
      │  │  │  • ZREMRANGEBYSCORE (prune old)   │  │  │
      │  │  │  • ZCARD (count current)          │  │  │
      │  │  │  • ZADD (record if under limit)   │  │  │
      │  │  └───────────────────────────────────┘  │  │
      │  │                                         │  │
      │  │  Allowed? ──► Stream to Redis (api:logs)│  │
      │  │  Blocked? ──► Return 429 Too Many Reqs  │  │
      │  │                                         │  │
      │  │  Both     ──► Publish to Redis Pub/Sub  │  │
      │  └─────────────────────────────────────────┘  │
      │                                               │
      │  ┌───────────────────┐  ┌──────────────────┐  │
      │  │ Analytics Worker  │  │ Telemetry Server │  │
      │  │ (Redis Streams)   │  │ (WebSockets)     │  │
      │  │        │          │  │        ▲         │  │
      │  │   Batch Read      │  │     Pub/Sub      │  │
      │  │   (XREADGROUP)    │  │   Subscriber     │  │
      │  │        │          │  │        │         │  │
      │  │        ▼          │  │        ▼         │  │
      │  │   PostgreSQL      │  │ Connected        │  │
      │  │   (Bulk Insert)   │  │ Dashboards &     │  │
      │  │                   │  │ Monitoring Apps  │  │
      │  └───────────────────┘  └──────────────────┘  │
      └───────────────────────────────────────────────┘
```

---

## Core Features

- **Atomic Sliding Window Algorithm:** Implemented inside Redis via Lua scripts (`ZREMRANGEBYSCORE`, `ZCARD`, `ZADD`), completely eliminating concurrency race conditions.
- **Asynchronous Batch Ingestion:** Requests are ingested into Redis Streams (`api:logs`) in sub-millisecond time. A background worker periodically drains the stream using consumer groups (`XREADGROUP`) and performs bulk inserts into PostgreSQL.
- **Live Observability Telemetry:** Aggregated per-second metrics (total, allowed, and blocked request throughput) streamed via Redis Pub/Sub directly to connected WebSocket clients.
- **Fail-Open Resilience Pattern:** If Redis experiences downtime, the gateway catches connection failures and gracefully allows incoming traffic instead of crashing or returning 500 internal errors.

---

## Tech Stack

- **Runtime:** Node.js (v18+)
- **Framework:** Express.js
- **In-Memory Store & Queue:** Redis (ioredis, Lua scripting, Redis Streams, Pub/Sub)
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Real-Time Communication:** WebSockets (`ws`)
- **Containerization:** Docker & Docker Compose

---

## Prerequisites

- [Node.js](https://nodejs.org/) installed
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running

---

## Getting Started

### 1. Clone the repository and install dependencies
```bash
git clone https://github.com/your-username/rate-limiter-gateway.git
cd rate-limiter-gateway
npm install
```

### 2. Start Redis and PostgreSQL
```bash
docker compose up -d
```

### 3. Initialize the Database Schema
```bash
npx prisma db push
```

### 4. Run the Development Server
```bash
npm run dev
```

The gateway will be accessible at:
- **HTTP Server:** `http://localhost:3000`
- **WebSocket Telemetry:** `ws://localhost:3000/ws/telemetry`

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Server uptime and health check |
| `GET` | `/api/data` | Sample data endpoint protected by rate limiter |
| `GET` | `/api/slow` | Simulates variable network/database delay (100–600ms) |
| `GET` | `/api/analytics` | Returns recent 50 request logs persisted in PostgreSQL |

### Rate Limit Response Headers
Every response includes real-time rate limit headers:
- `X-RateLimit-Limit`: Maximum requests permitted per window.
- `X-RateLimit-Remaining`: Remaining request allowance in the current sliding window.

---

## Testing Guide

### 1. Basic Request & Headers Verification
Test that rate limit headers decrement with every hit:

**PowerShell:**
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/data" -UseBasicParsing
```

**cURL / Bash:**
```bash
curl -i http://localhost:3000/api/data
```

---

### 2. Triggering the Rate Limiter (Burst Test)
Send 105 rapid requests to exhaust the 100-request window and observe the `429 Too Many Requests` status:

**PowerShell:**
```powershell
1..105 | ForEach-Object {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3000/api/data" -UseBasicParsing
        Write-Host "Request $_ : Status $($r.StatusCode)" -ForegroundColor Green
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        Write-Host "Request $_ : Status $status (BLOCKED BY RATE LIMITER!)" -ForegroundColor Red
    }
}
```

**Bash:**
```bash
for i in {1..105}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/data)
  echo "Request $i: HTTP $code"
done
```

---

### 3. Real-Time WebSocket Telemetry
Connect to the live stream to view real-time per-second allowed vs blocked throughput:

```bash
npx wscat -c ws://localhost:3000/ws/telemetry
```

**Output payload example:**
```json
{"type":"metrics","requestsPerSecond":15,"allowedPerSecond":12,"blockedPerSecond":3,"timestamp":1729080000000}
```

---

### 4. Verify PostgreSQL Batch Persistence
Confirm that logs flushed from Redis Streams appear in PostgreSQL:

**PowerShell:**
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/analytics" -UseBasicParsing
```
Or open `http://localhost:3000/api/analytics` in your browser.

To open the interactive database viewer:
```bash
npx prisma studio
```

---

### 5. Fail-Open Reliability Test
Simulate a Redis crash to verify the gateway stays operational without downtime:

1. Stop Redis:
   ```bash
   docker stop rlg-redis
   ```
2. Send a request:
   ```powershell
   Invoke-WebRequest -Uri "http://localhost:3000/api/data" -UseBasicParsing
   ```
   *(Returns `200 OK` via fail-open fallback)*
3. Restart Redis:
   ```bash
   docker start rlg-redis
   ```

---

## Configuration

Settings can be customized inside the `.env` file:

| Key | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port for Express and WebSocket server |
| `REDIS_HOST` | `localhost` | Redis server hostname |
| `REDIS_PORT` | `6379` | Redis server port |
| `DATABASE_URL` | `postgresql://...:5433/...` | PostgreSQL connection string |
| `RATE_LIMIT_WINDOW_SEC` | `60` | Sliding window duration in seconds |
| `RATE_LIMIT_MAX_REQUESTS`| `100` | Max requests allowed per window per IP |
| `LOG_BATCH_SIZE` | `50` | Number of logs consumed per batch from stream |
| `LOG_FLUSH_INTERVAL_MS` | `5000` | Interval between background database flushes |

---

## License

MIT
