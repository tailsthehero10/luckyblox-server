'use strict';

const assert = require('node:assert/strict');
const {
  parseAccessoryAsset,
  parseRobloxAccessory,
} = require('../Webserver/http-db-bridge/avatarAccessories');
const {
  getAvatarAccessoryThumbnail,
} = require('../Webserver/http-db-bridge/avatarAccessoryThumbnail');

const accessoryXml = `<?xml version="1.0"?>
<roblox version="4">
  <Item class="Accessory">
    <Properties>
      <string name="Name">ROBLOXCap</string>
    </Properties>
    <Item class="Part">
      <Properties>
        <string name="Name">Handle</string>
        <Vector3 name="size"><X>1.2</X><Y>0.8</Y><Z>1.4</Z></Vector3>
      </Properties>
      <Item class="SpecialMesh">
        <Properties>
          <Content name="MeshId"><url>http://www.roblox.com/asset?id=71483350</url></Content>
          <Content name="TextureId"><url>rbxassetid://607698990</url></Content>
          <Vector3 name="Scale"><X>0.66</X><Y>0.66</Y><Z>0.66</Z></Vector3>
          <Vector3 name="Offset"><X>0</X><Y>0</Y><Z>0</Z></Vector3>
        </Properties>
      </Item>
      <Item class="Attachment">
        <Properties>
          <string name="Name">HatAttachment</string>
          <CoordinateFrame name="CFrame">
            <X>0</X><Y>0.025</Y><Z>0.2</Z>
            <R00>1</R00><R01>0</R01><R02>0</R02>
            <R10>0</R10><R11>1</R11><R12>0</R12>
            <R20>0</R20><R21>0</R21><R22>1</R22>
          </CoordinateFrame>
        </Properties>
      </Item>
    </Item>
  </Item>
</roblox>`;

const parsed = parseAccessoryAsset(Buffer.from(accessoryXml), '607702162');
assert.equal(parsed.id, '607702162');
assert.equal(parsed.name, 'ROBLOXCap');
assert.equal(parsed.meshId, '71483350');
assert.equal(parsed.textureId, '607698990');
assert.equal(parsed.meshType, 'SpecialMesh');
assert.deepEqual(parsed.meshScale, { x: 0.66, y: 0.66, z: 0.66 });
assert.equal(parsed.attachmentName, 'HatAttachment');
assert.deepEqual(parsed.handleAttachment.position, { x: 0, y: 0.025, z: 0.2 });

const binaryParsed = parseRobloxAccessory({
  ClassName: 'Accessory',
  Name: 'Binary Fedora',
  Children: [{
    ClassName: 'Part',
    Name: 'Handle',
    Size: { X: 1, Y: 0.4, Z: 1 },
    Children: [
      {
        ClassName: 'SpecialMesh',
        MeshId: 'http://www.roblox.com/asset/?id=1029012',
        TextureId: 'rbxassetid://6858319566',
        Scale: { X: 1.1, Y: 1.1, Z: 1.1 },
        Offset: { X: 0, Y: 0, Z: 0 },
      },
      {
        ClassName: 'Attachment',
        Name: 'HatAttachment',
        CFrame: {
          Position: { X: 0, Y: 0, Z: 0.05 },
          Orientation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        },
      },
    ],
  }],
}, '1029025');
assert.equal(binaryParsed.name, 'Binary Fedora');
assert.equal(binaryParsed.meshId, '1029012');
assert.equal(binaryParsed.textureId, '6858319566');
assert.equal(binaryParsed.meshType, 'SpecialMesh');
assert.deepEqual(binaryParsed.meshScale, { x: 1.1, y: 1.1, z: 1.1 });
assert.equal(binaryParsed.attachmentName, 'HatAttachment');

async function testThumbnailFallback() {
  const remoteThumbnail = 'https://tr.rbxcdn.com/180DAY-test/420/420/Hat/Png/noFilter';
  const remoteDetails = await getAvatarAccessoryThumbnail('17892778209', null, {
    getAssetDetails: async () => ({
      name: ':D SDSW',
      assetTypeId: 8,
    }),
    getAssetThumbnailUrl: async (id, size) => {
      assert.equal(id, '17892778209');
      assert.equal(size, '420x420');
      return remoteThumbnail;
    },
  });
  assert.deepEqual(remoteDetails, {
    name: ':D SDSW',
    assetType: 'Hat',
    thumbnailUrl: remoteThumbnail,
  });

  const localThumbnail = await getAvatarAccessoryThumbnail('607702162', {
    name: 'Local hat',
    assetType: 'Hat',
    thumbnail: '/asset-cache/607702162.png',
  }, {
    getAssetDetails: async () => { throw new Error('stored item should not need a details lookup'); },
    getAssetThumbnailUrl: async () => { throw new Error('stored thumbnail should be reused'); },
  });
  assert.equal(localThumbnail.thumbnailUrl, '/asset-cache/607702162.png');

  const rejectedUrl = await getAvatarAccessoryThumbnail('123', null, {
    getAssetDetails: async () => null,
    getAssetThumbnailUrl: async () => 'https://example.invalid/image.png',
  });
  assert.equal(rejectedUrl, null);
}

assert.throws(() => parseAccessoryAsset(Buffer.from('<roblox/>'), '123'), /does not contain an Accessory/);
assert.throws(() => parseAccessoryAsset(Buffer.from('<roblox>'), '123'), /not valid XML/);

testThumbnailFallback().then(() => {
  console.log('ok: Roblox accessory models and official thumbnail fallbacks resolve safely');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
