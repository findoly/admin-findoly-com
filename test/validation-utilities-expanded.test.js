const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validationError,
  textValue,
  emailValue,
  enumValue,
  booleanValue,
  numberValue,
  dateOnlyValue,
  dateTimeValue,
  pincodeValue,
  tokenValue,
  identifierValue,
  stringArrayValue,
  plainObjectValue,
  queryTextValue,
  assertImmutableFields,
} = require("../utils/validation");

function throwsStatus(fn, pattern = /./, status = 400) {
  assert.throws(fn, (error) => {
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });
}

const textCases = [
  ["text trims surrounding spaces", () => assert.equal(textValue("  hello  "), "hello")],
  ["text keeps internal spacing", () => assert.equal(textValue("hello   world"), "hello   world")],
  ["text uses fallback when missing", () => assert.equal(textValue(undefined, { fallback: "fallback" }), "fallback")],
  ["text accepts an empty optional value", () => assert.equal(textValue(""), "")],
  ["text rejects missing required value", () => throwsStatus(() => textValue(undefined, { required: true, label: "Name" }), /Name is required/)],
  ["text rejects whitespace-only required value", () => throwsStatus(() => textValue("   ", { required: true, label: "Name" }), /required/)],
  ["text enforces minimum meaningful length", () => throwsStatus(() => textValue("ab", { minLength: 3, label: "Code" }), /at least 3/)],
  ["text accepts minimum boundary", () => assert.equal(textValue("abc", { minLength: 3 }), "abc")],
  ["text enforces maximum length", () => throwsStatus(() => textValue("abcd", { maxLength: 3, label: "Code" }), /must not exceed 3/)],
  ["text accepts maximum boundary", () => assert.equal(textValue("abc", { maxLength: 3 }), "abc")],
  ["text rejects objects", () => throwsStatus(() => textValue({ value: "x" }), /must be text/)],
  ["text rejects functions", () => throwsStatus(() => textValue(() => "x"), /must be text/)],
  ["text rejects null bytes", () => throwsStatus(() => textValue("a\0b", { label: "Text" }), /invalid character/)],
  ["text preserveWhitespace retains outer whitespace", () => assert.equal(textValue("  note  ", { preserveWhitespace: true }), "  note  ")],
  ["text preserveWhitespace still rejects blank required text", () => throwsStatus(() => textValue("   ", { preserveWhitespace: true, required: true }), /required/)],
];
for (const [name, fn] of textCases) test(name, fn);

const emailCases = [
  ["email lowercases a valid address", () => assert.equal(emailValue(" Admin@Example.COM "), "admin@example.com")],
  ["email allows an empty optional address", () => assert.equal(emailValue(""), "")],
  ["email rejects a missing required address", () => throwsStatus(() => emailValue("", { required: true }), /required/)],
  ["email rejects missing at sign", () => throwsStatus(() => emailValue("admin.example.com"), /invalid/)],
  ["email rejects missing domain suffix", () => throwsStatus(() => emailValue("admin@example"), /invalid/)],
  ["email rejects spaces", () => throwsStatus(() => emailValue("admin @example.com"), /invalid/)],
  ["email rejects more than 254 characters", () => throwsStatus(() => emailValue(`${"a".repeat(250)}@x.com`), /must not exceed/)],
];
for (const [name, fn] of emailCases) test(name, fn);

const enumCases = [
  ["enum normalizes to lowercase", () => assert.equal(enumValue(" ACTIVE ", ["active", "inactive"]), "active")],
  ["enum accepts an exact value without normalization", () => assert.equal(enumValue("Open", ["Open"], { normalize: false }), "Open")],
  ["enum uses fallback", () => assert.equal(enumValue(undefined, ["new", "done"], { fallback: "new" }), "new")],
  ["enum rejects an unsupported value", () => throwsStatus(() => enumValue("other", ["new", "done"], { label: "Status" }), /must be one of/)],
  ["enum permits empty optional value", () => assert.equal(enumValue("", ["new"], { required: false }), "")],
  ["enum rejects empty required value", () => throwsStatus(() => enumValue("", ["new"]), /required/)],
];
for (const [name, fn] of enumCases) test(name, fn);

const booleanCases = [
  ["boolean accepts true", () => assert.equal(booleanValue(true), true)],
  ["boolean accepts false", () => assert.equal(booleanValue(false), false)],
  ["boolean accepts numeric one", () => assert.equal(booleanValue(1), true)],
  ["boolean accepts numeric zero", () => assert.equal(booleanValue(0), false)],
  ["boolean accepts yes", () => assert.equal(booleanValue("yes"), true)],
  ["boolean accepts on", () => assert.equal(booleanValue("on"), true)],
  ["boolean accepts no", () => assert.equal(booleanValue("no"), false)],
  ["boolean accepts off", () => assert.equal(booleanValue("off"), false)],
  ["boolean accepts string false without truthiness bug", () => assert.equal(booleanValue("false"), false)],
  ["boolean uses fallback", () => assert.equal(booleanValue(undefined, { fallback: true }), true)],
  ["boolean rejects ambiguous text", () => throwsStatus(() => booleanValue("sometimes"), /true or false/)],
];
for (const [name, fn] of booleanCases) test(name, fn);

