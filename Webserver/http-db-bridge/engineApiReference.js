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

const ARCHIVED_2021_CLIENTS = new Set(['2021M', 'CUSTOM-2021M']);
const API_DUMP_VERSION = '0.482.0.424268';
let archived2021ApiCache;

function itemsOf(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function typeName(type) {
  if (!type || typeof type !== 'object') return 'unknown';
  return type.Name || 'unknown';
}

function functionSignature(member) {
  const parameters = itemsOf(member.Parameters).map((parameter) => {
    const defaultValue = Object.prototype.hasOwnProperty.call(parameter, 'Default')
      ? ` = ${parameter.Default}`
      : '';
    return `${parameter.Name}: ${typeName(parameter.Type)}${defaultValue}`;
  });
  const returnType = member.ReturnType ? `: ${typeName(member.ReturnType)}` : '';
  return `(${parameters.join(', ')})${returnType}`;
}

function parseApiDump(dump, { clientName, engineVersion, sourceFile } = {}) {
  if (!dump || !Array.isArray(dump.Classes) || !Array.isArray(dump.Enums)) {
    throw new Error('Engine API dump must contain class and enum arrays.');
  }

  const classes = dump.Classes.map((entry) => ({
    name: entry.Name,
    category: 'Class',
    superclass: entry.Superclass || '',
    tags: itemsOf(entry.Tags),
    members: itemsOf(entry.Members).map((member) => {
      const kind = member.MemberType || 'Member';
      const signature = kind === 'Function' || kind === 'Callback' || kind === 'Event'
        ? functionSignature(member)
        : kind === 'Property'
          ? `: ${typeName(member.ValueType)}`
          : '';
      const security = typeof member.Security === 'string'
        ? member.Security
        : member.Security
          ? `Read: ${member.Security.Read || 'unknown'}, Write: ${member.Security.Write || 'unknown'}`
          : '';
      return {
        name: member.Name,
        kind,
        signature,
        category: member.Category || '',
        tags: itemsOf(member.Tags),
        security,
        threadSafety: member.ThreadSafety || '',
      };
    }).filter((member) => member.name)
      .sort((left, right) => left.name.localeCompare(right.name)),
  })).filter((entry) => entry.name)
    .sort((left, right) => left.name.localeCompare(right.name));

  const enums = dump.Enums.map((entry) => ({
    name: entry.Name,
    items: itemsOf(entry.Items).map((item) => ({
      name: item.Name,
      value: item.Value,
      tags: itemsOf(item.Tags),
    })).filter((item) => item.name)
      .sort((left, right) => Number(left.value) - Number(right.value)),
  })).filter((entry) => entry.name)
    .sort((left, right) => left.name.localeCompare(right.name));

  if (!classes.length || !enums.length) {
    throw new Error('Engine API dump contains no classes or enums.');
  }
  return {
    clientName: clientName || 'Unknown client',
    engineVersion: engineVersion || 'Unknown build',
    sourceFile: sourceFile || 'API-Dump.json',
    sourceUrl: 'https://github.com/RobloxAPI/build-archive/blob/8af1cd98d719f823f14aa09a5449c580fda71e20/data/production/builds/version-c2037653e0a446ac/API-Dump.json',
    sourceDate: '2021-06-07',
    classes,
    enums,
    classCount: classes.length,
    memberCount: classes.reduce((count, item) => count + item.members.length, 0),
    enumCount: enums.length,
    categories: ['Classes only', 'Enums only'],
    isFullDump: true,
  };
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
            signature: '',
            category: '',
            tags: [],
            security: '',
            threadSafety: '',
          });
        }
      }
      return {
        name: properties.Name || '',
        category: properties.ClassCategory || 'Other',
        summary: properties.summary || '',
        superclass: '',
        tags: [],
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
    sourceUrl: null,
    sourceDate: null,
    classes,
    enums: [],
    classCount: classes.length,
    memberCount: classes.reduce((count, item) => count + item.members.length, 0),
    enumCount: 0,
    categories: ['Classes only', 'Enums only'],
    isFullDump: false,
  };
}

function loadClientEngineApi(releaseRoot, clientName) {
  if (ARCHIVED_2021_CLIENTS.has(clientName)) {
    const dumpPath = path.join(
      __dirname,
      'engine-api',
      `${API_DUMP_VERSION}.json`,
    );
    if (fs.existsSync(dumpPath)) {
      if (!archived2021ApiCache) {
        const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
        archived2021ApiCache = parseApiDump(dump, {
          clientName: '2021 API archive',
          engineVersion: API_DUMP_VERSION,
          sourceFile: `engine-api/${API_DUMP_VERSION}.json`,
        });
      }
      return { ...archived2021ApiCache, clientName };
    }
  }

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

module.exports = { loadClientEngineApi, parseApiDump, parseReflectionMetadata };
