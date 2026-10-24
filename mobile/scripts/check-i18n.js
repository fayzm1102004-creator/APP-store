const path = require('path');
const fs = require('fs');

const arPath = path.resolve(__dirname, '../src/locales/ar.json');
const enPath = path.resolve(__dirname, '../src/locales/en.json');
const srcDir = path.resolve(__dirname, '../src');
const appJsPath = path.resolve(__dirname, '../App.js');
const backendEnumsDir = path.resolve(__dirname, '../../backend/Marketplace.Domain/Enums');

// Real backend enum and API values for every dynamic i18n namespace
const BACKEND_DYNAMIC_NAMESPACE_VALUES = {
  shipmentStatus: [
    'Created',
    'HandedToCarrier',
    'InTransit',
    'ReadyForPickup',
    'Delivered',
    'Cancelled',
    'Returned',
  ],
  orderStatus: ['Pending', 'Shipped', 'Delivered', 'Cancelled'],
  returnStatus: ['Pending', 'Approved', 'Rejected', 'Completed'],
  returnReason: [
    'RefusedByBuyer',
    'Unreachable',
    'WrongAddress',
    'DamagedInTransit',
    'Other',
  ],
  payoutStatus: ['Pending', 'Completed', 'Rejected'],
  payoutMethod: ['VodafoneCash', 'InstaPay', 'BankTransfer'],
  walletTxType: [
    'COD_Collection',
    'Commission',
    'Payout',
    'Refund',
    'RefundCredit',
    'OrderRedemption',
    'Cashback',
  ],
  deliveryMethod: ['Pickup', 'Courier'],
  paymentMethod: ['OnReceipt'],
  roles: ['Buyer', 'Seller', 'Admin'],
  categories: [
    'electronics',
    'clothing',
    'shoes',
    'home',
    'beauty',
    'kids',
    'sports',
    'accessories',
    'other',
  ],
};

// Optional live sync check against backend C# enum definitions if present
const ENUM_FILE_MAP = {
  shipmentStatus: ['ShipmentStatus.cs'],
  orderStatus: ['OrderStatus.cs'],
  returnStatus: ['ReturnStatus.cs'],
  returnReason: ['ReturnReason.cs'],
  payoutStatus: ['PayoutStatus.cs'],
  payoutMethod: ['PayoutMethod.cs'],
  walletTxType: ['WalletTransactionType.cs', 'BuyerWalletTransactionType.cs'],
  deliveryMethod: ['DeliveryMethod.cs'],
  paymentMethod: ['PaymentMethod.cs'],
  roles: ['UserRole.cs'],
};

function parseCSharpEnumValues(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const bodyMatch = content.match(/enum\s+\w+\s*\{([\s\S]*?)\}/);
  if (!bodyMatch) return [];
  return bodyMatch[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line && !line.startsWith('[') && !line.startsWith('/'))
    .map((line) => line.replace(/[,=].*$/, '').trim())
    .filter(Boolean);
}

for (const [ns, files] of Object.entries(ENUM_FILE_MAP)) {
  const expectedSet = new Set(BACKEND_DYNAMIC_NAMESPACE_VALUES[ns] || []);
  for (const f of files) {
    const parsed = parseCSharpEnumValues(path.join(backendEnumsDir, f));
    for (const val of parsed) {
      expectedSet.add(val);
    }
  }
  BACKEND_DYNAMIC_NAMESPACE_VALUES[ns] = [...expectedSet];
}

function loadJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`❌ Failed to parse JSON file at ${filePath}:`, err.message);
    process.exit(1);
  }
}

