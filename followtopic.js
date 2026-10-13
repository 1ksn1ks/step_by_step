// A profile is connected to one topic. Shares are messages on that topic.
// Followers of that topic are one row each, same idea as a view count.
import { sendMessage, topicFollow } from './msgbackend';
import { signer, connectedAccount } from './web3';
import { profileTopics } from './loadalladata';
import { toast } from './toast';
import { noteShare } from './sharecount.js';

const PROFILE_BIO_TOPIC = '0.0.9759201';

export function sharePin(value) {
  if (Array.isArray(value) && value.length === 2 && !Array.isArray(value[0])) {
    const pair = value.map(Number);
    if (pair.every(Number.isFinite)) return pair;
  }
  if (typeof value === 'string' && value.includes(',')) {
    const pair = value.split(',').slice(0, 2).map((part) => Number(part.trim()));
    if (pair.every(Number.isFinite)) return pair;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const pin = sharePin(item);
      if (pin) return pin;
    }
  }
  return null;
}

function shareText(value) {
  if (Array.isArray(value)) return shareText(value[0]);
  return typeof value === 'string' ? value : '';
}

function fitShare(payload) {
  let body = JSON.stringify(payload);
  if (body.length <= 1000) return body;
  payload.share.msg = String(payload.share.msg || '').slice(0, 180);
  body = JSON.stringify(payload);
  if (body.length <= 1000) return body;
  payload.share.image = '';
  body = JSON.stringify(payload);
  if (body.length <= 1000) return body;
  payload.share.msg = String(payload.share.msg || '').slice(0, 40);
  return JSON.stringify(payload);
}

function shareReady(source) {
  if (!signer || !connectedAccount) {
    toast.error('Connect wallet first');
    return null;
  }
  const home = profileTopics[connectedAccount];
  if (!home) {
    toast.error('Connect a topic in Edit profile first');
    return null;
  }
  const pin = sharePin(source && source.coords);
  if (!source || !source.topicId || !source.created || !source.timestamp || !pin) {
    toast.error('This post cannot be shared');
    return null;
  }
  return { home, pin };
}

// The pin lands on the signed-in account's topic. The count lands on the
// original post, one person once. The wallet asks for each message.
export async function confirmShare(source) {
  const ready = shareReady(source);
  if (!ready) return false;
  const payload = {
    share: {
      topic: source.topicId,
      created: source.created,
      payer: source.payer || '',
      title: shareText(source.title).slice(0, 20),
      msg: shareText(source.msg),
      image: shareText(source.image),
      coords: ready.pin,
      pin: ready.pin,
      number: source.number == null ? '' : String(source.number),
      kind: source.kind || 'marker',
    },
  };
  toast.info('Confirm in wallet 👛');
  try {
    await sendMessage(ready.home, fitShare(payload));
  } catch (error) {
    console.error('share pin failed', error);
    return false;
  }
  try {
    await sendMessage(source.topicId, JSON.stringify({ sharePost: { timestamp: source.timestamp } }));
  } catch (error) {
    console.error('share count failed', error);
    toast.error('Share count was not saved');
    return false;
  }
  noteShare({ payer: connectedAccount, sharePost: { timestamp: source.timestamp } }, source.topicId);
  toast.success('Shared');
  return true;
}

// Taking a share back drops that person from the count. The pin message
// is sent only when a topic is still connected.
export async function unshareFromMyTopic(source) {
  if (!signer || !connectedAccount) {
    toast.error('Connect wallet first');
    return false;
  }
  if (!source || !source.topicId || !source.timestamp) {
    toast.error('This post cannot be shared');
    return false;
  }
  toast.info('Confirm in wallet 👛');
  try {
    await sendMessage(source.topicId, JSON.stringify({ unsharePost: { timestamp: source.timestamp } }));
  } catch (error) {
    console.error('unshare count failed', error);
    return false;
  }
  noteShare({ payer: connectedAccount, unsharePost: { timestamp: source.timestamp } }, source.topicId);
  const home = profileTopics[connectedAccount];
  if (home && source.created) {
    try {
      await sendMessage(home, JSON.stringify({ unshare: { topic: source.topicId, created: source.created } }));
    } catch (error) {
      console.error('unshare pin failed', error);
      toast.error('The pin is still on your topic');
      return true;
    }
  }
  toast.success('Share removed');
  return true;
}

export function followerLabel(n) {
  return n === 1 ? '1 follower' : n + ' followers';
}

// The count, plus Follow or Unfollow. Hidden on your own topic.
export function followControls(topicId, ownerAccount) {
  const box = document.createElement('div');
  box.className = 'topic-follow';
  if (!topicId) return box;
  const count = document.createElement('div');
  count.className = 'topic-follow-count';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'topic-follow-btn';
  box.append(count, btn);
  let following = false;

  function paint(data) {
    if (!data) return;
    count.textContent = followerLabel(data.followers);
    following = !!data.following;
    const mine = !!(ownerAccount && connectedAccount && ownerAccount === connectedAccount);
    btn.hidden = mine;
    btn.textContent = following ? 'Unfollow' : 'Follow';
  }

  topicFollow(topicId, connectedAccount || '', null).then(paint);

  btn.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (!signer || !connectedAccount) {
      toast.error('Connect wallet first');
      return;
    }
    const next = !following;
    try {
      toast.info('Confirm in wallet 👛');
      const body = JSON.stringify(next ? { follow: { follow: '1' } } : { unfollow: { unfollow: '1' } });
      await sendMessage(topicId, body);
      paint(await topicFollow(topicId, connectedAccount, next ? 1 : 0));
    } catch (error) {
      console.error('follow failed', error);
    }
  });
  return box;
}

export async function connectProfileTopic(topicId) {
  if (!signer || !connectedAccount) {
    toast.error('Connect wallet first');
    return false;
  }
  const topic = String(topicId || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(topic)) {
    toast.error('Enter a topic id');
    return false;
  }
  toast.info('Confirm in wallet 👛');
  await sendMessage(PROFILE_BIO_TOPIC, JSON.stringify({ data: { profileTopic: topic } }));
  const { showOwnProfile } = await import('./loadalladata');
  showOwnProfile(connectedAccount, { topic });
  toast.success('Topic connected');
  return true;
}

export async function removeProfileTopic() {
  if (!signer || !connectedAccount) {
    toast.error('Connect wallet first');
    return false;
  }
  if (!profileTopics[connectedAccount]) {
    toast.error('No topic connected');
    return false;
  }
  toast.info('Confirm in wallet 👛');
  await sendMessage(PROFILE_BIO_TOPIC, JSON.stringify({ data: { clearProfileTopic: '1' } }));
  const { showOwnProfile } = await import('./loadalladata');
  showOwnProfile(connectedAccount, { topic: '' });
  toast.success('Topic removed');
  return true;
}
