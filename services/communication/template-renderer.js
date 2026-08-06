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

const templateParameterValues = function (template, variables, options = {}) {
  if (Array.isArray(options.override)) {
    return options.override.map(function (value) { return String(value ?? ""); });
  }
  const data = normalizeVariables(variables);
  const definitions = Array.isArray(template?.parameterDefinitions) ? template.parameterDefinitions : [];
  if (definitions.length) {
    return definitions.map(function (definition, index) {
      const positionKey = String(definition?.position || index + 1);
      const placeholderKey = String(definition?.placeholder || "");
      if (Object.prototype.hasOwnProperty.call(data, positionKey)) return String(data[positionKey] ?? "");
      if (placeholderKey && Object.prototype.hasOwnProperty.call(data, placeholderKey)) return String(data[placeholderKey] ?? "");
      return "";
    });
  }
  const buttonSource = Array.isArray(template?.buttons)
    ? template.buttons.map(function (button) { return button?.url || button?.text || ""; }).join("\n")
    : "";
  const source = [template?.headerText, template?.body, template?.footer, buttonSource]
    .filter(Boolean)
    .join("\n");
  const indexes = [...new Set(Array.from(source.matchAll(/{{\s*(\d+)\s*}}/g), function (match) {
    return Number(match[1]);
  }))].sort(function (left, right) { return left - right; });
  const values = indexes.length
    ? indexes.map(function (index) { return String(data[String(index)] ?? ""); })
    : orderedValues(data);
  if (Array.isArray(options.buttonValues)) {
    values.push(...options.buttonValues.map(function (value) { return String(value ?? ""); }));
  }
  return values;
};

module.exports = { normalizeVariables, renderText, orderedValues, templateParameterValues };