function getLeafKeys(obj, prefix = '') {
  let keys = [];
  for (const k of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
      keys = keys.concat(getLeafKeys(obj[k], fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function getSourceFiles(dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.expo') {
        files = files.concat(getSourceFiles(fullPath));
      }
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractKeysFromCode(sourceFiles) {
  const staticKeys = new Set();
  const dynamicPrefixes = new Set();

  const staticRegexes = [
    /\b(?:i18n\.)?t\(\s*['"]([a-zA-Z0-9_.]+)['"]/g,
    /\btranslate\(\s*['"]([a-zA-Z0-9_.]+)['"]/g,
    /\bi18nKey\s*=\s*['"]([a-zA-Z0-9_.]+)['"]/g,
    /\bi18nKey\s*=\s*{\s*['"]([a-zA-Z0-9_.]+)['"]\s*}/g,
  ];

  // Dynamic template literals: t(`prefix.${...}`) or translate(`prefix.${...}`)
  const dynamicRegex = /\b(?:i18n\.)?(?:t|translate)\(\s*`([a-zA-Z0-9_]+)\.\$\{/g;

  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8');

    for (const regex of staticRegexes) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        if (match[1].endsWith('.')) {
          // Dynamic concatenation: t('prefix.' + var)
          dynamicPrefixes.add(match[1].slice(0, -1));
        } else {
          staticKeys.add(match[1]);
        }
      }
    }

    let dynMatch;
    while ((dynMatch = dynamicRegex.exec(content)) !== null) {
      dynamicPrefixes.add(dynMatch[1]);
    }
  }

  return { staticKeys, dynamicPrefixes };
}

console.log('🌐 Validating i18n locale files and source code references...');
const ar = loadJson(arPath);
const en = loadJson(enPath);

const arKeys = new Set(getLeafKeys(ar));
const enKeys = new Set(getLeafKeys(en));

let hasErrors = false;

// 1. Parity Check: ar.json vs en.json
const missingInEn = [...arKeys].filter((k) => !enKeys.has(k));
const missingInAr = [...enKeys].filter((k) => !arKeys.has(k));

if (missingInEn.length > 0) {
  hasErrors = true;
  console.error(`❌ Parity Error: Missing in en.json (${missingInEn.length} keys):`);
  missingInEn.slice(0, 10).forEach((k) => console.error(`   - ${k}`));
}

if (missingInAr.length > 0) {
  hasErrors = true;
  console.error(`❌ Parity Error: Missing in ar.json (${missingInAr.length} keys):`);
  missingInAr.slice(0, 10).forEach((k) => console.error(`   - ${k}`));
}

// 2. Source Code Usage Scan
let srcFiles = getSourceFiles(srcDir);
if (fs.existsSync(appJsPath)) {
  srcFiles.push(appJsPath);
}

const { staticKeys, dynamicPrefixes } = extractKeysFromCode(srcFiles);

// A) Keys used in source code but missing from locale files
const usedButMissing = [];
for (const key of staticKeys) {
  const isPresent = arKeys.has(key) || arKeys.has(`${key}_other`) || arKeys.has(`${key}_one`);
  if (!isPresent) {
    usedButMissing.push(key);
  }
}

if (usedButMissing.length > 0) {
  hasErrors = true;
  console.error(`\n❌ Code Usage Error: Keys used in code but missing from locale files (${usedButMissing.length}):`);
  usedButMissing.forEach((k) => console.error(`   - ${k}`));
}

// B) Enumerate and verify all real backend enum / API values for dynamic namespaces
const missingEnumKeys = [];
let totalVerifiedEnumValues = 0;

for (const [namespace, values] of Object.entries(BACKEND_DYNAMIC_NAMESPACE_VALUES)) {
  for (const val of values) {
    totalVerifiedEnumValues++;
    const fullKey = `${namespace}.${val}`;
    if (!arKeys.has(fullKey)) {
      missingEnumKeys.push(`${fullKey} (missing in ar.json)`);
    }
    if (!enKeys.has(fullKey)) {
      missingEnumKeys.push(`${fullKey} (missing in en.json)`);
    }
  }
}

// Also fail if code uses a dynamic prefix that is not registered in BACKEND_DYNAMIC_NAMESPACE_VALUES
for (const prefix of dynamicPrefixes) {
  if (!BACKEND_DYNAMIC_NAMESPACE_VALUES[prefix]) {
    hasErrors = true;
    console.error(`\n❌ Unenumerated Dynamic Namespace: "${prefix}" is used dynamically in code but has no enum value list in check-i18n.js`);
  }
}

if (missingEnumKeys.length > 0) {
  hasErrors = true;
  console.error(`\n❌ Dynamic Enum Coverage Error (${missingEnumKeys.length} missing translations):`);
  missingEnumKeys.forEach((item) => console.error(`   - ${item}`));
}

// C) Keys defined in locale files but unused in source code
const unusedKeys = [];
for (const key of arKeys) {
  const baseKey = key.replace(/_(?:zero|one|two|few|many|other)$/, '');
  if (!staticKeys.has(key) && !staticKeys.has(baseKey)) {
    const rootPrefix = key.split('.')[0];
    if (!dynamicPrefixes.has(rootPrefix) && !BACKEND_DYNAMIC_NAMESPACE_VALUES[rootPrefix]) {
      unusedKeys.push(key);
    }
  }
}

console.log(`\n📊 Translation Key Statistics:`);
console.log(`   - Total locale keys (in sync): ${arKeys.size}`);
console.log(`   - Static keys extracted from source: ${staticKeys.size}`);
console.log(`   - Dynamic namespaces detected: ${[...dynamicPrefixes].join(', ') || 'none'}`);
console.log(`   - Backend enum/API values verified across ${Object.keys(BACKEND_DYNAMIC_NAMESPACE_VALUES).length} namespaces: ${totalVerifiedEnumValues}`);
console.log(`   - Unreferenced keys (candidates for pruning): ${unusedKeys.length}`);

if (hasErrors) {
  console.error('\n❌ i18n check failed: see errors above.');
  process.exit(1);
}

console.log(`\n✅ i18n check passed! Both ar.json and en.json are in 100% sync (${arKeys.size} keys), all static keys exist, and all ${totalVerifiedEnumValues} backend enum/API values are covered.`);
process.exit(0);
