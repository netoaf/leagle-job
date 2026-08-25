export function repairMojibakeText(value) {
  const text = String(value ?? '');
  if (!/[\u00c3\u00c2\u00e2]/.test(text)) return text;

  try {
    const repaired = Buffer.from(text, 'latin1').toString('utf8');
    return mojibakeScore(repaired) < mojibakeScore(text) ? repaired : text;
  } catch {
    return text;
  }
}

function mojibakeScore(text) {
  return (String(text || '').match(/[\u00c3\u00c2\u00e2\ufffd]/g) || []).length;
}
