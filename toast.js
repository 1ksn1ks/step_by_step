const DURATION = 2600;

const ICONS = { success: "✓", error: "✕", info: "•" };

function getContainer() {
  let el = document.getElementById("toast-container");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-container";
    document.body.appendChild(el);
  }
  return el;
}

function show(message, type = "info") {
  const container = getContainer();

  const el = document.createElement("div");
  el.className = `toast toast-${type}`;

  if (type === "loaded") {
    // No dot icon: the shockwave ring + glow carry the effect
    const burst = document.createElement("span");
    burst.className = "toast-burst";
    burst.setAttribute("aria-hidden", "true");
    el.append(burst);
  } else {
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = ICONS[type] || ICONS.info;
    el.append(icon);
  }

  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;

  el.append(text);
  container.appendChild(el);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add("toast-show"));
  });

  setTimeout(() => {
    el.classList.remove("toast-show");
    el.classList.add(type === "loaded" ? "toast-hide-blast" : "toast-hide");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 700);
  }, DURATION);
}

export const toast = {
  success: (msg) => show(msg, "success"),
  error: (msg) => show(msg, "error"),
  info: (msg) => show(msg, "info"),
  loaded: (msg) => show(msg, "loaded"),
};

window.toast = toast;
