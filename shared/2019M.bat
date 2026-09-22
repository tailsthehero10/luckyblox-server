copy /Y "shared\gameserver.json" "Clients\2019M\Player\gameserver.json"
cd Clients
cd 2019M
cd Player
cls
2019M.exe -Console -verbose -placeid:1818 -localtest "gameserver.json" -settingsfile "DevSettingsFile.json" -port 64989
pause