// Start new month (📚 STACK panel). A year topic can list every month, and
// news for a month is posted to that month's topic. This makes the month's
// topic in one flow:
//   1. create the topic (createTopic, with the year topic's memo, so the
//      same admins run it),
//   2. name it "<year topic name> - YYYY-MM" (changeName),
//   3. stack it on the year topic (addTopic).
// Each step is one wallet approval. The plan is shown first and runs only
// on Confirm. Only the year topic's memo admins may run it (anyone when
// the memo lists none), the same rule every stack message is read by.
// Nothing is removed. Every month stays listed. A load reads the newest 8,
// or the admin's pins.

import { toast } from './toast';
import { createTopic, getTopicInfo } from './hedera';
import { sendMessage } from './msgbackend';
import { getTopicData } from './topicdata';
import { connectedAccount, signer } from './web3';
import { loadedDomains } from './loaddomains';
import { initialTopicId } from './extracttopic.js';
import {
  addTopicMessage,
  adminsFromMemo,
  changeNameMessage,
  currentTopicName,
  isMonthKey,
  isTopicId,
  monthKey,
  monthTopicName,
} from './loadcurrenttopic.js';

const card = document.getElementById('stack-month');
const monthInput = document.getElementById('stack-month-value');
const startBtn = document.getElementById('stack-month-start');
const planBox = document.getElementById('stack-month-plan');
const planText = document.getElementById('stack-month-plan-text');
const confirmBtn = document.getElementById('stack-month-confirm');
const cancelBtn = document.getElementById('stack-month-cancel');
const status = document.getElementById('stack-month-status');

let plan = null;
let running = false;

function say(text) {
  if (status) status.textContent = text;
}

// The panel's main topic (a domain resolves to its topic), else the topic
// open on the map and in the feed.
function mainTopic() {
  const field = document.getElementById('stack-topic-ids-topic');
  const typed = field ? field.value.trim().toLowerCase() : '';
  if (typed) {
    const domain = loadedDomains.find((entry) => entry.domain === typed);
    return domain && domain.lastMessage ? domain.lastMessage.topic : typed;
  }
  const open = document.getElementById('input-field');
  const value = open ? open.value.trim() : '';
  return isTopicId(value) ? value : initialTopicId;
}

function busy(on) {
  running = on;
  for (const button of [startBtn, confirmBtn, cancelBtn]) if (button) button.disabled = on;
}

function hidePlan() {
  plan = null;
  if (planBox) planBox.hidden = true;
}

async function prepare() {
  hidePlan();
  if (!signer || !connectedAccount) {
    toast.error('Connect wallet first');
    return;
  }
  const yearTopic = String(mainTopic() || '').trim();
  if (!isTopicId(yearTopic)) {
    toast.error('Enter the main Topic ID first');
    return;
  }
  const month = monthInput && isMonthKey(monthInput.value) ? monthInput.value : '';
  if (!month) {
    toast.error('Pick a month');
    return;
  }
  busy(true);
  say(`Reading ${yearTopic}…`);
  try {
    const info = await getTopicInfo(yearTopic);
    if (!info) {
      say('');
      toast.error('Invalid Topic ID');
      return;
    }
    const admins = adminsFromMemo(info.memo);
    if (admins.length && !admins.includes(connectedAccount)) {
      say(`Only the admins of ${yearTopic} can start a month.`);
      toast.error('Only this topic’s admins can do this');
      return;
    }
    const data = await getTopicData(yearTopic, { force: true });
    const messages = (data && data.messages) || [];
    const yearName = currentTopicName(messages, admins);
    const name = monthTopicName(yearName || yearTopic, month);
    plan = { yearTopic, memo: String(info.memo || ''), name };
    let text = `Creates “${name}” and stacks it on ${yearTopic}${yearName ? ` (${yearName})` : ''}.`;
    text += ' Your wallet asks 3 times.';
    if (planText) planText.textContent = text;
    if (planBox) planBox.hidden = false;
    say('');
    if (confirmBtn) confirmBtn.focus({ preventScroll: true });
  } catch (error) {
    console.error('start month check failed', error);
    say('Could not read that topic. Try again.');
  } finally {
    busy(false);
  }
}

async function step(label, run) {
  say(`${label} Confirm in your wallet.`);
  toast.info('Confirm in wallet 👛');
  return run();
}

async function confirmPlan() {
  if (!plan || running) return;
  const { yearTopic, memo, name } = plan;
  hidePlan();
  busy(true);
  let monthTopic = '';
  try {
    monthTopic = await step('Creating the month’s topic.', () => createTopic({ memo }));
    await step(`Naming ${monthTopic}.`, () => sendMessage(monthTopic, changeNameMessage(name)));
    await step(`Stacking ${monthTopic} on ${yearTopic}.`, () => sendMessage(yearTopic, addTopicMessage([monthTopic])));
  } catch (error) {
    console.error('start month failed', error);
    if (monthTopic) {
      // The topic exists; the Stack button below can finish the job.
      const field = document.getElementById('stack-topic-add-remove-topic');
      if (field) field.value = monthTopic;
      say(`${monthTopic} was created but not stacked. Press Stack to add it to ${yearTopic}.`);
    } else {
      say('No topic was created.');
    }
    toast.error('Start new month stopped');
    busy(false);
    return;
  }
  say(`“${name}” (${monthTopic}) is stacked on ${yearTopic}.`);
  toast.success('Month started');
  busy(false);
}

if (card && monthInput && startBtn) {
  if (!monthInput.value) monthInput.value = monthKey(new Date());
  startBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!running) prepare();
  });
  if (confirmBtn) confirmBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    confirmPlan();
  });
  if (cancelBtn) cancelBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    hidePlan();
    say('');
    startBtn.focus({ preventScroll: true });
  });
  // A new month or a new main topic needs a new plan.
  monthInput.addEventListener('input', hidePlan);
  const field = document.getElementById('stack-topic-ids-topic');
  if (field) field.addEventListener('input', hidePlan);
}
