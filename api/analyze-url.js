// ── NøFishing AI — URL Analysis Endpoint (heuristic + AI) ──
// Handles two modes:
//   1. { url } only → run heuristic engine, return { level, score, reasons }
//   2. { url, score, reasons } → run Claude AI analysis, return { level, reason }

const POPULAR_DOMAINS = [
  'google.com', 'facebook.com', 'amazon.com', 'apple.com', 'microsoft.com',
  'netflix.com', 'paypal.com', 'instagram.com', 'twitter.com', 'x.com',
  'linkedin.com', 'github.com', 'yahoo.com', 'chase.com', 'bankofamerica.com',
  'wellsfargo.com', 'citibank.com', 'dropbox.com', 'spotify.com', 'zoom.us',
  'outlook.com', 'office.com', 'icloud.com', 'whatsapp.com', 'telegram.org',
  'coinbase.com', 'binance.com', 'stripe.com', 'shopify.com', 'ebay.com',
  'walmart.com', 'target.com', 'bestbuy.com', 'usps.com', 'ups.com',
  'fedex.com', 'dhl.com', 'irs.gov', 'ssa.gov',
];

const SUSPICIOUS_TLDS = [
  '.xyz', '.top', '.club', '.work', '.click', '.link', '.info', '.buzz',
  '.gq', '.ml', '.cf', '.tk', '.ga', '.pw', '.cc', '.ws', '.icu',
  '.cam', '.rest', '.monster', '.surf', '.sbs', '.cfd',
];

const PHISHING_KEYWORDS = [
  'login', 'signin', 'sign-in', 'verify', 'verification', 'secure',
  'account', 'update', 'confirm', 'banking', 'password', 'credential',
  'suspend', 'locked', 'unauthorized', 'alert', 'urgent', 'expire',
  'recover', 'restore', 'wallet', 'authenticate',
];

const URL_SHORTENERS = [
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd',
  'buff.ly', 'adf.ly', 'bl.ink', 'lnkd.in', 'rb.gy', 'cutt.ly',
  'shorturl.at', 'tiny.cc',
];

const SAFE_DOMAINS = new Set([
  'google.com', 'www.google.com', 'google.co.uk', 'accounts.google.com',
  'facebook.com', 'www.facebook.com', 'amazon.com', 'www.amazon.com',
  'apple.com', 'www.apple.com', 'microsoft.com', 'www.microsoft.com',
  'github.com', 'www.github.com', 'stackoverflow.com',
  'wikipedia.org', 'en.wikipedia.org', 'youtube.com', 'www.youtube.com',
  'reddit.com', 'www.reddit.com', 'twitter.com', 'x.com',
  'linkedin.com', 'www.linkedin.com', 'netflix.com', 'www.netflix.com',
  'spotify.com', 'open.spotify.com', 'discord.com', 'slack.com',
  'zoom.us', 'nytimes.com', 'bbc.com', 'cnn.com',
]);

function extractRootDomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const ccSLDs = [
    'co.uk', 'com.au', 'co.nz', 'co.za', 'com.br', 'co.jp',
    'co.in', 'com.mx', 'co.kr', 'com.sg', 'com.hk', 'org.uk', 'net.au',
  ];
  const lastTwo = parts.slice(-2).join('.');
  if (parts.length >= 3 && ccSLDs.includes(lastTwo)) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function heuristicAnalyze(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { level: 'safe', score: 0, reasons: [] };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const fullUrl = parsedUrl.href.toLowerCase();
  const pathname = parsedUrl.pathname.toLowerCase();

  if (hostname === '' || hostname === 'localhost') {
    return { level: 'safe', score: 0, reasons: [] };
  }

  if (SAFE_DOMAINS.has(hostname) || SAFE_DOMAINS.has(extractRootDomain(hostname))) {
    return { level: 'safe', score: 0, reasons: [] };
  }

  let score = 0;
  const reasons = [];

  // 1. IP address as hostname
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    score += 40;
    reasons.push('IP address used instead of domain name');
  }

  // 2. Suspicious TLD
  const tld = '.' + hostname.split('.').pop();
  if (SUSPICIOUS_TLDS.includes(tld)) {
    score += 20;
    reasons.push('Suspicious top-level domain: ' + tld);
  }

  // 3. Excessive subdomains
  const domainParts = hostname.split('.');
  if (domainParts.length > 3) {
    score += 15;
    reasons.push('Excessive subdomains (' + domainParts.length + ' levels)');
  }

  // 4. Hyphens in domain
  const mainDomain = domainParts.slice(0, -1).join('.');
  const hyphenCount = (mainDomain.match(/-/g) || []).length;
  if (hyphenCount >= 2) {
    score += 15;
    reasons.push('Multiple hyphens in domain name');
  }

  // 5. Phishing keywords
  let keywordHits = 0;
  for (const kw of PHISHING_KEYWORDS) {
    if (hostname.includes(kw) || pathname.includes(kw)) {
      keywordHits++;
    }
  }
  if (keywordHits >= 3) {
    score += 30;
    reasons.push('Multiple phishing keywords detected (' + keywordHits + ')');
  } else if (keywordHits >= 1) {
    score += 10 * keywordHits;
    reasons.push('Phishing keyword' + (keywordHits > 1 ? 's' : '') + ' in URL');
  }

  // 6. Typosquatting
  const rootDomain = extractRootDomain(hostname);
  for (const legit of POPULAR_DOMAINS) {
    if (rootDomain === legit) continue;
    const dist = levenshtein(rootDomain.replace(/\.[^.]+$/, ''), legit.replace(/\.[^.]+$/, ''));
    if (dist > 0 && dist <= 2) {
      score += 35;
      reasons.push('Domain similar to ' + legit + ' (possible typosquatting)');
      break;
    }
  }

  // 7. Brand name in subdomain
  for (const legit of POPULAR_DOMAINS) {
    const brand = legit.replace(/\.[^.]+$/, '');
    if (hostname.includes(brand) && extractRootDomain(hostname) !== legit) {
      score += 30;
      reasons.push('Contains "' + brand + '" but hosted on different domain');
      break;
    }
  }

  // 8. URL shortener
  if (URL_SHORTENERS.some((s) => hostname === s || hostname.endsWith('.' + s))) {
    score += 15;
    reasons.push('URL shortener detected — destination unknown');
  }

  // 9. Punycode
  if (hostname.startsWith('xn--')) {
    score += 30;
    reasons.push('Internationalized domain name (possible homograph attack)');
  }

  // 10. Long URL
  if (fullUrl.length > 200) {
    score += 10;
    reasons.push('Unusually long URL (' + fullUrl.length + ' characters)');
  }

  // 11. @ in URL
  if (fullUrl.includes('@')) {
    score += 25;
    reasons.push('URL contains @ symbol (credential prefix trick)');
  }

  // 12. Dangerous protocol
  if (parsedUrl.protocol === 'data:' || parsedUrl.protocol === 'javascript:') {
    score += 50;
    reasons.push('Dangerous protocol: ' + parsedUrl.protocol);
  }

  // 13. HTTP on sensitive page
  if (parsedUrl.protocol === 'http:' && keywordHits > 0) {
    score += 15;
    reasons.push('Unencrypted connection on a login/verification page');
  }

  // 14. Double extension or encoded chars
  if (pathname.match(/\.(html|php|asp)\./)) {
    score += 20;
    reasons.push('Suspicious double file extension in URL path');
  }
  if (fullUrl.includes('%00') || fullUrl.includes('%2e%2e')) {
    score += 25;
    reasons.push('Encoded traversal characters in URL');
  }

  // ── Smishing Detection ──

  // 15. Fake delivery scams
  const deliveryBrands = ['tracking', 'delivery', 'shipment', 'package', 'parcel', 'usps', 'fedex', 'ups', 'dhl'];
  const deliveryActions = ['update', 'confirm', 'verify', 'hold', 'failed', 'reschedule', 'fee', 'pay'];
  if (deliveryBrands.some((w) => fullUrl.includes(w)) && deliveryActions.some((w) => fullUrl.includes(w))) {
    score += 25;
    reasons.push('Fake delivery/shipping scam pattern detected');
  }

  // 16. Fake toll/fine scams
  const tollKeywords = ['toll', 'ezpass', 'sunpass', 'fastrak', 'violation', 'fine', 'citation'];
  const tollActions = ['pay', 'due', 'unpaid', 'overdue', 'balance'];
  if (tollKeywords.some((w) => fullUrl.includes(w)) && tollActions.some((w) => fullUrl.includes(w))) {
    score += 30;
    reasons.push('Fake toll/fine payment scam pattern detected');
  }

  // 17. Fake bank/financial SMS scams
  const bankAlerts = ['alert', 'notification', 'security', 'unusual', 'suspicious'];
  const bankTargets = ['account', 'banking', 'card', 'transaction', 'transfer'];
  if (bankAlerts.some((w) => fullUrl.includes(w)) && bankTargets.some((w) => fullUrl.includes(w))) {
    score += 25;
    reasons.push('Fake bank/financial alert scam pattern detected');
  }

  // 18. Fake subscription renewal scams
  const subBrands = ['netflix', 'amazon', 'apple', 'spotify', 'hulu', 'disney'];
  const subActions = ['renew', 'renewal', 'billing', 'update', 'expire', 'suspended', 'verify'];
  const subBrandDomains = { netflix: 'netflix.com', amazon: 'amazon.com', apple: 'apple.com', spotify: 'spotify.com', hulu: 'hulu.com', disney: 'disney.com' };
  const matchedSubBrand = subBrands.find((w) => fullUrl.includes(w));
  if (matchedSubBrand && subActions.some((w) => fullUrl.includes(w))) {
    if (rootDomain !== subBrandDomains[matchedSubBrand]) {
      score += 20;
      reasons.push('Fake ' + matchedSubBrand + ' subscription renewal scam pattern detected');
    }
  }

  // 19. Fake prize/winner scams
  const prizeKeywords = ['winner', 'won', 'prize', 'reward', 'gift', 'congratulation', 'selected', 'chosen'];
  const prizeActions = ['claim', 'collect', 'redeem', 'free'];
  if (prizeKeywords.some((w) => fullUrl.includes(w)) && prizeActions.some((w) => fullUrl.includes(w))) {
    score += 35;
    reasons.push('Fake prize/winner scam pattern detected');
  }

  // ── Crypto & Investment Scam Detection ──

  const cryptoTokens = ['crypto', 'bitcoin', 'btc', 'eth', 'ethereum', 'usdt', 'wallet', 'coin', 'token', 'defi'];

  // 20. Fake crypto trading platform
  const tradingKeywords = ['trade', 'trading', 'invest', 'investment', 'profit', 'returns', 'yield', 'earn'];
  if (tradingKeywords.some((w) => fullUrl.includes(w)) && cryptoTokens.some((w) => fullUrl.includes(w))) {
    if (!SAFE_DOMAINS.has(hostname) && !SAFE_DOMAINS.has(rootDomain)) {
      score += 35;
      reasons.push('Fake crypto trading/investment platform pattern detected');
    }
  }

  // 21. Fake crypto giveaway
  const giveawayKeywords = ['giveaway', 'airdrop', 'free', 'bonus', 'double'];
  const giveawayCrypto = ['bitcoin', 'btc', 'eth', 'crypto', 'coin', 'token'];
  if (giveawayKeywords.some((w) => fullUrl.includes(w)) && giveawayCrypto.some((w) => fullUrl.includes(w))) {
    score += 40;
    reasons.push('Fake crypto giveaway/airdrop scam pattern detected');
  }

  // 22. Guaranteed returns scam
  const guaranteedKeywords = ['guaranteed', 'guarantee', 'risk-free', 'riskfree', '100%', 'daily-profit', 'daily-returns', 'passive-income', 'get-rich'];
  if (guaranteedKeywords.some((w) => fullUrl.includes(w))) {
    score += 40;
    reasons.push('Guaranteed returns/risk-free investment scam pattern detected');
  }

  // 23. Pig butchering / romance investment scam
  const pigButcherKeywords = ['investment-club', 'trading-group', 'vip-trading', 'private-trading', 'exclusive-trade', 'members-only', 'insider-trade'];
  if (pigButcherKeywords.some((w) => fullUrl.includes(w))) {
    score += 30;
    reasons.push('Exclusive/private trading group scam pattern detected');
  }

  // 24. Fake exchange/wallet
  const exchangeActions = ['withdraw', 'withdrawal', 'deposit', 'stake', 'staking', 'mining', 'miner', 'pool'];
  const exchangeCrypto = ['crypto', 'bitcoin', 'btc', 'eth', 'wallet', 'coin'];
  const legitExchanges = ['coinbase.com', 'binance.com', 'kraken.com', 'crypto.com', 'gemini.com', 'blockchain.com'];
  if (exchangeActions.some((w) => fullUrl.includes(w)) && exchangeCrypto.some((w) => fullUrl.includes(w))) {
    if (!legitExchanges.includes(rootDomain)) {
      score += 35;
      reasons.push('Fake crypto exchange/wallet scam pattern detected');
    }
  }

  // ── Calendar Scam Detection ──

  // 25. Google Calendar phishing relay
  const calendarInviteWords = ['invite', 'event', 'meeting', 'schedule'];
  const calendarRedirectWords = ['click', 'link', 'redirect', 'go', 'url', 'visit'];
  if (fullUrl.includes('calendar') && calendarInviteWords.some((w) => fullUrl.includes(w)) && calendarRedirectWords.some((w) => fullUrl.includes(w))) {
    score += 35;
    reasons.push('Google Calendar phishing relay pattern detected');
  }

  // 26. Google Forms/Drawings phishing relay
  const formsHosts = ['docs.google.com', 'forms.gle', 'forms.google.com'];
  const formsPathWords = ['forms', 'drawings'];
  const formsScamWords = ['prize', 'winner', 'verify', 'confirm', 'account', 'suspend', 'bitcoin', 'crypto', 'payment', 'invoice', 'overdue'];
  if (formsHosts.includes(hostname) && formsPathWords.some((w) => pathname.includes(w)) && formsScamWords.some((w) => fullUrl.includes(w))) {
    score += 30;
    reasons.push('Google Forms/Drawings used as phishing relay');
  }

  // 27. Suspicious .ics file
  const legitCalendarDomains = ['google.com', 'apple.com', 'microsoft.com', 'outlook.com', 'yahoo.com', 'zoom.us', 'calendly.com'];
  if (pathname.endsWith('.ics') && !legitCalendarDomains.includes(rootDomain)) {
    score += 35;
    reasons.push('Calendar file (.ics) download from suspicious domain');
  }

  // 28. Fake meeting/webinar link
  const meetingBrands = ['zoom', 'teams', 'webex', 'meet', 'gotomeeting', 'webinar'];
  const meetingScamWords = ['free', 'prize', 'winner', 'claim', 'verify', 'account', 'suspended', 'bitcoin', 'crypto', 'urgent', 'immediate'];
  const legitMeetingDomains = ['zoom.us', 'microsoft.com', 'webex.com', 'google.com', 'gotomeeting.com'];
  if (meetingBrands.some((w) => fullUrl.includes(w)) && meetingScamWords.some((w) => fullUrl.includes(w))) {
    if (!legitMeetingDomains.includes(rootDomain)) {
      score += 25;
      reasons.push('Fake meeting/webinar link with scam keywords detected');
    }
  }

  // Determine threat level
  let level = 'safe';
  if (score >= 60) {
    level = 'danger';
  } else if (score >= 30) {
    level = 'warning';
  }

  return { level, score, reasons };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url, score, reasons } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }

    // Mode 1: Heuristic scan (no score provided — called by scan.html)
    if (score === undefined || score === null) {
      let normalizedUrl = url.trim().replace(/^url:\s*/i, '');
      if (!/^https?:\/\//i.test(normalizedUrl)) {
        normalizedUrl = 'https://' + normalizedUrl;
      }
      const result = heuristicAnalyze(normalizedUrl);
      return res.status(200).json(result);
    }

    // Mode 2: AI analysis (score provided — called by extension for grey zone)
    const heuristicScore = score || 0;
    const heuristicReasons = Array.isArray(reasons) ? reasons.join(', ') : 'None';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: 'You are a cybersecurity expert analyzing URLs for phishing and scams. Respond with JSON only: {"level": "safe"|"warning"|"danger", "reason": "one sentence explanation"}. Be concise and decisive.',
        messages: [
          {
            role: 'user',
            content: `Analyze this URL for phishing/scam risk. URL: ${url}. Heuristic score: ${heuristicScore}/100. Heuristic flags: ${heuristicReasons}. Is this safe, a warning, or danger?`,
          },
        ],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const parsed = JSON.parse(text);

    return res.status(200).json({
      level: parsed.level,
      reason: parsed.reason,
    });
  } catch (err) {
    console.error('Analyze URL error:', err.message);
    return res.status(200).json({ level: 'safe', reason: 'AI analysis unavailable' });
  }
};
