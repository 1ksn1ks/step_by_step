// Highest whole number this account already used on a topic, plus one.
// No earlier marker or polygon from them means the next number is 1.
export function nextDrawNumber(messages, payer, kind) {
  const shape = kind === 'polygon' ? 'polygon' : 'marker';
  const numberKey = shape === 'polygon' ? 'numberOfPolygon' : 'numberOfMarker';
  const deleteKey = shape === 'polygon' ? 'deletePolygonNumber' : 'deleteMarkerNumber';
  const me = String(payer || '');
  let highest = 0;
  if (!me) return 1;
  for (const message of messages || []) {
    if (!message || String(message.payer || '') !== me) continue;
    const data = message[shape] && message[shape].data;
    if (!data) continue;
    for (const raw of [data[numberKey], data[deleteKey]]) {
      const n = Number(raw);
      if (Number.isInteger(n) && n > highest) highest = n;
    }
  }
  return highest + 1;
}
