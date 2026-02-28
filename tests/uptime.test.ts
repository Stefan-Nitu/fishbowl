import { test, expect } from "bun:test";
import { parseDuration, formatDuration } from "../src/uptime";

// --- parseDuration ---

test("parseDuration: hours", () => {
  expect(parseDuration("4h")).toBe(4 * 3_600_000);
});

test("parseDuration: minutes", () => {
  expect(parseDuration("30m")).toBe(30 * 60_000);
});

test("parseDuration: seconds", () => {
  expect(parseDuration("10s")).toBe(10_000);
});

test("parseDuration: compound duration", () => {
  // Arrange
  const expected = 1 * 3_600_000 + 30 * 60_000;
  // Act & Assert
  expect(parseDuration("1h30m")).toBe(expected);
});

test("parseDuration: full compound", () => {
  // Arrange
  const expected = 2 * 3_600_000 + 15 * 60_000 + 30 * 1_000;
  // Act & Assert
  expect(parseDuration("2h15m30s")).toBe(expected);
});

test("parseDuration: bare number as milliseconds", () => {
  expect(parseDuration("5000")).toBe(5000);
});

test("parseDuration: days", () => {
  expect(parseDuration("1d")).toBe(86_400_000);
});

test("parseDuration: milliseconds unit", () => {
  expect(parseDuration("500ms")).toBe(500);
});

test("parseDuration: invalid returns null", () => {
  expect(parseDuration("")).toBeNull();
  expect(parseDuration("abc")).toBeNull();
  expect(parseDuration("h4")).toBeNull();
});

test("parseDuration: trims whitespace", () => {
  expect(parseDuration("  4h  ")).toBe(4 * 3_600_000);
});

// --- formatDuration ---

test("formatDuration: hours and minutes", () => {
  // Arrange
  const ms = 3 * 3_600_000 + 59 * 60_000 + 12 * 1_000;
  // Act & Assert
  expect(formatDuration(ms)).toBe("3h 59m 12s");
});

test("formatDuration: just minutes", () => {
  expect(formatDuration(5 * 60_000)).toBe("5m");
});

test("formatDuration: just seconds", () => {
  expect(formatDuration(45_000)).toBe("45s");
});

test("formatDuration: zero", () => {
  expect(formatDuration(0)).toBe("0s");
});

test("formatDuration: negative", () => {
  expect(formatDuration(-1000)).toBe("0s");
});

test("formatDuration: hours only (no trailing minutes/seconds)", () => {
  expect(formatDuration(2 * 3_600_000)).toBe("2h");
});
