function scoreToken(item = {}) {
  let score = 50;
  const flags = [];

  const lp = Number(item.lp_usd || 0);
  if (lp < 500) { score += 30; flags.push('Low LP'); }
  else if (lp < 2000) { score += 10; flags.push('Small LP'); }

  const top10 = Number(item.top10_percent ?? -1);
  if (top10 >= 0) {
    if (top10 > 75) { score += 25; flags.push('Top-10 concentrated'); }
    else if (top10 > 50) { score += 10; flags.push('Top-10 heavy'); }
  } else { score += 5; flags.push('Top10 unknown'); }

  if (item.owner_privileged === true) { score += 20; flags.push('Owner privileged'); }
  if (!item.verified) { score += 5; flags.push('Unverified contract'); }

  score = Math.max(0, Math.min(100, score));
  return { score, flags };
}

module.exports = { scoreToken };