const numberCases = [
  ["number parses a numeric string", () => assert.equal(numberValue("12.5"), 12.5)],
  ["number accepts zero at a zero minimum", () => assert.equal(numberValue(0, { min: 0 }), 0)],
  ["number uses fallback", () => assert.equal(numberValue("", { fallback: 7 }), 7)],
  ["number returns undefined for an optional missing value", () => assert.equal(numberValue(undefined, { required: false }), undefined)],
  ["number rejects booleans", () => throwsStatus(() => numberValue(true), /must be a number/)],
  ["number rejects NaN", () => throwsStatus(() => numberValue(Number.NaN), /valid number/)],
  ["number rejects Infinity", () => throwsStatus(() => numberValue(Infinity), /valid number/)],
  ["number enforces minimum", () => throwsStatus(() => numberValue(-1, { min: 0 }), /at least 0/)],
  ["number accepts minimum boundary", () => assert.equal(numberValue(5, { min: 5 }), 5)],
  ["number enforces maximum", () => throwsStatus(() => numberValue(6, { max: 5 }), /must not exceed 5/)],
  ["number accepts maximum boundary", () => assert.equal(numberValue(5, { max: 5 }), 5)],
  ["number enforces whole values", () => throwsStatus(() => numberValue(1.2, { integer: true }), /whole number/)],
  ["number accepts a whole value", () => assert.equal(numberValue("12", { integer: true }), 12)],
];
for (const [name, fn] of numberCases) test(name, fn);

const dateCases = [
  ["date accepts a normal calendar date", () => assert.equal(dateOnlyValue("2026-07-12"), "2026-07-12")],
  ["date accepts a valid leap day", () => assert.equal(dateOnlyValue("2024-02-29"), "2024-02-29")],
  ["date rejects an invalid leap day", () => throwsStatus(() => dateOnlyValue("2025-02-29"), /invalid/)],
  ["date rejects an impossible month", () => throwsStatus(() => dateOnlyValue("2026-13-01"), /invalid/)],
  ["date rejects an impossible day", () => throwsStatus(() => dateOnlyValue("2026-04-31"), /invalid/)],
  ["date rejects a non-ISO format", () => throwsStatus(() => dateOnlyValue("12/07/2026"), /YYYY-MM-DD/)],
  ["date permits empty optional value", () => assert.equal(dateOnlyValue(""), "")],
  ["date rejects empty required value", () => throwsStatus(() => dateOnlyValue("", { required: true }), /required/)],
  ["date-time accepts ISO input", () => assert.equal(dateTimeValue("2026-07-12T10:30:00.000Z"), "2026-07-12T10:30:00.000Z")],
  ["date-time accepts datetime-local input", () => assert.equal(dateTimeValue("2026-07-12T10:30"), "2026-07-12T10:30")],
  ["date-time rejects invalid input", () => throwsStatus(() => dateTimeValue("not-a-date"), /invalid/)],
  ["date-time permits empty optional value", () => assert.equal(dateTimeValue(""), "")],
];
for (const [name, fn] of dateCases) test(name, fn);

const pincodeCases = [
  ["pincode accepts six digits starting from one to nine", () => assert.equal(pincodeValue("400001"), "400001")],
  ["pincode rejects a leading zero", () => throwsStatus(() => pincodeValue("012345"), /exactly 6 digits/)],
  ["pincode rejects five digits", () => throwsStatus(() => pincodeValue("40000"), /exactly 6 digits/)],
  ["pincode rejects letters", () => throwsStatus(() => pincodeValue("40000A"), /exactly 6 digits/)],
  ["pincode permits empty optional value", () => assert.equal(pincodeValue(""), "")],
];
for (const [name, fn] of pincodeCases) test(name, fn);

