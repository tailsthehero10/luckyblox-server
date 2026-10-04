'use strict';

const assert = require('node:assert/strict');
const { parseAccessoryAsset } = require('../Webserver/http-db-bridge/avatarAccessories');

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
assert.throws(() => parseAccessoryAsset(Buffer.from('<roblox/>'), '123'), /does not contain an Accessory/);
assert.throws(() => parseAccessoryAsset(Buffer.from('<roblox>'), '123'), /not valid XML/);

console.log('ok: real Roblox accessory model XML resolves its mesh, texture, scale, and rig attachment');
