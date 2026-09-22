local HttpService = game:GetService("HttpService")
local BASE_URL = "http://127.0.0.1:3001/api"

local function request(method, endpoint, payload)
    local headers = {
        ["Content-Type"] = "application/json",
    }

    local body = nil
    if payload then
        body = HttpService:JSONEncode(payload)
    end

    local response = HttpService:RequestAsync({
        Url = BASE_URL .. endpoint,
        Method = method,
        Headers = headers,
        Body = body,
    })

    if response.Success then
        return HttpService:JSONDecode(response.Body)
    end

    return {
        ok = false,
        error = response.StatusMessage or "Request failed",
    }
end

local function loadData(userId)
    return request("GET", "/get-player-data/" .. tostring(userId))
end

local function saveData(userId, data)
    data = data or {}
    data.userId = tostring(userId)
    return request("POST", "/save-player-data", data)
end

local function updateInventory(userId, inventory)
    return request("POST", "/update-inventory", {
        userId = tostring(userId),
        inventory = inventory,
    })
end

return {
    loadData = loadData,
    saveData = saveData,
    updateInventory = updateInventory,
}
