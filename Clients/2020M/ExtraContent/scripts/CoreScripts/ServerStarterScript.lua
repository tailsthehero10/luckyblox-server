_G.AdminPasswordPublic = 'password=559413025'

local bodytype="Custom"
local starterplayer=game:GetService("StarterPlayer")
if bodytype~="Custom" then
if starterplayer:FindFirstChild("StarterCharacter") then
starterplayer.StarterCharacter:Destroy()
end
end
if bodytype=="R6" then
local a=game:GetObjects("rbxasset://avatar/R6.rbxm")[1]
local x=a:Clone()
x.Name="StarterCharacter"
x.Parent=starterplayer
end
if bodytype=="R15" then
local a=game:GetObjects("rbxasset://avatar/characterR15.rbxm")[1]
local x=a:Clone()
x.Name="StarterCharacter"
x.Parent=starterplayer
end

local modulelol = game:GetObjects("rbxasset://DataStoreService.rbxm")[1]
modulelol.Parent=game:GetService("ReplicatedStorage")

local modulelol2 = game:GetObjects("rbxasset://MarketPlaceService.rbxm")[1]
modulelol2.Parent=game:GetService("ReplicatedStorage")

local modulelol3 = game:GetObjects("rbxasset://LuawebService.rbxm")[1]
modulelol3.Parent=game:GetService("ReplicatedStorage")

local modulelol4 = game:GetObjects("rbxasset://PointsService.rbxm")[1]
modulelol4.Parent=game:GetService("ReplicatedStorage")

local modulelol5 = game:GetObjects("rbxasset://GroupService.rbxm")[1]
modulelol5.Parent=game:GetService("ReplicatedStorage")

local modulelol6 = game:GetObjects("rbxasset://InsertService.rbxm")[1]
modulelol6.Parent=game:GetService("ReplicatedStorage")

local modulelol7 = game:GetObjects("rbxasset://MessagingService.rbxm")[1]
modulelol7.Parent=game:GetService("ReplicatedStorage")

local modulelol8 = game:GetObjects("rbxasset://ChatService.rbxm")[1]
modulelol8.Parent=game:GetService("ReplicatedStorage")

