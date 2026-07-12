const mongoose = require("mongoose");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 4096;

function normalizeLimit(value, fallback = DEFAULT_LIMIT) {
  const fallbackNumber = Number(fallback);
  const safeFallback =
    Number.isInteger(fallbackNumber) && fallbackNumber > 0
      ? Math.min(MAX_LIMIT, fallbackNumber)
      : DEFAULT_LIMIT;
  if (value === undefined || value === null || value === "") return safeFallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return safeFallback;
  return Math.min(MAX_LIMIT, parsed);
}

function encodeValue(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw Object.assign(new Error("Cannot encode an invalid cursor date"), {
        status: 500,
      });
    }
    return { type: "date", value: value.toISOString() };
  }
  if (value instanceof mongoose.Types.ObjectId) {
    return { type: "objectId", value: value.toString() };
  }
  if (value === undefined) return { type: "undefined", value: null };
  if (value === null) return { type: "null", value: null };
  if (["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw Object.assign(new Error("Cannot encode an invalid cursor number"), {
        status: 500,
      });
    }
    return { type: typeof value, value };
  }
  throw Object.assign(new Error("Unsupported pagination cursor value"), {
    status: 500,
  });
}

function decodeValue(encoded) {
  if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) {
    throw new Error("Invalid cursor value");
  }
  switch (encoded.type) {
    case "date": {
      const value = new Date(encoded.value);
      if (!Number.isFinite(value.getTime())) throw new Error("Invalid cursor date");
      return value;
    }
    case "objectId":
      if (!mongoose.isValidObjectId(encoded.value)) {
        throw new Error("Invalid cursor object ID");
      }
      return new mongoose.Types.ObjectId(encoded.value);
    case "undefined":
      if (encoded.value !== null) throw new Error("Invalid cursor value");
      return undefined;
    case "null":
      if (encoded.value !== null) throw new Error("Invalid cursor value");
      return null;
    case "string":
      if (typeof encoded.value !== "string") throw new Error("Invalid cursor value");
      return encoded.value;
    case "number":
      if (typeof encoded.value !== "number" || !Number.isFinite(encoded.value)) {
        throw new Error("Invalid cursor value");
      }
      return encoded.value;
    case "boolean":
      if (typeof encoded.value !== "boolean") throw new Error("Invalid cursor value");
      return encoded.value;
    default:
      throw new Error("Invalid cursor value type");
  }
}

function normalizeSort(sort = { createdAt: -1, _id: -1 }) {
  if (!sort || typeof sort !== "object" || Array.isArray(sort)) {
    throw Object.assign(new Error("Pagination sort must be an object"), {
      status: 500,
    });
  }
  const entries = Object.entries(sort);
  if (!entries.length) entries.push(["createdAt", -1]);
  const normalized = entries.map(([field, direction]) => {
    if (
      !field ||
      field.startsWith("$") ||
      field.includes("\0") ||
      field.includes(".")
    ) {
      throw Object.assign(new Error("Pagination sort field is invalid"), {
        status: 500,
      });
    }
    return [field, Number(direction) === 1 ? 1 : -1];
  });
  if (!normalized.some(([field]) => field === "_id")) {
    const lastDirection = normalized[normalized.length - 1][1];
    normalized.push(["_id", lastDirection]);
  }
  return Object.fromEntries(normalized);
}

function encodeCursor(row, sort) {
  if (!row || typeof row !== "object") {
    throw Object.assign(new Error("Cannot encode an empty pagination cursor"), {
      status: 500,
    });
  }
  const normalizedSort = normalizeSort(sort);
  const payload = {
    version: 1,
    sort: Object.entries(normalizedSort),
    values: Object.keys(normalizedSort).map((field) => [
      field,
      encodeValue(row[field]),
    ]),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(token, sort) {
  if (!token) return null;
  try {
    const raw = String(token);
    if (raw.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) {
      throw new Error("Invalid cursor token");
    }
    const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const normalizedSort = normalizeSort(sort);
    const expectedEntries = Object.entries(normalizedSort);
    if (
      payload?.version !== 1 ||
      JSON.stringify(payload.sort) !== JSON.stringify(expectedEntries) ||
      !Array.isArray(payload.values) ||
      payload.values.length !== expectedEntries.length
    ) {
      throw new Error("Cursor does not match this list");
    }

    const values = {};
    for (let index = 0; index < expectedEntries.length; index += 1) {
      const [expectedField] = expectedEntries[index];
      const pair = payload.values[index];
      if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== expectedField) {
        throw new Error("Cursor fields do not match this list");
      }
      values[expectedField] = decodeValue(pair[1]);
    }
    return values;
  } catch (_error) {
    throw Object.assign(new Error("Invalid pagination cursor"), { status: 400 });
  }
}

function buildCursorCondition(sort, values) {
  if (!values) return null;
  const normalizedSort = normalizeSort(sort);
  const entries = Object.entries(normalizedSort);
  for (const [field] of entries) {
    if (!Object.prototype.hasOwnProperty.call(values, field)) {
      throw Object.assign(new Error("Invalid pagination cursor"), { status: 400 });
    }
  }
  const branches = entries.map(([field, direction], index) => {
    const branch = {};
    for (let previous = 0; previous < index; previous += 1) {
      const previousField = entries[previous][0];
      branch[previousField] = values[previousField];
    }
    branch[field] = {
      [direction === 1 ? "$gt" : "$lt"]: values[field],
    };
    return branch;
  });
  return { $or: branches };
}

function mergeQuery(query, cursorCondition) {
  if (!cursorCondition) return query || {};
  if (!query || !Object.keys(query).length) return cursorCondition;
  return { $and: [query, cursorCondition] };
}

async function cursorPaginate(
  Model,
  {
    query = {},
    sort = { createdAt: -1, _id: -1 },
    limit = DEFAULT_LIMIT,
    cursor = "",
    select,
  } = {},
) {
  if (!Model || typeof Model.find !== "function") {
    throw Object.assign(new Error("Pagination model is invalid"), { status: 500 });
  }
  const normalizedLimit = normalizeLimit(limit);
  const normalizedSort = normalizeSort(sort);
  const cursorValues = decodeCursor(cursor, normalizedSort);
  const cursorCondition = buildCursorCondition(normalizedSort, cursorValues);
  let databaseQuery = Model.find(mergeQuery(query, cursorCondition))
    .sort(normalizedSort)
    .limit(normalizedLimit + 1);

  if (select) databaseQuery = databaseQuery.select(select);

  const rows = await databaseQuery.lean();
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error("Paginated query returned an invalid result"), {
      status: 500,
    });
  }
  const hasNext = rows.length > normalizedLimit;
  const data = hasNext ? rows.slice(0, normalizedLimit) : rows;
  const nextCursor =
    hasNext && data.length
      ? encodeCursor(data[data.length - 1], normalizedSort)
      : "";

  return {
    data,
    pagination: {
      limit: normalizedLimit,
      returned: data.length,
      hasNext,
      nextCursor,
    },
  };
}

function getPagination(query = {}) {
  const cursor = query.cursor === undefined || query.cursor === null
    ? ""
    : String(query.cursor);
  if (cursor.length > MAX_CURSOR_LENGTH) {
    throw Object.assign(new Error("Invalid pagination cursor"), { status: 400 });
  }
  return {
    limit: normalizeLimit(query.limit),
    cursor,
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_CURSOR_LENGTH,
  normalizeLimit,
  normalizeSort,
  encodeCursor,
  decodeCursor,
  buildCursorCondition,
  mergeQuery,
  cursorPaginate,
  getPagination,
};
