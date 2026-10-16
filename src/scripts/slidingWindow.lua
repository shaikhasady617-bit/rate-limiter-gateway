local key       = KEYS[1]
local now       = tonumber(ARGV[1])
local windowMs  = tonumber(ARGV[2])
local maxReqs   = tonumber(ARGV[3])
local requestId = ARGV[4]

local windowStart = now - windowMs
redis.call("ZREMRANGEBYSCORE", key, "-inf", windowStart)

local currentCount = redis.call("ZCARD", key)

if currentCount < maxReqs then
  redis.call("ZADD", key, now, requestId)
  redis.call("PEXPIRE", key, windowMs + 1000)
  return {1, currentCount + 1}
end

return {0, currentCount}
