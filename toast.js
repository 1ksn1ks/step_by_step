const DURATION = 2600;

function getContainer() {
  let el = document.getElementById("toast-container");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast-container";
    document.body.appendChild(el);
  }
  return el;
}

function show(message, type = "info", options = null) {
  const hold = !!(options && options.hold);
  const stay = !!(options && options.stay);
  const container = getContainer();

  const el = document.createElement("div");
  el.className = `toast toast-${type}${hold ? " toast-hold" : ""}`;

  if (type === "loaded") {
    // No dot icon: the shockwave ring + glow carry the effect
    const burst = document.createElement("span");
    burst.className = "toast-burst";
    burst.setAttribute("aria-hidden", "true");
    el.append(burst);
  }

  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;

  el.append(text);
  if (options && options.action) el.append(options.action);
  container.appendChild(el);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add("toast-show"));
  });

  let removed = false;
  const done = () => {
    if (removed) return;
    removed = true;
    el.remove();
  };

  if (!stay) {
    setTimeout(() => {
      if (removed) return;
      el.classList.remove("toast-show");
      el.classList.add(type === "loaded" ? "toast-hide-blast" : "toast-hide");
      el.addEventListener("transitionend", () => el.remove(), { once: true });
      el.addEventListener("animationend", () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 700);
    }, DURATION);
  }
  return { done };
}

export const toast = {
  success: (msg) => show(msg, "success"),
  error: (msg, options) => show(msg, "error", options),
  info: (msg) => show(msg, "info"),
  loaded: (msg) => show(msg, "loaded"),
  // Stays until done() unless options.stay is false. Used for the upload
  // steps that have to remain on screen while HashPack is open.
  hold: (msg, options) => show(msg, "info", { hold: true, stay: true, ...(options || {}) }),
};

window.toast = toast;