game.DescendantAdded:connect(function(a)
local reenable=true
pcall(function()
if a:IsDescendantOf(game:GetService("ServerScriptService")) or a:IsDescendantOf(game:GetService("ServerStorage")) or a:IsDescendantOf(game:GetService("ReplicatedStorage")) or a:IsDescendantOf(workspace) or a:IsDescendantOf(game:GetService("StarterGui")) or a:IsDescendantOf(game:GetService("StarterPlayer")) or a:IsDescendantOf(game:GetService("StarterPack")) or a:IsDescendantOf(game:GetService("ReplicatedFirst")) then
if a:IsA("Script") or a:IsA("ModuleScript") or a:IsA("LocalScript") then
if string.match(a.Source,"DataStoreService") or string.match(a.Source,'MarketplaceService') or string.match(a.Source,'BadgeService') or string.match(a.Source,'GamePassService') or string.match(a.Source,'IsInGroup') or string.match(a.Source,'GetRankInGroup') or string.match(a.Source,'PointsService') or string.match(a.Source,'GroupService') or string.match(a.Source,'InsertService') or string.match(a.Source,'IsFriendsWith') or string.match(a.Source,'MessagingService') then
pcall(function()
if a.Disabled==true then
reenable=false
else
a.Disabled=true
end
end)
local function fixscript()
local xd=a.Source
xd = string.gsub(xd,"game:GetService%('MessagingService'%)","require(game:GetService('ReplicatedStorage'):WaitForChild('MessagingService'))")
		xd = string.gsub(xd,'game:GetService%("MessagingService"%)','require(game:GetService("ReplicatedStorage").MessagingService)')
                xd = string.gsub(xd,'game.MessagingService','require(game.ReplicatedStorage:WaitForChild("MessagingService"))')

		xd = string.gsub(xd,"game:GetService%('DataStoreService'%)","require(game:GetService('ReplicatedStorage').DataStoreService)")
		xd = string.gsub(xd,'game:GetService%("DataStoreService"%)','require(game:GetService("ReplicatedStorage").DataStoreService)')
		xd = string.gsub(xd,"game:GetService%('MarketplaceService'%)","require(game:GetService('ReplicatedStorage').MarketPlaceService)")
		xd = string.gsub(xd,'game:GetService%("MarketplaceService"%)','require(game:GetService("ReplicatedStorage").MarketPlaceService)')
                xd = string.gsub(xd,'game.MarketplaceService','require(game.ReplicatedStorage.MarketPlaceService)')
                xd = string.gsub(xd,'game.GamePassService','require(game.ReplicatedStorage.LuawebService)')
               xd = string.gsub(xd,'game:GetService%("GamePassService"%)','require(game:GetService("ReplicatedStorage").LuawebService)')
               xd = string.gsub(xd,"game:GetService%('GamePassService'%)","require(game:GetService('ReplicatedStorage').LuawebService)")

                              xd = string.gsub(xd,'game.BadgeService','require(game.ReplicatedStorage.LuawebService)')
               xd = string.gsub(xd,'game:GetService%("BadgeService"%)','require(game:GetService("ReplicatedStorage").LuawebService)')
               xd = string.gsub(xd,"game:GetService%('BadgeService'%)","require(game:GetService('ReplicatedStorage').LuawebService)")
               xd = string.gsub(xd,':IsInGroup','.userId-')
               xd = string.gsub(xd,':GetRankInGroup','.userId-')
               xd = string.gsub(xd,':IsFriendsWith','.userId==')
               	xd = string.gsub(xd,"game:GetService%('PointsService'%)","require(game:GetService('ReplicatedStorage').PointsService)")
		xd = string.gsub(xd,'game:GetService%("PointsService"%)','require(game:GetService("ReplicatedStorage").PointsService)')
                xd = string.gsub(xd,'game.PointsService','require(game.ReplicatedStorage.PointsService)')

               	xd = string.gsub(xd,"game:GetService%('GroupService'%)","require(game:GetService('ReplicatedStorage').GroupService)")
		xd = string.gsub(xd,'game:GetService%("GroupService"%)','require(game:GetService("ReplicatedStorage").GroupService)')
                xd = string.gsub(xd,'game.GroupService','require(game.ReplicatedStorage.GroupService)')

	xd = string.gsub(xd,"game:GetService%('InsertService'%)","require(game:GetService('ReplicatedStorage').InsertService)")
		xd = string.gsub(xd,'game:GetService%("InsertService"%)','require(game:GetService("ReplicatedStorage").InsertService)')
                xd = string.gsub(xd,'game.InsertService','require(game.ReplicatedStorage.InsertService)')


		xd = string.gsub(xd,'game.Chat','require(game:GetService("ReplicatedStorage").Chat)')
               xd = string.gsub(xd,'game:GetService%("Chat"%)','require(game:GetService("ReplicatedStorage").Chat)')
xd = string.gsub(xd,"game:GetService%('Chat'%)","require(game:GetService('ReplicatedStorage').Chat)")
a.Source=xd
end

local succ, err = pcall(function()
fixscript()
end)
if err then
print(err)
end

pcall(function()
if reenable==true then
a.Disabled=false
end
end)
	end
end
end
end)
end)





local DSFunctionMain=Instance.new("BindableFunction",game:GetService("ReplicatedStorage"))
DSFunctionMain.Name="DSFunctionMain"
DSFunctionMain.OnInvoke = function(url)
return game:HttpGetAsync(url)
end
--End of script fixer.
--[[
		// Filename: ServerStarterScript.lua
		// Version: 1.0
		// Description: Server core script that handles core script server side logic.
]]--

