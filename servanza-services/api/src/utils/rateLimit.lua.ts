import { redis } from '../config/redis';

// Define the Lua script for Atomic Multi-Key Token Bucket
export const tokenBucketLuaScript = `
local ipKey = KEYS[1]
local userKey = KEYS[2]

local cost = tonumber(ARGV[1])
local ipCapacity = tonumber(ARGV[2])
local ipWindowMs = tonumber(ARGV[3])
local userCapacity = tonumber(ARGV[4])
local userWindowMs = tonumber(ARGV[5])
local now = tonumber(ARGV[6])

local costMicroTokens = cost * 1000

local function getMicroTokens(key, capacity, windowMs)
  local maxMicroTokens = capacity * 1000
  local data = redis.call("HMGET", key, "micro_tokens", "last_update")
  local microTokens = tonumber(data[1])
  local lastUpdate = tonumber(data[2])

  if not microTokens or not lastUpdate then
    return maxMicroTokens
  end

  local timeDiff = math.max(0, now - lastUpdate)
  local addedMicroTokens = math.floor((timeDiff * capacity * 1000) / windowMs)
  
  return math.min(maxMicroTokens, microTokens + addedMicroTokens)
end

local ipMicroTokens = getMicroTokens(ipKey, ipCapacity, ipWindowMs)
local userMicroTokens = getMicroTokens(userKey, userCapacity, userWindowMs)

if ipMicroTokens >= costMicroTokens and userMicroTokens >= costMicroTokens then
  ipMicroTokens = ipMicroTokens - costMicroTokens
  userMicroTokens = userMicroTokens - costMicroTokens
  
  redis.call("HMSET", ipKey, "micro_tokens", ipMicroTokens, "last_update", now)
  redis.call("PEXPIRE", ipKey, ipWindowMs)
  
  redis.call("HMSET", userKey, "micro_tokens", userMicroTokens, "last_update", now)
  redis.call("PEXPIRE", userKey, userWindowMs)
  
  return {1, math.floor(math.min(ipMicroTokens, userMicroTokens) / 1000)}
else
  return {0, math.floor(math.min(ipMicroTokens, userMicroTokens) / 1000)}
end
`;

// Extend the redis instance to include the custom command type
declare module 'ioredis' {
  interface Redis {
    rateLimitBucket(
      key1: string,
      key2: string,
      cost: number,
      ipCapacity: number,
      ipWindowMs: number,
      userCapacity: number,
      userWindowMs: number,
      now: number
    ): Promise<[number, number]>;
  }
}

// Register the command with ioredis
redis.defineCommand('rateLimitBucket', {
  numberOfKeys: 2,
  lua: tokenBucketLuaScript,
});
