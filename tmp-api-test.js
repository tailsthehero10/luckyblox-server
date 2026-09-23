const api = require('./Webserver/http-db-bridge/robloxApi.js');

(async () => {
  console.log('user 1:', JSON.stringify(await api.getUser(1)));
  console.log('username lookup "Roblox":', JSON.stringify(await api.getUserByUsername('Roblox')));
  console.log('headshot 1:', await api.getAvatarHeadshotUrl(1));
  console.log('fullbody 1:', await api.getAvatarFullBodyUrl(1));
  const hat = await api.getAssetDetails(1029025);
  console.log('asset 1029025:', JSON.stringify(hat));
  console.log('asset thumb 1029025:', await api.getAssetThumbnailUrl(1029025));
  console.log('game icon 1:', await api.getGameIconUrl(1));
  console.log('bad id (0):', await api.getUser(0));
})();
