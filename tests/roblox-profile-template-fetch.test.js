const assert = require('node:assert/strict');
const { parseRobloxProfileExperiences } = require('../Webserver/http-db-bridge/robloxTemplateSource');

const sampleHtml = `
<html>
  <body>
    <div>
      <a href="https://www.roblox.com/games/379736082/Starting-Place">Starting Place</a>
      <a href="https://www.roblox.com/games/366120910/Western">Western</a>
      <a href="https://www.roblox.com/games/95206881/Baseplate">Baseplate</a>
    </div>
  </body>
</html>
`;

const items = parseRobloxProfileExperiences(sampleHtml);
assert.ok(Array.isArray(items), 'items should be an array');
assert.equal(items.length, 3, 'should parse three experience links');
assert.equal(items[0].placeId, 379736082);
assert.equal(items[0].title, 'Starting Place');
assert.equal(items[2].placeId, 95206881);
assert.equal(items[2].title, 'Baseplate');
console.log(`ok: ${items.length} profile template items parsed`);
