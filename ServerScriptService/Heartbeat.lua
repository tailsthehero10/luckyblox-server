local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")

local serverMetadata = {
    jobId = game.JobId,
    placeId = game.PlaceId,
    port = tonumber(game:GetService("NetworkServer"):GetPing()) or 53640,
    serverName = game:GetService("ServerScriptService"):GetFullName(),
    startedAt = os.date("!%Y-%m-%dT%H:%M:%SZ")
}

local function postJson(path, payload)
    local serialized = HttpService:JSONEncode(payload)
    local ok, response = pcall(function()
        return HttpService:PostAsync("http://localhost:3001" .. path, serialized, Enum.HttpContentType.ApplicationJson, false)
    end)

    if not ok then
        warn("LuckyBlox heartbeat failed: " .. tostring(response))
        return false
    end

    return true
end

local function registerServer()
    local payload = {
        jobId = serverMetadata.jobId,
        placeId = serverMetadata.placeId,
        port = serverMetadata.port,
        players = #Players:GetPlayers(),
        startedAt = serverMetadata.startedAt,
    }

    postJson("/api/servers/register", payload)
end

local function updatePlayers()
    local payload = {
        jobId = serverMetadata.jobId,
        placeId = serverMetadata.placeId,
        port = serverMetadata.port,
        currentPlayers = Players:GetPlayers(),
        playerIds = {},
        playerCount = #Players:GetPlayers(),
    }

    for _, player in ipairs(Players:GetPlayers()) do
        table.insert(payload.playerIds, tostring(player.UserId))
    end

    postJson("/api/servers/update-players", payload)
end

local function closeServer()
    local payload = {
        jobId = serverMetadata.jobId,
        placeId = serverMetadata.placeId,
        port = serverMetadata.port,
        reason = "shutdown",
    }

    postJson("/api/servers/close", payload)
end

Players.PlayerAdded:Connect(function()
    updatePlayers()
end)

Players.PlayerRemoving:Connect(function()
    updatePlayers()
end)

game:BindToClose(function()
    closeServer()
end)

registerServer()
