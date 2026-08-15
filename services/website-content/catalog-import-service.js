const crypto = require("crypto");
const Category = require("../../models/Category");
const ServiceType = require("../../models/ServiceType");
const WebsiteCatalogItem = require("../../models/WebsiteCatalogItem");
const catalogService = require("../catalog/catalog-service");
const websiteContentService = require("./website-content-service");
const storage = require("../storage/s3-service");
const {
  humanTextValue,
  tokenValue,
  booleanValue,
  numberValue,
  validationError,
} = require("../../utils/validation");

const MAX_CSV_BYTES = 1024 * 1024;
const IMPORT_ID_PATTERN = /^CATALOG-\d{8}-\d{6}-\d{3}-[A-F0-9]{4}$/;
const ALLOWED_HEADERS = new Set([
  "action",
  "type",
  "category",
  "category_slug",
  "category_description",
  "category_display_order",
  "category_visible",
  "category_active",
  "subcategory",
  "subcategory_slug",
  "subcategory_description",
  "subcategory_display_order",
  "subcategory_visible",
  "subcategory_active",
  "name",
  "slug",
  "short_description",
  "description",
  "display_order",
  "visible",
  "active",
]);
const REQUIRED_HEADERS = ["action", "type", "category", "subcategory", "name"];

function actorDetails(actor = {}) {
  return {
    adminId: String(actor.employeeId || actor.adminId || actor.id || actor._id || "").slice(0, 160),
    name: String(actor.name || actor.fullName || "CRM employee").slice(0, 160),
    email: String(actor.email || "").slice(0, 254),
  };
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizedName(value) {
  return String(value || "").trim().toLocaleLowerCase("en-IN");
}

function indiaTimestampParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce((output, part) => {
    if (part.type !== "literal") output[part.type] = part.value;
    return output;
  }, {});
  return parts;
}

function generateImportId(date = new Date()) {
  const parts = indiaTimestampParts(date);
  const datePart = `${parts.year}${parts.month}${parts.day}`;
  const timePart = `${parts.hour}${parts.minute}${parts.second}`;
  const millis = String(date.getMilliseconds()).padStart(3, "0");
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `CATALOG-${datePart}-${timePart}-${millis}-${suffix}`;
}

function canonicalHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function parseCsvText(text) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  if (!input.trim()) throw validationError("CSV file is empty");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field) throw validationError("CSV contains an invalid quote");
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw validationError("CSV contains an unterminated quoted field");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => String(value || "").trim() !== ""));
}

function parseCsvBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw validationError("CSV file is required");
  if (buffer.length > MAX_CSV_BYTES) throw Object.assign(new Error("CSV file must not exceed 1 MB"), { status: 413 });
  const text = buffer.toString("utf8");
  const rows = parseCsvText(text);
  const headers = rows.shift().map(canonicalHeader);
  if (new Set(headers).size !== headers.length) throw validationError("CSV contains duplicate column names");
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) throw validationError(`CSV is missing required column: ${required}`);
  }
  const unknown = headers.filter((header) => !ALLOWED_HEADERS.has(header));
  if (unknown.length) throw validationError(`CSV contains unsupported column${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
  const records = rows.map((values, index) => {
    if (values.length > headers.length) throw validationError(`CSV row ${index + 2} contains more values than the header`);
    const record = {};
    headers.forEach((header, column) => { record[header] = values[column] ?? ""; });
    return { rowNumber: index + 2, raw: record };
  });
  if (!records.length) throw validationError("CSV must contain at least one data row");
  if (records.length > 5000) throw validationError("CSV must not contain more than 5,000 data rows");
  return { headers, records };
}

function optionalBoolean(value, label, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return booleanValue(value, { label, fallback });
}

function optionalNumber(value, label, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return numberValue(value, { label, min: 0, max: 100000, integer: true });
}

function normalizeRow(entry) {
  const raw = entry.raw;
  const action = String(raw.action || "").trim().toUpperCase();
  if (!['CREATE', 'UPDATE'].includes(action)) throw validationError(`Row ${entry.rowNumber}: action must be CREATE or UPDATE`);
  const kind = String(raw.type || "").trim().toLowerCase();
  if (!['service', 'product'].includes(kind)) throw validationError(`Row ${entry.rowNumber}: type must be service or product`);

  const categoryName = humanTextValue(raw.category, { label: `Row ${entry.rowNumber} Category`, required: true, maxLength: 120 });
  const subcategoryName = humanTextValue(raw.subcategory, { label: `Row ${entry.rowNumber} Subcategory`, required: true, maxLength: 120 });
  const name = humanTextValue(raw.name, { label: `Row ${entry.rowNumber} Name`, required: true, maxLength: 160 });
  const categorySlug = tokenValue(raw.category_slug || slugify(categoryName), { label: `Row ${entry.rowNumber} Category slug`, required: true, maxLength: 80, lowercase: true });
  const subcategorySlug = tokenValue(raw.subcategory_slug || slugify(subcategoryName), { label: `Row ${entry.rowNumber} Subcategory slug`, required: true, maxLength: 80, lowercase: true });
  const slug = tokenValue(raw.slug || slugify(name), { label: `Row ${entry.rowNumber} Slug`, required: true, maxLength: 100, lowercase: true });

  return {
    rowNumber: entry.rowNumber,
    action,
    kind,
    category: {
      name: categoryName,
      slug: categorySlug,
      slugProvided: Boolean(String(raw.category_slug || "").trim()),
      description: humanTextValue(raw.category_description, { label: `Row ${entry.rowNumber} Category description`, maxLength: 2000 }),
      displayOrder: optionalNumber(raw.category_display_order, `Row ${entry.rowNumber} Category display order`, 0),
      websiteVisible: optionalBoolean(raw.category_visible, `Row ${entry.rowNumber} Category visibility`, true),
      active: optionalBoolean(raw.category_active, `Row ${entry.rowNumber} Category active`, true),
    },
    subcategory: {
      name: subcategoryName,
      slug: subcategorySlug,
      slugProvided: Boolean(String(raw.subcategory_slug || "").trim()),
      description: humanTextValue(raw.subcategory_description, { label: `Row ${entry.rowNumber} Subcategory description`, maxLength: 1000 }),
      displayOrder: optionalNumber(raw.subcategory_display_order, `Row ${entry.rowNumber} Subcategory display order`, 0),
      websiteVisible: optionalBoolean(raw.subcategory_visible, `Row ${entry.rowNumber} Subcategory visibility`, true),
      active: optionalBoolean(raw.subcategory_active, `Row ${entry.rowNumber} Subcategory active`, true),
    },
    item: {
      name,
      slug,
      shortDescription: humanTextValue(raw.short_description, { label: `Row ${entry.rowNumber} Short description`, maxLength: 500 }),
      description: humanTextValue(raw.description, { label: `Row ${entry.rowNumber} Description`, maxLength: 5000 }),
      displayOrder: optionalNumber(raw.display_order, `Row ${entry.rowNumber} Display order`, undefined),
      websiteVisible: optionalBoolean(raw.visible, `Row ${entry.rowNumber} Visibility`, undefined),
      active: optionalBoolean(raw.active, `Row ${entry.rowNumber} Active`, undefined),
    },
  };
}

function decodeCsvUpload(input = {}) {
  const fileName = humanTextValue(input.fileName, { label: "CSV file name", required: true, maxLength: 255 });
  if (!fileName.toLowerCase().endsWith(".csv")) throw validationError("Choose a CSV file");
  const encoded = String(input.base64 || "").trim();
  if (!encoded || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) throw validationError("CSV file content is invalid");
  const buffer = Buffer.from(encoded.replace(/\s+/g, ""), "base64");
  if (!buffer.length) throw validationError("CSV file is empty");
  if (buffer.length > MAX_CSV_BYTES) throw Object.assign(new Error("CSV file must not exceed 1 MB"), { status: 413 });
  return { fileName, buffer };
}

function itemKey(kind, categorySlug, subcategorySlug, slug) {
  return `${kind}|${categorySlug}|${subcategorySlug}|${slug}`;
}

async function buildPreview(buffer, fileName = "catalog.csv") {
  const parsed = parseCsvBuffer(buffer);
  const normalized = [];
  const validationErrors = [];
  for (const entry of parsed.records) {
    try {
      normalized.push(normalizeRow(entry));
    } catch (error) {
      validationErrors.push({ row: entry.rowNumber, message: error.message });
    }
  }

  const [categories, subcategories, items] = await Promise.all([
    Category.find({}).lean(),
    ServiceType.find({}).lean(),
    WebsiteCatalogItem.find({}).lean(),
  ]);
  const categoryBySlug = new Map(categories.map((row) => [String(row.slug || "").toLowerCase(), row]));
  const categoryByName = new Map(categories.map((row) => [normalizedName(row.name), row]));
  const subcategoryByParentAndSlug = new Map(subcategories.map((row) => [`${row.categoryId}|${String(row.slug || "").toLowerCase()}`, row]));
  const subcategoryByParentAndName = new Map(subcategories.map((row) => [`${row.categoryId}|${normalizedName(row.name)}`, row]));
  const itemByExactKey = new Map(items.map((row) => [itemKey(row.kind, row.categorySlug, row.serviceTypeSlug, row.slug), row]));
  const itemsByKindAndSlug = new Map();
  for (const row of items) {
    const key = `${row.kind}|${row.slug}`;
    if (!itemsByKindAndSlug.has(key)) itemsByKindAndSlug.set(key, []);
    itemsByKindAndSlug.get(key).push(row);
  }

  const virtualCategories = new Map();
  const virtualSubcategories = new Map();
  const seenTargets = new Set();
  const rowResults = [];
  const summary = {
    totalRows: parsed.records.length,
    categoriesToCreate: 0,
    subcategoriesToCreate: 0,
    servicesToCreate: 0,
    servicesToUpdate: 0,
    productsToCreate: 0,
    productsToUpdate: 0,
    errors: validationErrors.length,
  };

  for (const row of normalized) {
    const result = {
      row: row.rowNumber,
      action: row.action,
      type: row.kind,
      category: row.category.name,
      subcategory: row.subcategory.name,
      name: row.item.name,
      slug: row.item.slug,
      status: "READY",
      message: "",
      categoryResult: "EXISTING",
      subcategoryResult: "EXISTING",
    };

    let category = categoryBySlug.get(row.category.slug) || categoryByName.get(normalizedName(row.category.name));
    const virtualCategoryKey = row.category.slug;
    if (!category && virtualCategories.has(virtualCategoryKey)) category = virtualCategories.get(virtualCategoryKey);

    if (row.action === "UPDATE") {
      if (!category || category.virtual) {
        result.status = "ERROR";
        result.message = "UPDATE requires an existing Category; CSV updates cannot create or update Categories.";
      }
    } else if (!category) {
      category = { categoryId: `virtual:${row.category.slug}`, slug: row.category.slug, name: row.category.name, virtual: true };
      virtualCategories.set(virtualCategoryKey, category);
      result.categoryResult = "CREATE";
      summary.categoriesToCreate += 1;
    } else if (row.category.slugProvided && category.slug !== row.category.slug) {
      result.status = "ERROR";
      result.message = `Category ${category.name} already exists with slug ${category.slug}.`;
    }

    let subcategory = null;
    if (result.status !== "ERROR" && category) {
      const parentId = category.categoryId;
      subcategory = subcategoryByParentAndSlug.get(`${parentId}|${row.subcategory.slug}`)
        || subcategoryByParentAndName.get(`${parentId}|${normalizedName(row.subcategory.name)}`)
        || virtualSubcategories.get(`${parentId}|${row.subcategory.slug}`);
      if (subcategory && !subcategory.virtual && row.subcategory.slugProvided && subcategory.slug !== row.subcategory.slug) {
        result.status = "ERROR";
        result.message = `Subcategory ${subcategory.name} already exists with slug ${subcategory.slug}.`;
      } else if (row.action === "UPDATE" && (!subcategory || subcategory.virtual)) {
        result.status = "ERROR";
        result.message = "UPDATE requires an existing Subcategory under the selected Category; CSV updates cannot create or update Subcategories.";
      } else if (row.action === "CREATE" && !subcategory) {
        subcategory = { serviceTypeId: `virtual:${row.subcategory.slug}`, categoryId: parentId, slug: row.subcategory.slug, name: row.subcategory.name, virtual: true };
        virtualSubcategories.set(`${parentId}|${row.subcategory.slug}`, subcategory);
        result.subcategoryResult = "CREATE";
        summary.subcategoriesToCreate += 1;
      }
    }

    if (result.status !== "ERROR" && category && subcategory) {
      const target = itemKey(row.kind, category.slug, subcategory.slug, row.item.slug);
      const duplicateInCsv = seenTargets.has(target);
      if (duplicateInCsv) {
        result.status = "ERROR";
        result.message = "The CSV targets this same Service/Product more than once. Keep only one row per item.";
      } else {
        seenTargets.add(target);
        const existing = itemByExactKey.get(target);
        if (row.action === "CREATE") {
          if (existing) {
            result.status = "ERROR";
            result.message = "CREATE cannot overwrite an existing Service/Product. Use UPDATE instead.";
          } else if (row.kind === "service") summary.servicesToCreate += 1;
          else summary.productsToCreate += 1;
        } else if (!existing) {
          const elsewhere = itemsByKindAndSlug.get(`${row.kind}|${row.item.slug}`) || [];
          result.status = "ERROR";
          result.message = elsewhere.length
            ? "This slug exists under a different Category/Subcategory. UPDATE cannot move Services or Products between taxonomy parents."
            : "UPDATE could not find an existing Service/Product with this slug under the selected Category/Subcategory.";
        } else if (row.kind === "service") summary.servicesToUpdate += 1;
        else summary.productsToUpdate += 1;
      }
    }

    if (result.status === "ERROR") summary.errors += 1;
    rowResults.push(result);
  }

  for (const error of validationErrors) {
    rowResults.push({ row: error.row, status: "ERROR", message: error.message });
  }
  rowResults.sort((left, right) => left.row - right.row);

  return {
    fileName,
    headers: parsed.headers,
    rows: rowResults,
    summary,
    valid: summary.errors === 0,
  };
}


function importRoot() {
  const settings = storage.config();
  if (!settings.configured) throw Object.assign(new Error(settings.credentialError || "Amazon S3 is not configured"), { status: 503 });
  return `${settings.privatePrefix}website-content/catalog-imports/`;
}

function importPrefix(importId) {
  if (!IMPORT_ID_PATTERN.test(String(importId || ""))) throw validationError("Catalog import ID is invalid");
  return `${importRoot()}${importId}/`;
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function snapshotHash(value) {
  return crypto.createHash("sha256").update(jsonBuffer(value)).digest("hex");
}

async function loadCatalogSnapshot() {
  const [categories, subcategories, servicesAndProducts] = await Promise.all([
    Category.find({}).sort({ _id: 1 }).lean(),
    ServiceType.find({}).sort({ _id: 1 }).lean(),
    WebsiteCatalogItem.find({}).sort({ _id: 1 }).lean(),
  ]);
  return {
    categories,
    subcategories,
    services: servicesAndProducts.filter((row) => row.kind === "service"),
    products: servicesAndProducts.filter((row) => row.kind === "product"),
  };
}

function snapshotHashes(snapshot) {
  return {
    categories: snapshotHash(snapshot.categories),
    subcategories: snapshotHash(snapshot.subcategories),
    services: snapshotHash(snapshot.services),
    products: snapshotHash(snapshot.products),
  };
}

function catalogBackupKeys(prefix) {
  return {
    original: `${prefix}original.csv`,
    metadata: `${prefix}backup-metadata.json`,
    categories: `${prefix}pre-import-backup/categories.json`,
    subcategories: `${prefix}pre-import-backup/subcategories.json`,
    services: `${prefix}pre-import-backup/services.json`,
    products: `${prefix}pre-import-backup/products.json`,
    preview: `${prefix}preview.json`,
  };
}

async function verifyBackupFiles(keys) {
  const verified = await Promise.all(Object.values(keys).map((key) => storage.exists(key)));
  if (verified.some((value) => !value)) {
    throw Object.assign(new Error("Catalog backup could not be verified. No changes were made."), { status: 503, expose: true });
  }
}

async function assertCatalogMatchesBackup(metadata) {
  const expected = metadata?.snapshotHashes || {};
  if (!expected.categories || !expected.subcategories || !expected.services || !expected.products) {
    throw Object.assign(new Error("Catalog backup metadata is incomplete. Create a new backup before importing."), { status: 409, expose: true });
  }
  const current = await loadCatalogSnapshot();
  const actual = snapshotHashes(current);
  const changed = Object.keys(actual).filter((key) => actual[key] !== expected[key]);
  if (changed.length) {
    throw Object.assign(new Error("Catalog changed after the S3 backup was created. Create a new backup before importing so the rollback snapshot matches the current catalog."), { status: 409, expose: true });
  }
  return current;
}

async function writeJson(key, value) {
  return storage.putObject({ key, contentType: "application/json", body: jsonBuffer(value) });
}

async function prepareImport(input = {}, actor = {}) {
  const upload = decodeCsvUpload(input);
  const preview = await buildPreview(upload.buffer, upload.fileName);
  if (!preview.valid) {
    throw Object.assign(new Error("Fix the CSV validation errors before creating a backup"), {
      status: 422,
      expose: true,
      preview,
    });
  }

  const importId = generateImportId();
  const prefix = importPrefix(importId);
  const now = new Date();
  const snapshot = await loadCatalogSnapshot();
  const actorInfo = actorDetails(actor);
  const metadata = {
    importId,
    status: "BACKUP_IN_PROGRESS",
    originalFileName: upload.fileName,
    createdAt: now.toISOString(),
    createdAtIndia: new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" }).format(now),
    createdBy: actorInfo,
    counts: {
      categories: snapshot.categories.length,
      subcategories: snapshot.subcategories.length,
      services: snapshot.services.length,
      products: snapshot.products.length,
    },
    snapshotHashes: snapshotHashes(snapshot),
  };

  const keys = catalogBackupKeys(prefix);

  await storage.putObject({ key: keys.original, contentType: "text/csv", body: upload.buffer });
  await Promise.all([
    writeJson(keys.categories, snapshot.categories),
    writeJson(keys.subcategories, snapshot.subcategories),
    writeJson(keys.services, snapshot.services),
    writeJson(keys.products, snapshot.products),
    writeJson(keys.preview, preview),
    writeJson(keys.metadata, metadata),
  ]);

  await verifyBackupFiles(keys);
  const completedMetadata = {
    ...metadata,
    status: "BACKUP_COMPLETED",
    verifiedAt: new Date().toISOString(),
  };
  await writeJson(keys.metadata, completedMetadata);
  const verifiedMetadataObject = await storage.getObject({ key: keys.metadata, maxBytes: 1024 * 1024 });
  const verifiedMetadata = JSON.parse(verifiedMetadataObject.body.toString("utf8"));
  if (verifiedMetadata.importId !== importId || verifiedMetadata.status !== "BACKUP_COMPLETED") {
    throw Object.assign(new Error("Catalog backup could not be verified. No changes were made."), { status: 503, expose: true });
  }

  return { importId, status: "BACKUP_COMPLETED", preview, backup: completedMetadata };
}

async function findCategoryForRow(row) {
  return Category.findOne({ $or: [{ slug: row.category.slug }, { name: new RegExp(`^${escapeRegex(row.category.name)}$`, "i") }] }).lean();
}

async function findSubcategoryForRow(categoryId, row) {
  return ServiceType.findOne({
    categoryId,
    $or: [{ slug: row.subcategory.slug }, { normalizedName: normalizedName(row.subcategory.name) }],
  }).lean();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ensureParents(row) {
  let category = null;
  let subcategory = null;
  let categoryResult = "REUSED";
  let subcategoryResult = "REUSED";
  const parentActions = () => ({
    category: category ? {
      result: categoryResult, categoryId: category.categoryId, name: category.name, slug: category.slug,
      ...(categoryResult === "CREATED" ? { data: {
        description: category.description || "", displayOrder: Number(category.displayOrder || 0),
        websiteVisible: category.websiteVisible !== false, active: category.active !== false,
      } } : {}),
    } : null,
    subcategory: subcategory ? {
      result: subcategoryResult, serviceTypeId: subcategory.serviceTypeId, name: subcategory.name, slug: subcategory.slug,
      ...(subcategoryResult === "CREATED" ? { data: {
        description: subcategory.description || "", displayOrder: Number(subcategory.displayOrder || 0),
        websiteVisible: subcategory.websiteVisible !== false, active: subcategory.active !== false,
      } } : {}),
    } : null,
  });
  try {
    category = await findCategoryForRow(row);
    if (!category) {
      if (row.action !== "CREATE") throw validationError("UPDATE cannot create a Category");
      category = await catalogService.createCategory({
        name: row.category.name,
        slug: row.category.slug,
        description: row.category.description,
        displayOrder: row.category.displayOrder,
        websiteVisible: row.category.websiteVisible,
        active: row.category.active,
      });
      categoryResult = "CREATED";
    }

    subcategory = await findSubcategoryForRow(category.categoryId, row);
    if (!subcategory) {
      if (row.action !== "CREATE") throw validationError("UPDATE cannot create a Subcategory");
      subcategory = await catalogService.createServiceType(category.categoryId, {
        name: row.subcategory.name,
        slug: row.subcategory.slug,
        description: row.subcategory.description,
        displayOrder: row.subcategory.displayOrder,
        websiteVisible: row.subcategory.websiteVisible,
        active: row.subcategory.active,
      });
      subcategoryResult = "CREATED";
    }
    return { category, subcategory, categoryResult, subcategoryResult, parentActions: parentActions() };
  } catch (error) {
    error.parentActions = parentActions();
    throw error;
  }
}

function changedFields(before, after, fields) {
  const changes = {};
  for (const field of fields) {
    const left = before?.[field];
    const right = after?.[field];
    if (JSON.stringify(left) !== JSON.stringify(right)) changes[field] = { before: left ?? null, after: right ?? null };
  }
  return changes;
}

async function executeRow(row, actor) {
  const parents = await ensureParents(row);
  try {
  const exactQuery = {
    kind: row.kind,
    categoryId: parents.category.categoryId,
    serviceTypeId: parents.subcategory.serviceTypeId,
    slug: row.item.slug,
  };
  const existing = await WebsiteCatalogItem.findOne(exactQuery).lean();
  if (row.action === "CREATE") {
    if (existing) throw Object.assign(new Error("CREATE cannot overwrite an existing Service/Product. Use UPDATE instead."), { status: 409 });
    const created = await websiteContentService.createItem({
      kind: row.kind,
      categoryId: parents.category.categoryId,
      serviceTypeId: parents.subcategory.serviceTypeId,
      name: row.item.name,
      slug: row.item.slug,
      shortDescription: row.item.shortDescription,
      description: row.item.description,
      displayOrder: row.item.displayOrder ?? 0,
      websiteVisible: row.item.websiteVisible ?? true,
      active: row.item.active ?? true,
    }, actor);
    return {
      result: "CREATED",
      recordId: created.itemId,
      categoryResult: parents.categoryResult,
      subcategoryResult: parents.subcategoryResult,
      parentActions: parents.parentActions,
      data: {
        kind: created.kind, name: created.name, slug: created.slug, shortDescription: created.shortDescription || "",
        description: created.description || "", displayOrder: Number(created.displayOrder || 0),
        websiteVisible: created.websiteVisible !== false, active: created.active !== false,
      },
      changes: {},
    };
  }

  if (!existing) {
    const elsewhere = await WebsiteCatalogItem.find({ kind: row.kind, slug: row.item.slug }).select("categorySlug serviceTypeSlug").lean();
    if (elsewhere.length) throw Object.assign(new Error("UPDATE cannot move a Service/Product to another Category or Subcategory"), { status: 409 });
    throw Object.assign(new Error("Service/Product not found for UPDATE"), { status: 404 });
  }

  const payload = {
    kind: row.kind,
    categoryId: existing.categoryId,
    serviceTypeId: existing.serviceTypeId,
    name: row.item.name,
    slug: existing.slug,
    shortDescription: row.item.shortDescription || existing.shortDescription || "",
    description: row.item.description || existing.description || "",
    displayOrder: row.item.displayOrder ?? existing.displayOrder ?? 0,
    websiteVisible: row.item.websiteVisible ?? existing.websiteVisible !== false,
    active: row.item.active ?? existing.active !== false,
    coverMediaId: existing.coverMediaId || "",
    galleryMediaIds: existing.galleryMediaIds || [],
  };
  const updated = await websiteContentService.updateItem(existing.itemId, payload, actor);
  return {
    result: "UPDATED",
    recordId: updated.itemId,
    categoryResult: "REUSED",
    subcategoryResult: "REUSED",
    parentActions: parents.parentActions,
    changes: changedFields(existing, updated, ["name", "shortDescription", "description", "displayOrder", "websiteVisible", "active"]),
  };
  } catch (error) {
    error.parentActions = parents.parentActions;
    throw error;
  }
}

async function executeImport(importId, actor = {}) {
  const prefix = importPrefix(importId);
  if (await storage.exists(`${prefix}result.json`)) {
    throw Object.assign(new Error("This catalog import has already been executed. Upload the CSV again to create a new backup and import ID."), { status: 409, expose: true });
  }
  if (await storage.exists(`${prefix}import-started.json`)) {
    throw Object.assign(new Error("This catalog import has already started and cannot be executed again. Review its S3 audit files, then upload the CSV again if a new import is required."), { status: 409, expose: true });
  }
  const metadataObject = await storage.getObject({ key: `${prefix}backup-metadata.json`, maxBytes: 1024 * 1024 });
  const metadata = JSON.parse(metadataObject.body.toString("utf8"));
  if (metadata.importId !== importId || metadata.status !== "BACKUP_COMPLETED") {
    throw Object.assign(new Error("Catalog backup is not ready for this import"), { status: 409 });
  }
  await verifyBackupFiles(catalogBackupKeys(prefix));
  await assertCatalogMatchesBackup(metadata);
  const original = await storage.getObject({ key: `${prefix}original.csv`, maxBytes: MAX_CSV_BYTES });
  const preview = await buildPreview(original.body, metadata.originalFileName || "catalog.csv");
  if (!preview.valid) {
    throw Object.assign(new Error("Catalog changed after backup or the CSV is no longer safe to import. Create a new backup and try again."), {
      status: 409,
      expose: true,
      preview,
    });
  }
  await assertCatalogMatchesBackup(metadata);
  const parsed = parseCsvBuffer(original.body);
  const rows = parsed.records.map(normalizeRow);
  const startedAt = new Date();
  await writeJson(`${prefix}import-started.json`, {
    importId,
    status: "IMPORT_IN_PROGRESS",
    startedAt: startedAt.toISOString(),
    startedBy: actorDetails(actor),
  });

  const results = [];
  const summary = {
    totalRows: rows.length,
    categoriesCreated: 0,
    subcategoriesCreated: 0,
    servicesCreated: 0,
    servicesUpdated: 0,
    productsCreated: 0,
    productsUpdated: 0,
    failed: 0,
  };

  for (const row of rows) {
    try {
      const outcome = await executeRow(row, actor);
      if (outcome.categoryResult === "CREATED") summary.categoriesCreated += 1;
      if (outcome.subcategoryResult === "CREATED") summary.subcategoriesCreated += 1;
      if (row.kind === "service" && outcome.result === "CREATED") summary.servicesCreated += 1;
      if (row.kind === "service" && outcome.result === "UPDATED") summary.servicesUpdated += 1;
      if (row.kind === "product" && outcome.result === "CREATED") summary.productsCreated += 1;
      if (row.kind === "product" && outcome.result === "UPDATED") summary.productsUpdated += 1;
      results.push({
        row: row.rowNumber,
        action: row.action,
        type: row.kind,
        category: row.category.name,
        subcategory: row.subcategory.name,
        name: row.item.name,
        slug: row.item.slug,
        ...outcome,
      });
    } catch (error) {
      summary.failed += 1;
      if (error?.parentActions?.category?.result === "CREATED") summary.categoriesCreated += 1;
      if (error?.parentActions?.subcategory?.result === "CREATED") summary.subcategoriesCreated += 1;
      results.push({
        row: row.rowNumber,
        action: row.action,
        type: row.kind,
        category: row.category.name,
        subcategory: row.subcategory.name,
        name: row.item.name,
        slug: row.item.slug,
        result: "FAILED",
        parentActions: error?.parentActions || {},
        message: String(error?.message || "Import row failed").slice(0, 500),
      });
    }
  }

  const finishedAt = new Date();
  const audit = {
    importId,
    status: summary.failed ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
    originalFileName: metadata.originalFileName,
    backupCreatedAt: metadata.createdAt,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    executedBy: actorDetails(actor),
    summary,
    rows: results,
  };
  await writeJson(`${prefix}result.json`, audit);
  return audit;
}

async function listImportHistory(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 20) || 20, 1), 50);
  const listing = await storage.list({ prefix: importRoot(), limit: 500 });
  const folders = [...listing.folders].sort((a, b) => String(b.name).localeCompare(String(a.name))).slice(0, limit);
  const rows = [];
  for (const folder of folders) {
    if (!IMPORT_ID_PATTERN.test(folder.name)) continue;
    const prefix = `${importRoot()}${folder.name}/`;
    try {
      const result = await storage.getObject({ key: `${prefix}result.json`, maxBytes: 5 * 1024 * 1024 });
      rows.push(JSON.parse(result.body.toString("utf8")));
      continue;
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
    try {
      const metadataObject = await storage.getObject({ key: `${prefix}backup-metadata.json`, maxBytes: 1024 * 1024 });
      const metadata = JSON.parse(metadataObject.body.toString("utf8"));
      let started = null;
      try {
        const startedObject = await storage.getObject({ key: `${prefix}import-started.json`, maxBytes: 1024 * 1024 });
        started = JSON.parse(startedObject.body.toString("utf8"));
      } catch (error) {
        if (error?.status !== 404) throw error;
      }
      rows.push({
        importId: metadata.importId,
        status: started?.status || metadata.status,
        originalFileName: metadata.originalFileName,
        backupCreatedAt: metadata.createdAt,
        startedAt: started?.startedAt || null,
        executedBy: started?.startedBy || metadata.createdBy,
        summary: {},
      });
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
  }
  return rows;
}

function templateCsv() {
  return [
    "action,type,category,category_slug,category_description,category_display_order,category_visible,category_active,subcategory,subcategory_slug,subcategory_description,subcategory_display_order,subcategory_visible,subcategory_active,name,slug,short_description,description,display_order,visible,active",
    'CREATE,service,Carpenter,carpenter,Carpenter services,1,true,true,Door Carpenter,door-carpenter,Door repair and installation,1,true,true,Door Repair,door-repair,Repair damaged or misaligned doors,"Professional carpenter service for wooden door repair, alignment and fitting.",1,true,true',
    'UPDATE,service,Carpenter,carpenter,,,,,Door Carpenter,door-carpenter,,,,,Door Repair,door-repair,Updated short description,Updated service description,1,true,true',
  ].join("\n") + "\n";
}

module.exports = {
  MAX_CSV_BYTES,
  IMPORT_ID_PATTERN,
  generateImportId,
  parseCsvText,
  parseCsvBuffer,
  normalizeRow,
  decodeCsvUpload,
  buildPreview,
  prepareImport,
  executeImport,
  listImportHistory,
  templateCsv,
};
