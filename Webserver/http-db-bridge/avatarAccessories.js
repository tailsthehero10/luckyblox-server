'use strict';

const { XMLParser, XMLValidator } = require('fast-xml-parser');

const MAX_ACCESSORY_XML_BYTES = 8 * 1024 * 1024;
const parser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  isArray: (name) => name === 'Item',
  processEntities: false,
});

function itemsOf(instance) {
  if (!instance || typeof instance !== 'object') return [];
  const items = instance.Item;
  if (items == null) return [];
  return Array.isArray(items) ? items : [items];
}

function propertiesOf(instance) {
  return instance && instance.Properties && typeof instance.Properties === 'object'
    ? instance.Properties : {};
}

function valueByName(properties, type, name) {
  const entries = properties[type];
  if (entries == null) return null;
  const values = Array.isArray(entries) ? entries : [entries];
  const entry = values.find((value) => value && value['@_name'] === name);
  if (!entry) return null;
  return Object.prototype.hasOwnProperty.call(entry, '#text') ? entry['#text'] : entry;
}

function vector3(value, label) {
  if (!value || ![value.X, value.Y, value.Z].every((number) => Number.isFinite(Number(number)))) {
    throw new Error(`Roblox accessory has an invalid ${label}.`);
  }
  return { x: Number(value.X), y: Number(value.Y), z: Number(value.Z) };
}

function frame(value, label) {
  if (!value) throw new Error(`Roblox accessory is missing ${label}.`);
  const rotation = Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    return Number(value[`R${row}${column}`]);
  });
  if (!rotation.every(Number.isFinite)) {
    throw new Error(`Roblox accessory has an invalid ${label} rotation.`);
  }
  return {
    position: vector3(value, `${label} position`),
    rotation,
  };
}

function assetId(value) {
  const match = /(?:[?&]id=|rbxassetid:\/\/)(\d+)/i.exec(String(value || ''));
  return match ? match[1] : null;
}

function findItem(instance, className, predicate) {
  if (instance && instance['@_class'] === className && (!predicate || predicate(instance))) {
    return instance;
  }
  for (const child of itemsOf(instance)) {
    const found = findItem(child, className, predicate);
    if (found) return found;
  }
  return null;
}

function parseAccessoryAsset(source, id) {
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source || '');
  if (!buffer.length || buffer.length > MAX_ACCESSORY_XML_BYTES) {
    throw new Error('Roblox accessory data is empty or exceeds the 8 MiB limit.');
  }
  const xml = buffer.toString('utf8');
  if (XMLValidator.validate(xml) !== true) {
    throw new Error('Roblox accessory is not valid XML.');
  }
  const document = parser.parse(xml);
  const root = document && document.roblox;
  const accessory = findItem(root, 'Accessory');
  if (!accessory) throw new Error('Roblox asset does not contain an Accessory.');

  const handle = findItem(accessory, 'Part', (part) => (
    valueByName(propertiesOf(part), 'string', 'Name') === 'Handle'
  )) || findItem(accessory, 'MeshPart', (part) => (
    valueByName(propertiesOf(part), 'string', 'Name') === 'Handle'
  ));
  if (!handle) throw new Error('Roblox accessory does not contain a Handle part.');

  const handleProperties = propertiesOf(handle);
  const partChildren = itemsOf(handle);
  const specialMesh = partChildren.find((child) => child['@_class'] === 'SpecialMesh');
  const specialProperties = propertiesOf(specialMesh);
  const meshId = specialMesh
    ? assetId(valueByName(specialProperties, 'Content', 'MeshId')?.url)
    : assetId(valueByName(handleProperties, 'Content', 'MeshId')?.url);
  if (!meshId) throw new Error('Roblox accessory Handle has no supported mesh asset.');

  const attachment = partChildren.find((child) => child['@_class'] === 'Attachment');
  if (!attachment) throw new Error('Roblox accessory Handle has no attachment for rig placement.');
  const attachmentName = valueByName(propertiesOf(attachment), 'string', 'Name');
  if (typeof attachmentName !== 'string' || !attachmentName) {
    throw new Error('Roblox accessory Handle attachment has no name.');
  }

  const meshScaleValue = specialMesh
    ? valueByName(specialProperties, 'Vector3', 'Scale') : null;
  const meshOffsetValue = specialMesh
    ? valueByName(specialProperties, 'Vector3', 'Offset') : null;
  const texture = specialMesh
    ? valueByName(specialProperties, 'Content', 'TextureId')?.url
    : valueByName(handleProperties, 'Content', 'TextureID')?.url;

  return {
    id: String(id),
    name: valueByName(propertiesOf(accessory), 'string', 'Name') || `Asset ${id}`,
    meshId,
    meshType: specialMesh ? 'SpecialMesh' : 'MeshPart',
    meshScale: meshScaleValue ? vector3(meshScaleValue, 'mesh scale') : { x: 1, y: 1, z: 1 },
    meshOffset: meshOffsetValue ? vector3(meshOffsetValue, 'mesh offset') : { x: 0, y: 0, z: 0 },
    size: vector3(valueByName(handleProperties, 'Vector3', 'size'), 'Handle size'),
    attachmentName,
    handleAttachment: frame(valueByName(propertiesOf(attachment), 'CoordinateFrame', 'CFrame'), 'Handle attachment'),
    textureId: assetId(texture),
  };
}

module.exports = { parseAccessoryAsset };
