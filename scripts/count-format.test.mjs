import test from "node:test";
import assert from "node:assert/strict";
import { formatCount, formatHbarCount } from "../countformat.js";

test("formatCount stays exact under 1,000 and cuts one decimal above it", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1000), "1k");
  assert.equal(formatCount(1049), "1k");
  assert.equal(formatCount(1999), "1.9k");
  assert.equal(formatCount(12345), "12.3k");
  assert.equal(formatCount(999999), "999.9k");
  assert.equal(formatCount(1000000), "1M");
  assert.equal(formatCount(1234567), "1.2M");
  assert.equal(formatCount(1e9), "1B");
  assert.equal(formatCount(Number.NaN), "0");
  assert.equal(formatCount(Infinity), "0");
  assert.equal(formatCount(-3), "0");
  assert.equal(formatCount(2000000), "2M");
});

test("formatHbarCount keeps two decimals under 1,000 and shortens from there", () => {
  assert.equal(formatHbarCount(0), "0.00");
  assert.equal(formatHbarCount(12.5), "12.50");
  assert.equal(formatHbarCount(999.99), "999.99");
  assert.equal(formatHbarCount(1234.56), "1.2k");
});
