// Display-only slider readouts. Never writes input.value or what gets saved.

const suffixes = new WeakMap();

function readoutNode(input) {
  if (!input) return null;
  if (input.id) {
    const pill = document.getElementById(input.id + "-pill");
    if (pill) return pill;
  }
  const row = input.parentElement;
  if (!row || !row.querySelector) return null;
  return row.querySelector(":scope > .mb-value-pill, :scope > .feed-settings-zoom-level");
}

function captureSuffix(input) {
  if (suffixes.has(input)) return suffixes.get(input);
  const node = readoutNode(input);
  const raw = node ? String(node.textContent || "") : "";
  const match = raw.match(/^\s*[+-]?(?:\d+\.?\d*|\.\d+)([\s\S]*)$/);
  const suffix = match ? match[1] : "";
  suffixes.set(input, suffix);
  return suffix;
}

function stepDecimals(input) {
  const step = input && input.getAttribute ? (input.getAttribute("step") || "") : "";
  const dot = step.indexOf(".");
  if (dot < 0) return 0;
  return step.length - dot - 1;
}

export function formatSliderValue(input, value) {
  const decimals = stepDecimals(input);
  const num = Number(value);
  const body = Number.isFinite(num) ? num.toFixed(decimals) : String(value ?? "");
  return body + captureSuffix(input);
}

export function applySliderValueWidth(input, node) {
  const target = node || readoutNode(input);
  if (!input || !target) return;
  captureSuffix(input);
  let widest = 0;
  const minAttr = input.getAttribute("min");
  const maxAttr = input.getAttribute("max");
  if (minAttr != null && minAttr !== "") {
    widest = Math.max(widest, formatSliderValue(input, minAttr).length);
  }
  if (maxAttr != null && maxAttr !== "") {
    widest = Math.max(widest, formatSliderValue(input, maxAttr).length);
  }
  if (!widest) widest = Math.max(1, formatSliderValue(input, input.value).length);
  const width = widest + "ch";
  if (target.style.getPropertyValue("--slider-value-w").trim() === width) return;
  target.style.setProperty("--slider-value-w", width);
}