local runService = game:GetService('RunService')

-- Prevent server script from running in Studio when not in run mode
while not runService:IsRunning() do
	wait()
end

--[[ Services ]]--
local RobloxReplicatedStorage = game:GetService('RobloxReplicatedStorage')
local ScriptContext = game:GetService('ScriptContext')
local CoreGui = game:GetService("CoreGui")
local RobloxGui = CoreGui:WaitForChild("RobloxGui", math.huge)

--[[ Add Server CoreScript ]]--
ScriptContext:AddCoreScriptLocal("ServerCoreScripts/ServerSocialScript", script.Parent)

-- Leaderstat server child-order tracker
local FFlagAnOrderOfLeaderstats = game:DefineFastFlag("AnOrderOfLeaderstats", false)
if FFlagAnOrderOfLeaderstats then
	ScriptContext:AddCoreScriptLocal("ServerCoreScripts/ServerLeaderstats", script.Parent)
end

-- Default Alternate Death Ragdoll (China only for now)
ScriptContext:AddCoreScriptLocal("ServerCoreScripts/PlayerRagdollRigCreator", script.Parent)

-- FFlag for admin freecam (for easy disabling in case of security breach)
game:DefineFastFlag("DebugFreeCameraForAdmins", true)

local FFlagFixDialogServerWait = require(RobloxGui.Modules.Common.Flags.GetFFlagFixDialogServerWait)()

if FFlagFixDialogServerWait then
	ScriptContext:AddCoreScriptLocal("ServerCoreScripts/ServerDialog", script.Parent)

else
	--[[ Remote Events ]]--
	local RemoteEvent_SetDialogInUse = Instance.new("RemoteEvent")
	RemoteEvent_SetDialogInUse.Name = "SetDialogInUse"
	RemoteEvent_SetDialogInUse.Parent = RobloxReplicatedStorage

	--[[ Event Connections ]]--
	local playerDialogMap = {}

	local function setDialogInUse(player, dialog, value, waitTime)
		if typeof(dialog) ~= "Instance" or not dialog:IsA("Dialog") then
			return
		end
		if type(value) ~= "boolean" then
			return
		end
		if type(waitTime) ~= "number" and type(waitTime) ~= "nil" then
			return
		end
		if typeof(player) ~= "Instance" or not player:IsA("Player") then
			return
		end

		if waitTime and waitTime ~= 0 then
			wait(waitTime)
		end
		if dialog ~= nil then
			dialog:SetPlayerIsUsing(player, value)
			playerDialogMap[player] = value and dialog or nil
		end
	end

	RemoteEvent_SetDialogInUse.OnServerEvent:connect(setDialogInUse)

	game:GetService("Players").PlayerRemoving:connect(function(player)
		if player then
			local dialog = playerDialogMap[player]
			if dialog then
				dialog:SetPlayerIsUsing(player, false)
				playerDialogMap[player] = nil
			end
		end
	end)
end

local RemoteFunction_GetServerVersion = Instance.new("RemoteFunction")
RemoteFunction_GetServerVersion.Name = "GetServerVersion"
RemoteFunction_GetServerVersion.Parent = RobloxReplicatedStorage

local function getServerVersion()
	local rawVersion = runService:GetRobloxVersion()
	local displayVersion
	if rawVersion == "?" then
		displayVersion = "DEBUG_SERVER"
	else
		if runService:IsStudio() then
			displayVersion = "ROBLOX Studio"
		else
			displayVersion = rawVersion
		end
	end
	return displayVersion
end

RemoteFunction_GetServerVersion.OnServerInvoke = getServerVersion

if game:GetService("Chat").LoadDefaultChat then
	require(game:GetService("CoreGui").RobloxGui.Modules.Server.ClientChat.ChatWindowInstaller)()
	require(game:GetService("CoreGui").RobloxGui.Modules.Server.ServerChat.ChatServiceInstaller)()
