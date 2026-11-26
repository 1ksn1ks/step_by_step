// The accounts the feed is following. feedlayout.js is the only writer
// (feedFollow.set). Comment filters read that same Set through feedFollowSet().
let followSet = null;

export const feedFollow = {
  get set() {
    return followSet;
  },
  set set(next) {
    followSet = next;
  },
};

export function feedFollowSet() {
  return followSet;
}
