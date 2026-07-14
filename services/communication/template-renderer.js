const { plainObjectValue, textValue } = require("../../utils/validation");

const normalizeVariables = function (variables) {
  if (Array.isArray(variables)) {
    const mapped = {};
    variables.forEach(function (value, index) {
      mapped[String(index + 1)] = value === undefined || value === null ? "" : String(value);
    });
    return mapped;
  }
  return plainObjectValue(variables || {}, {
    label: "Template variables",
    maxKeys: 100,
    maxDepth: 4,
    maxArrayLength: 50,
    maxBytes: 30000,
  });
};

const renderText = function (source, variables) {
  const text = textValue(source || "", {
    label: "Template content",
    maxLength: 100000,
    preserveWhitespace: true,
  });
  const data = normalizeVariables(variables);
  return text.replace(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g, function (match, key) {
    if (Object.prototype.hasOwnProperty.call(data, key)) return String(data[key] ?? "");
    return match;
  });
};

const orderedValues = function (variables) {
  const data = normalizeVariables(variables);
  const numeric = Object.keys(data)
    .filter(function (key) {
      return /^\d+$/.test(key);
    })
    .sort(function (a, b) {
      return Number(a) - Number(b);
    });
  if (numeric.length) {
    return numeric.map(function (key) {
      return String(data[key] ?? "");
    });
  }
  return Object.keys(data).map(function (key) {
    return String(data[key] ?? "");
  });
};

module.exports = { normalizeVariables, renderText, orderedValues };
