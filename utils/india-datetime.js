"use strict";

const INDIA_OFFSET = "+05:30";
const INDIA_OFFSET_MINUTES = 330;

function validParts(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  if (![year, month, day, hour, minute, second, millisecond].every(Number.isInteger)) return false;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false;
  if (millisecond < 0 || millisecond > 999) return false;
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day
    && probe.getUTCHours() === hour
    && probe.getUTCMinutes() === minute
    && probe.getUTCSeconds() === second
    && probe.getUTCMilliseconds() === millisecond;
}

function indiaInstant(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  if (!validParts(year, month, day, hour, minute, second, millisecond)) return null;
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
      - INDIA_OFFSET_MINUTES * 60 * 1000,
  );
}

function parseIndiaDateTime(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  const raw = String(value || "").trim();
  if (!raw) return null;

  // HTML datetime-local values intentionally have no timezone. CRM users are
  // operating in India, so persist those values as the corresponding IST
  // instant rather than interpreting them in the hosting server timezone.
  const local = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (local) {
    const millisecond = Number(String(local[7] || "").padEnd(3, "0") || 0);
    return indiaInstant(
      Number(local[1]),
      Number(local[2]),
      Number(local[3]),
      Number(local[4]),
      Number(local[5]),
      Number(local[6] || 0),
      millisecond,
    );
  }

  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseIndiaDateOnly(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return indiaInstant(Number(match[1]), Number(match[2]), Number(match[3]));
}

function formatIndiaDateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const shifted = new Date(date.getTime() + (INDIA_OFFSET_MINUTES * 60 * 1000));
  return shifted.toISOString().slice(0, 10);
}

module.exports = {
  INDIA_OFFSET,
  INDIA_OFFSET_MINUTES,
  formatIndiaDateOnly,
  indiaInstant,
  parseIndiaDateOnly,
  parseIndiaDateTime,
  validParts,
};
