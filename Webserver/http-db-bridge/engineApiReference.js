'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { XMLParser, XMLValidator } = require('fast-xml-parser');

const parser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  isArray: (name) => name === 'Item',
  processEntities: false,
});

const MEMBER_GROUPS = new Map([
  ['ReflectionMetadataProperties', 'Properties'],
  ['ReflectionMetadataFunctions', 'Functions'],
  ['ReflectionMetadataYieldFunctions', 'Yield functions'],
  ['ReflectionMetadataEvents', 'Events'],
  ['ReflectionMetadataCallbacks', 'Callbacks'],
]);

function itemsOf(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function propertiesOf(item) {
  const properties = itemsOf(item && item.Properties);
  const fields = {};
  for (const group of properties) {
    if (!group || typeof group !== 'object') continue;
    for (const entries of Object.values(group)) {
      for (const entry of itemsOf(entries)) {
        if (!entry || !entry['@_name']) continue;
        fields[entry['@_name']] = entry['#text'] == null ? '' : String(entry['#text']);
      }
    }
  }
  return fields;
}

function parseReflectionMetadata(xml, { clientName, engineVersion } = {}) {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`Invalid engine reflection metadata: ${validation.err.msg}`);
  }

  const document = parser.parse(xml);
  const classContainer = itemsOf(document && document.roblox && document.roblox.Item)
    .find((item) => item && item['@_class'] === 'ReflectionMetadataClasses');
  if (!classContainer) {
    throw new Error('Engine reflection metadata has no class list.');
  }

  const classes = itemsOf(classContainer.Item)
    .filter((item) => item && item['@_class'] === 'ReflectionMetadataClass')
    .map((item) => {
      const properties = propertiesOf(item);
      const members = [];
      for (const group of itemsOf(item.Item)) {
        const groupName = MEMBER_GROUPS.get(group && group['@_class']);
        if (!groupName) continue;
        for (const member of itemsOf(group.Item)) {
          if (!member || !['ReflectionMetadataMember', 'ReflectionMetadataEvents'].includes(member['@_class'])) continue;
          const fields = propertiesOf(member);
          if (!fields.Name) continue;
          members.push({
            name: fields.Name,
            kind: groupName,
            summary: fields.summary || '',
          });
        }
      }
      return {
        name: properties.Name || '',
        category: properties.ClassCategory || 'Other',
        summary: properties.summary || '',
        members,
      };
    })
    .filter((item) => item.name)
    .sort((left, right) => left.name.localeCompare(right.name));

  if (!classes.length) {
    throw new Error('Engine reflection metadata contains no named classes.');
  }

  return {
    clientName: clientName || 'Unknown client',
    engineVersion: engineVersion || 'Unknown build',
    sourceFile: 'shared/ReflectionMetadata.xml',
    classes,
    classCount: classes.length,
    memberCount: classes.reduce((count, item) => count + item.members.length, 0),
    categories: [...new Set(classes.map((item) => item.category))].sort(),
  };
}

function loadClientEngineApi(releaseRoot, clientName) {
  const metadataPath = path.join(
    releaseRoot,
    'Clients',
    clientName,
    'shared',
    'ReflectionMetadata.xml',
  );
  if (!fs.existsSync(metadataPath)) return null;
  const xml = fs.readFileSync(metadataPath, 'utf8');
  const engineVersion = clientName === 'CUSTOM-2021M' ? '0.482.0.424268' : '2021 engine build';
  return parseReflectionMetadata(xml, { clientName, engineVersion });
}

module.exports = { loadClientEngineApi, parseReflectionMetadata };