const tokenIdentifierCases = [
  ["token accepts words with hyphens and underscores", () => assert.equal(tokenValue("home-repair_2"), "home-repair_2")],
  ["token lowercases when requested", () => assert.equal(tokenValue("Home-Repair", { lowercase: true }), "home-repair")],
  ["token rejects spaces", () => throwsStatus(() => tokenValue("home repair"), /letters, numbers/)],
  ["token rejects slash characters", () => throwsStatus(() => tokenValue("home/repair"), /letters, numbers/)],
  ["token rejects a leading hyphen", () => throwsStatus(() => tokenValue("-repair"), /letters, numbers/)],
  ["identifier accepts colons and hyphens", () => assert.equal(identifierValue("REQ:2026-01_A"), "REQ:2026-01_A")],
  ["identifier rejects a leading colon", () => throwsStatus(() => identifierValue(":REQ"), /invalid/)],
  ["identifier rejects spaces", () => throwsStatus(() => identifierValue("REQ 1"), /invalid/)],
  ["identifier permits empty optional value", () => assert.equal(identifierValue("", { required: false }), "")],
];
for (const [name, fn] of tokenIdentifierCases) test(name, fn);

const arrayCases = [
  ["string array accepts an array", () => assert.deepEqual(stringArrayValue(["a", "b"]), ["a", "b"])],
  ["string array parses comma-separated text", () => assert.deepEqual(stringArrayValue("a, b,c"), ["a", "b", "c"])],
  ["string array removes blank values", () => assert.deepEqual(stringArrayValue(["a", "", "  ", "b"]), ["a", "b"])],
  ["string array removes duplicates while preserving order", () => assert.deepEqual(stringArrayValue(["b", "a", "b"]), ["b", "a"])],
  ["string array rejects non-list objects", () => throwsStatus(() => stringArrayValue({ a: 1 }), /must be a list/)],
  ["string array rejects object items", () => throwsStatus(() => stringArrayValue([{}]), /invalid item/)],
  ["string array enforces required output", () => throwsStatus(() => stringArrayValue([], { required: true }), /at least one item/)],
  ["string array enforces maximum item count", () => throwsStatus(() => stringArrayValue(["a", "b"], { maxItems: 1 }), /more than 1/)],
  ["string array enforces item length", () => throwsStatus(() => stringArrayValue(["abcd"], { itemMaxLength: 3 }), /must not exceed 3/)],
  ["string array applies an item validator", () => assert.deepEqual(stringArrayValue(["A"], { itemValidator: (value) => value.toLowerCase() }), ["a"])],
];
for (const [name, fn] of arrayCases) test(name, fn);

const objectCases = [
  ["plain object clones JSON-safe values", () => {
    const source = { name: "test", nested: { enabled: true }, values: [1, null] };
    const result = plainObjectValue(source);
    assert.deepEqual(result, source);
    assert.notEqual(result, source);
  }],
  ["plain object rejects arrays at the root", () => throwsStatus(() => plainObjectValue([]), /must be an object/)],
  ["plain object rejects Date values", () => throwsStatus(() => plainObjectValue({ when: new Date() }), /JSON-compatible/)],
  ["plain object rejects non-finite numbers", () => throwsStatus(() => plainObjectValue({ value: Infinity }), /invalid number/)],
  ["plain object rejects dollar-prefixed keys", () => throwsStatus(() => plainObjectValue({ $set: "x" }), /unsafe field name/)],
  ["plain object rejects dotted keys", () => throwsStatus(() => plainObjectValue({ "profile.name": "x" }), /unsafe field name/)],
  ["plain object rejects constructor keys", () => throwsStatus(() => plainObjectValue({ constructor: "x" }), /unsafe field name/)],
  ["plain object enforces maximum fields", () => throwsStatus(() => plainObjectValue({ a: 1, b: 2 }, { maxKeys: 1 }), /too many fields/)],
  ["plain object enforces maximum array length", () => throwsStatus(() => plainObjectValue({ list: [1, 2] }, { maxArrayLength: 1 }), /too many list items/)],
  ["plain object enforces nesting depth", () => throwsStatus(() => plainObjectValue({ a: { b: { c: 1 } } }, { maxDepth: 1 }), /nested too deeply/)],
  ["plain object enforces byte size", () => throwsStatus(() => plainObjectValue({ value: "x".repeat(50) }, { maxBytes: 10 }), /too large/)],
];
for (const [name, fn] of objectCases) test(name, fn);

test("query text trims values", () => assert.equal(queryTextValue("  plumber "), "plumber"));
test("query text returns empty for missing input", () => assert.equal(queryTextValue(undefined), ""));
test("query text enforces length", () => throwsStatus(() => queryTextValue("abcd", { maxLength: 3 }), /must not exceed/));
test("immutable helper accepts matching fields", () => assert.doesNotThrow(() => assertImmutableFields({ id: "one" }, { id: "one" }, ["id"])));
test("immutable helper rejects changed fields", () => throwsStatus(() => assertImmutableFields({ id: "one" }, { id: "two" }, ["id"]), /id cannot be changed/));
test("validation error carries a custom status", () => assert.equal(validationError("Conflict", 409).status, 409));
