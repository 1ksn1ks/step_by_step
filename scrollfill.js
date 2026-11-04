// One scroll frame used to measure the column after every appended chunk.
// planFillDown decides the whole frame from a single sample: how many
// chunks to append, whether to ask for an older page, and whether another
// frame has to look because the card height is not known yet.

export const FILL_PASSES = 12;

export function planFillDown(input) {
  const view = Number(input.view) || 0;
  const chunk = input.chunk > 0 ? input.chunk : 1;
  const cap = input.cap > 0 ? input.cap : FILL_PASSES;
  const listLen = input.listLen > 0 ? input.listLen : 0;
  let rangeEnd = input.rangeEnd > 0 ? input.rangeEnd : 0;
  if (rangeEnd > listLen) rangeEnd = listLen;
  let height = Number(input.height) || 0;
  const top = Number(input.top) || 0;
  const avg = Number(input.avg) || 0;
  if (view < 1) {
    if (rangeEnd < listLen) return { chunks: 1, page: false, empty: false, again: false };
    return { chunks: 0, page: !!input.canPage, empty: false, again: false };
  }
  let chunks = 0;
  let room = height - top - view;
  while (chunks < cap) {
    const short = height <= view + 4;
    if (!short && room >= view * 2) {
      const page = !!(input.ranked && input.canPage);
      return { chunks, page, empty: !page, again: false };
    }
    if (rangeEnd < listLen) {
      if (!(avg > 0)) {
        const more = rangeEnd + chunk < listLen;
        return { chunks: 1, page: false, empty: false, again: more };
      }
      const take = Math.min(chunk, listLen - rangeEnd);
      const grow = avg * take;
      height += grow;
      room += grow;
      rangeEnd += take;
      chunks += 1;
      continue;
    }
    return { chunks, page: !!input.canPage, empty: !input.canPage, again: false };
  }
  return { chunks, page: false, empty: false, again: false };
}
