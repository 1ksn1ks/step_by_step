// Options cards and the Toolbar "Update topic" page. Existing show, hide,
// and submit buttons keep their listeners. This file only opens them.

const TOPIC_ID = /^\d+\.\d+\.\d+$/;

function byId(id) {
  return document.getElementById(id);
}

function panelOpen(el) {
  if (!el) return false;
  if (el.classList.contains('is-feed-shell')) {
    const display = (el.style.display || '').trim();
    return display !== 'none';
  }
  const display = (el.style.display || '').trim();
  return display === 'flex' || display === 'block';
}

function selectedTopic() {
  const e2ee = byId('encrypted-chat-container');
  const e2eeId = byId('encrypted-chat-topic-id');
  if (panelOpen(e2ee) && e2eeId && e2eeId.value.trim()) return e2eeId.value.trim();
  const topic = byId('topic-chat-container');
  const topicId = byId('topic-chat-topic-id');
  if (panelOpen(topic) && topicId && topicId.value.trim()) return topicId.value.trim();
  const input = byId('input-field');
  if (input && input.value.trim()) return input.value.trim();
  const feed = byId('feed-layout');
  if (feed && feed.style.display !== 'none' && !feed.classList.contains('is-peek')) {
    const idLine = feed.querySelector('.feed-topic-id');
    if (idLine && !idLine.hidden) {
      const text = idLine.textContent.replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    const label = feed.querySelector('.feed-topic-label');
    if (label) {
      const text = label.textContent.replace(/\s+/g, ' ').trim();
      if (TOPIC_ID.test(text)) return text;
    }
  }
  return '';
}

function applySelectedTopic() {
  const id = selectedTopic();
  const input = byId('input-field');
  if (input && id) input.value = id;
  return id;
}

function paintUpdateTopicRow() {
  const row = byId('Update_Topic');
  const desc = byId('update-topic-desc');
  if (!row) return;
  const off = !selectedTopic();
  row.classList.toggle('is-disabled', off);
  row.setAttribute('aria-disabled', off ? 'true' : 'false');
  row.tabIndex = off ? -1 : 0;
  if (desc) desc.textContent = off ? 'Open a topic first' : 'Pin and passwords';
}

function fieldText(id) {
  const el = byId(id);
  if (!el) return '';
  return String(el.value || '').trim();
}

function paintValues(root) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll('[data-options-time]').forEach((el) => {
    const ids = el.getAttribute('data-options-time').split(',');
    const from = [fieldText(ids[0]), fieldText(ids[1])].filter(Boolean).join(' ');
    const to = [fieldText(ids[2]), fieldText(ids[3])].filter(Boolean).join(' ');
    const text = [from, to].filter(Boolean).join(' – ');
    el.textContent = text;
    el.hidden = !text;
  });
  scope.querySelectorAll('[data-options-from]').forEach((el) => {
    const node = byId(el.getAttribute('data-options-from'));
    const text = node ? String(node.value || '').split('\n')[0].trim() : '';
    el.textContent = text;
    el.hidden = !text;
  });
}

function optionsHost(node) {
  if (!node || !node.closest) return null;
  return node.closest('.topic-options-page, .load-options-body, #update-topic-column, #load-column');
}

function setFieldOpen(node, open) {
  const host = optionsHost(node);
  if (host) host.classList.toggle('is-field-open', open);
}

function hideEditors(node) {
  const host = optionsHost(node) || document;
  host.querySelectorAll('.topic-options-editor').forEach((el) => {
    el.style.display = 'none';
  });
}

function openHelp() {
  const overlay = byId('topic-options-help-overlay');
  if (overlay) overlay.style.display = 'block';
}

function clickId(id) {
  const btn = byId(id);
  if (btn) btn.click();
}

document.addEventListener('click', (event) => {
  const hit = event.target.closest('[data-options-open], [data-update-open], [data-options-back], [data-options-close], #topic-update-back, #help-topic-options, #help-e2ee-options, #help-load-options-page, #help-load-options-inline');
  if (!hit) return;
  event.stopPropagation();

  if (hit.id === 'help-topic-options' || hit.id === 'help-e2ee-options' || hit.id === 'help-load-options-page' || hit.id === 'help-load-options-inline') {
    openHelp();
    return;
  }

  if (hit.id === 'topic-update-back') {
    const hides = ['hide-pin-key-load', 'hide-change-password-load', 'hide-set-password-load'];
    for (const id of hides) {
      const btn = byId(id);
      if (btn && btn.style.display !== 'none') {
        clickId(id);
        break;
      }
    }
    const column = byId('update-topic-column');
    if (column) column.classList.remove('is-field-open');
    paintValues(column);
    return;
  }

  const back = hit.getAttribute('data-options-back');
  if (back) {
    hideEditors(hit);
    setFieldOpen(hit, false);
    clickId(back);
    paintValues(optionsHost(hit) || document);
    return;
  }

  const close = hit.getAttribute('data-options-close');
  if (close) {
    setFieldOpen(hit, false);
    clickId(close);
    return;
  }

  const update = hit.getAttribute('data-update-open');
  if (update) {
    applySelectedTopic();
    const column = byId('update-topic-column');
    if (column) column.classList.add('is-field-open');
    clickId(update);
    return;
  }

  const open = hit.getAttribute('data-options-open');
  if (!open) return;
  hideEditors(hit);
  if (open === 'show-unlock-load') {
    const wrap = byId('unlock-from-load');
    if (wrap) wrap.style.display = 'block';
  }
  setFieldOpen(hit, true);
  clickId(open);
  paintValues(optionsHost(hit) || document);
}, true);

['pin-publickkey-load', 'change-password-load', 'set-password-load'].forEach((id) => {
  const btn = byId(id);
  if (!btn) return;
  btn.addEventListener('click', () => { applySelectedTopic(); }, true);
});

function watchClosed(id) {
  const el = byId(id);
  if (!el) return;
  new MutationObserver(() => {
    if (el.style.display === 'none') {
      el.classList.remove('is-field-open');
      const body = el.closest('.load-options-body');
      if (body) body.classList.remove('is-field-open');
      const column = el.closest('#load-column');
      if (column) column.classList.remove('is-field-open');
      return;
    }
    paintValues(el);
  }).observe(el, { attributes: true, attributeFilter: ['style'] });
}

watchClosed('options-from-topic-chat');
watchClosed('options-from-encrypted-chat');
watchClosed('options-from-load');

document.addEventListener('input', () => paintValues(document));
document.addEventListener('change', () => paintValues(document));

['input-field', 'topic-chat-topic-id', 'encrypted-chat-topic-id'].forEach((id) => {
  const el = byId(id);
  if (el) el.addEventListener('input', paintUpdateTopicRow);
});

['encrypted-chat-container', 'topic-chat-container', 'feed-layout'].forEach((id) => {
  const el = byId(id);
  if (!el) return;
  new MutationObserver(paintUpdateTopicRow).observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
});

const feedIdLine = document.querySelector('#feed-layout .feed-topic-id');
const feedLabel = document.querySelector('#feed-layout .feed-topic-label');
if (feedIdLine) {
  new MutationObserver(paintUpdateTopicRow).observe(feedIdLine, {
    attributes: true, childList: true, characterData: true, subtree: true,
  });
}
if (feedLabel) {
  new MutationObserver(paintUpdateTopicRow).observe(feedLabel, {
    childList: true, characterData: true, subtree: true,
  });
}

window.applySelectedTopic = applySelectedTopic;
window.paintUpdateTopicRow = paintUpdateTopicRow;
paintUpdateTopicRow();
paintValues(document);