end

if game:GetFastFlag("DebugFreeCameraForAdmins") then
	require(game:GetService("CoreGui").RobloxGui.Modules.Server.FreeCamera.FreeCameraInstaller)()
end

require(game:GetService("CoreGui").RobloxGui.Modules.Server.ServerSound.SoundDispatcherInstaller)()
game:GetObjects("rbxasset://chatxd.rbxm")[1].Parent=game:GetService("ReplicatedFirst")
game:GetService("Chat").BubbleChatEnabled = true
print("Done!")


game:GetService("Players").PlayerAdded:connect(function(plr)
local xd=Instance.new("BoolValue",plr) xd.Name="IsInGroupxd" xd.Value=false
local xd3=Instance.new("IntValue",plr) xd3.Name="GetRankInGroupxd" xd3.Value=0
	for i,v in pairs(game:GetService("Players"):GetPlayers()) do
		if v.Name==plr.Name and v~=plr then
			_G.Plrtokick=plr
			local s=Instance.new("Script") s.Source="wait() _G.Plrtokick:Kick('That username is already taken.') script:Destroy()" s.Parent=workspace
			return;
		end
	end
	print("[[game logs]] "..plr.Name.." Joined the game!")
	plr.Chatted:connect(function(msg)
		print("[[game logs]] "..plr.Name.." Chatted: " ..msg)
	end)
	local app=plr.CharacterAppearance
	local axd=0
	for w in (app .. '|'):gmatch('([^|]*)|') do 
		axd=axd+1
		if axd==1 then
			app=w
		end
	end
	plr.CharacterAdded:connect(function(char)
		local bcolors=Instance.new("BodyColors",char)
		bcolors.Name = "Body Colors"
		plr=plr
		local words = {}
		wait(1)
		for w in (app .. ';'):gmatch('([^;]*);') do 
			table.insert(words, w) 
		end
		local num1=words[1]
		local number= nil
		function loadchar()
			for i,v in pairs(words) do
local skip=false
if string.match(v,"password") then
skip=true
end
				if v==_G.AdminPasswordPublic then
					--print(plr.Name .." is the host!")
					--local a=Instance.new("StringValue") a.Parent=plr a.Value=_G.AdminPasswordPublic a.Name="password"
				else
					pcall(function()
if skip==false then
local a=game:GetObjects(v)[3]
for i,ll in pairs(a:GetChildren()) do
if char:FindFirstChild("Torso") then
ll.Parent=char
end
end
end
end)
pcall(function()
if skip==false then
local a=game:GetObjects(v)[2]
for i,ll in pairs(a:GetChildren()) do
if char:FindFirstChild("Torso") then
ll.Parent=char
end
end
if char:FindFirstChild("Torso") then
a.Parent=char
end
end
end)
					pcall(function()
if skip==false then
local a=game:GetObjects(v)[1]
if skip==false then
	a.Parent=char
if a.Name=="face" and a:IsA("Decal") then
for i,v in pairs(char.Head:GetChildren()) do
if v:IsA("Decal") and v.Name=="face" then
v:Destroy()
end
end
a.Parent=char.Head
end
end
end
end)
end
end
end
pcall(function()
	loadchar()
end)
end)
end)
wait()
game:GetService("HttpService").HttpEnabled = true
game:GetService("HttpService"):SetHttpEnabled(true)


local grfgrf=Instance.new("IntValue",workspace) grfgrf.Name="grfgrf"
                        local aarr=Instance.new("Folder",game:GetService("ReplicatedStorage")) aarr.Name="wtfStoragewtf"
grfgrf.Changed:connect(function()
pcall(function()
                        local thing=game:GetObjects("rbxassetid://"..tostring(grfgrf.Value))[1]
                        local r= Instance.new("IntValue",thing) r.Name=tostring(grfgrf.Value)
			thing.Parent=aarr
end)
end)