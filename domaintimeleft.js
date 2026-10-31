import { loadedDomains } from "./loaddomains";

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9.-]{0,61}[a-z0-9])?$/i;
const TOPIC_RE = /^\d+\.\d+\.\d+$/;

function domainTokenOk(value) {
  return DOMAIN_RE.test(value);
}

function extendInputOk(value) {
  return TOPIC_RE.test(value) || DOMAIN_RE.test(value);
}

function syncExtendButton() {
  const btn = document.getElementById("button5");
  const domain = document.getElementById("domain-name-input").value;
  const topic = document.getElementById("domain-topic-id").value;
  const ok = domainTokenOk(domain) && extendInputOk(topic);
  btn.disabled = !ok;
  btn.setAttribute("aria-disabled", ok ? "false" : "true");
}

function paintStatus(kind, text) {
  const el = document.getElementById("domain-time-left");
  el.hidden = false;
  el.classList.remove("is-checking", "is-available", "is-taken");
  el.classList.add(kind);
  el.textContent = text;
}

let checkToken = 0;

document.getElementById("button4").addEventListener("click", async () => {
  const token = ++checkToken;
  const domain = document.getElementById("domain-name-input").value.toLowerCase();
  paintStatus("is-checking", "Checking");
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  if (token !== checkToken) return;

  const domainObject = loadedDomains.find(d => d.domain === domain);

  console.log('[check-domain] input:', JSON.stringify(domain), '| loadedDomains count:', loadedDomains.length);

  if (domainObject) {
    console.log('[check-domain] FOUND:', domainObject.domain, '| addedTime:', domainObject.addedTime);
    paintStatus("is-taken", "Taken");
  } else {
    const ci = loadedDomains.find(d => String(d.domain).toLowerCase() === domain);
    console.warn('[check-domain] NOT FOUND in loadedDomains.');
    console.log('[check-domain] case-insensitive match:', ci ? ci.domain : 'none');
    console.log('[check-domain] sample loaded domains (first 10):', loadedDomains.slice(0, 10).map(d => d.domain));
    paintStatus("is-available", "Available");
  }
});

document.getElementById("domain-name-input").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  document.getElementById("button4").click();
});

document.getElementById("domain-name-input").addEventListener("input", syncExtendButton);
document.getElementById("domain-topic-id").addEventListener("input", syncExtendButton);

document.getElementById("domain-token-id").addEventListener("click", () => {
  navigator.clipboard.writeText("0.0.456858")
    .then(() => window.toast && window.toast.success("Copied to clipboard"))
    .catch((err) => console.error("Failed to copy: ", err));
});

syncExtendButton();
