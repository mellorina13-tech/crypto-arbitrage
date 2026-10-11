// Crypto Arbitrage Engine (ported from the Syntex Terminal / secondberg engine).
//
// Design notes:
// - ONE bulk request per exchange fetches ALL USDT tickers (bid/ask/volume),
//   instead of per-symbol polling. 8 outbound requests cover ~3,000+ pairs.
// - Opportunities are computed from executable prices only: buy at the lowest
//   ask, sell at the highest bid. Corrupted quotes (>35% off the median mid)
//   are rejected before comparison.
// - Cost model: per-exchange taker fees + a per-coin transfer-network fee.
// - Net profit is recomputed per request (it depends on ?capital=), while the
//   raw scan is cached in module scope (45s) so warm requests cost ~nothing.
// - Edge cache header (s-maxage=15) dedupes concurrent visitors; cached edge
//   responses do not re-invoke this function.

const fetch = globalThis.fetch || require('node-fetch');

const UA = 'Mozilla/5.0 (compatible; ArbitrageScanner/3.0)';
const SCAN_CACHE_TTL_MS = 45 * 1000;
const TICKER_TTL_NOTE = 'module-scope caches; containers stay warm between polls';

// ─────────────────────────────────────────────────────────────────────────────
// Fee & transfer-network models
// ─────────────────────────────────────────────────────────────────────────────

const EXCHANGE_FEES = {
    Binance: { takerFeePct: 0.075, defaultWithdrawalFeeUSDT: 1.0 },
    KuCoin: { takerFeePct: 0.1, defaultWithdrawalFeeUSDT: 1.5 },
    'Gate.io': { takerFeePct: 0.12, defaultWithdrawalFeeUSDT: 1.5 },
    Bybit: { takerFeePct: 0.1, defaultWithdrawalFeeUSDT: 1.0 },
    OKX: { takerFeePct: 0.08, defaultWithdrawalFeeUSDT: 1.0 },
    MEXC: { takerFeePct: 0.05, defaultWithdrawalFeeUSDT: 1.0 },
    Bitget: { takerFeePct: 0.08, defaultWithdrawalFeeUSDT: 1.0 },
    Huobi: { takerFeePct: 0.2, defaultWithdrawalFeeUSDT: 1.0 },
    Coinbase: { takerFeePct: 0.4, defaultWithdrawalFeeUSDT: 2.0 },
    Kraken: { takerFeePct: 0.25, defaultWithdrawalFeeUSDT: 2.0 },
    Uniswap: { takerFeePct: 0.3, defaultWithdrawalFeeUSDT: 5.0 },
    Raydium: { takerFeePct: 0.25, defaultWithdrawalFeeUSDT: 0.05 },
};

function getRecommendedTransferNetwork(token) {
    switch (token.toUpperCase()) {
        case 'SOL':
        case 'JUP':
        case 'WIF':
        case 'BONK':
        case 'RENDER':
        case 'RAY':
        case 'POPCAT':
        case 'DRIFT':
        case 'FARTCOIN':
        case 'PURR':
            return { network: 'Solana (Fast / $0.05 fee)', time: '~5 Seconds', feeUSD: 0.05 };
        case 'BNB':
        case 'CAKE':
        case 'BABYDOGE':
            return { network: 'BNB Smart Chain (3s / $0.15 fee)', time: '~3 Seconds', feeUSD: 0.15 };
        case 'TON':
        case 'NOT':
        case 'DOGS':
            return { network: 'TON Network (10s / $0.10 fee)', time: '~10 Seconds', feeUSD: 0.10 };
        case 'AVAX':
            return { network: 'Avalanche C-Chain (2s / $0.20 fee)', time: '~2 Seconds', feeUSD: 0.20 };
        case 'SUI':
        case 'APT':
        case 'SEI':
            return { network: `${token} Native (Sub-second / $0.02 fee)`, time: '~1-2 Seconds', feeUSD: 0.02 };
        case 'NEAR':
            return { network: 'NEAR Protocol (3s / $0.05 fee)', time: '~3 Seconds', feeUSD: 0.05 };
        case 'DOT':
        case 'KSM':
            return { network: 'Polkadot Relay (6s / $0.10 fee)', time: '~6 Seconds', feeUSD: 0.10 };
        case 'AERO':
        case 'BRETT':
            return { network: 'Base Network (2s / $0.05 fee)', time: '~2 Seconds', feeUSD: 0.05 };
        case 'ARB':
            return { network: 'Arbitrum One (3s / $0.10 fee)', time: '~3 Seconds', feeUSD: 0.10 };
        case 'OP':
            return { network: 'Optimism Mainnet (3s / $0.10 fee)', time: '~3 Seconds', feeUSD: 0.10 };
        case 'MATIC':
        case 'POL':
            return { network: 'Polygon PoS (5s / $0.05 fee)', time: '~5 Seconds', feeUSD: 0.05 };
        default:
            return { network: 'USDT-TRC20 / Arbitrum One (1m / $1.00 fee)', time: '~1-2 Minutes', feeUSD: 1.0 };
    }
}

// Stablecoin bases and leveraged tokens produce depeg/leverage noise, not real
// spot arbitrage — skip them in the scanner.
const EXCLUDED_BASES = new Set([
    'USDC', 'TUSD', 'FDUSD', 'BUSD', 'DAI', 'USDP', 'USDE', 'AEUR', 'EUR',
    'USD1', 'XUSD', 'PYUSD', 'UST', 'BSCUSD', 'USDS', 'FRAX', 'USDD', 'EURI',
    'EURT', 'AGEUR', 'USDA', 'USDX', 'USDF', 'USR',
]);
const LEVERAGED_RE = /(?:3L|3S|5L|5S|2L|2S)$/;

// Known Coin Symbol to CoinGecko ID Map (for the Coin Matrix mode)
const COIN_ID_MAP = {
    BTC: { id: 'bitcoin', name: 'Bitcoin' },
    ETH: { id: 'ethereum', name: 'Ethereum' },
    SOL: { id: 'solana', name: 'Solana' },
    DOGE: { id: 'dogecoin', name: 'Dogecoin' },
    XRP: { id: 'ripple', name: 'Ripple' },
    BNB: { id: 'binancecoin', name: 'BNB' },
    SUI: { id: 'sui', name: 'Sui' },
    APT: { id: 'aptos', name: 'Aptos' },
    PEPE: { id: 'pepe', name: 'Pepe' },
    AVAX: { id: 'avalanche-2', name: 'Avalanche' },
    NEAR: { id: 'near', name: 'NEAR Protocol' },
    LINK: { id: 'chainlink', name: 'Chainlink' },
    TON: { id: 'the-open-network', name: 'Toncoin' },
    DOT: { id: 'polkadot', name: 'Polkadot' },
    ADA: { id: 'cardano', name: 'Cardano' },
    SHIB: { id: 'shiba-inu', name: 'Shiba Inu' },
    ARB: { id: 'arbitrum', name: 'Arbitrum' },
    OP: { id: 'optimism', name: 'Optimism' },
    INJ: { id: 'injective-protocol', name: 'Injective' },
    TIA: { id: 'celestia', name: 'Celestia' },
    RENDER: { id: 'render-token', name: 'Render' },
    FET: { id: 'fetch-ai', name: 'Artificial Superintelligence Alliance' },
    WIF: { id: 'dogwifcoin', name: 'dogwifhat' },
    BONK: { id: 'bonk', name: 'Bonk' },
    KAS: { id: 'kaspa', name: 'Kaspa' },
    JUP: { id: 'jupiter-exchange-solana', name: 'Jupiter' },
    ENA: { id: 'ethena', name: 'Ethena' },
    TAO: { id: 'bittensor', name: 'Bittensor' },
    LTC: { id: 'litecoin', name: 'Litecoin' },
    UNI: { id: 'uniswap', name: 'Uniswap' },
    RAY: { id: 'raydium', name: 'Raydium' },
    AERO: { id: 'aerodrome-finance', name: 'Aerodrome Finance' },
    ONDO: { id: 'ondo-finance', name: 'Ondo' },
    HYPE: { id: 'hyperliquid', name: 'Hyperliquid' },
    VIRTUAL: { id: 'virtual-protocol', name: 'Virtuals Protocol' },
    POPCAT: { id: 'popcat', name: 'Popcat' },
    SEI: { id: 'sei-network', name: 'Sei' },
    PYTH: { id: 'pyth-network', name: 'Pyth Network' },
    PENDLE: { id: 'pendle', name: 'Pendle' },
    AAVE: { id: 'aave', name: 'Aave' },
    STX: { id: 'blockstack', name: 'Stacks' },
    ICP: { id: 'internet-computer', name: 'Internet Computer' },
    CRV: { id: 'curve-dao-token', name: 'Curve DAO' },
    MKR: { id: 'maker', name: 'Maker' },
};

const round3 = (n) => parseFloat(n.toFixed(3));
const round2 = (n) => parseFloat(n.toFixed(2));

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper
// ─────────────────────────────────────────────────────────────────────────────

async function fetchJson(url, timeoutMs = 3500, headers = {}) {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': UA, ...headers },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk ticker fetchers — one request per exchange, ALL USDT spot pairs.
// Each returns Map<base, {exchange, bid, ask, last, vol, change24h?}>
// ─────────────────────────────────────────────────────────────────────────────

function fetchBinancePrices() {
    const map = new Map();
    return fetchJson('https://api.binance.com/api/v3/ticker/bookTicker').then((data) => {
        if (Array.isArray(data)) {
            for (const item of data) {
                const sym = item.symbol || '';
                if (sym.endsWith('USDT')) {
                    const base = sym.slice(0, -4).toUpperCase();
                    const bid = parseFloat(item.bidPrice) || 0;
                    const ask = parseFloat(item.askPrice) || 0;
                    if (bid > 0 && ask > 0) {
                        map.set(base, { exchange: 'Binance', bid, ask, last: (bid + ask) / 2, vol: 1500000 });
                    }
                }
            }
        }
        return map;
    }).catch(() => map);
}

function fetchKuCoinPrices() {
    const map = new Map();
    return fetchJson('https://api.kucoin.com/api/v1/market/allTickers').then((json) => {
        const list = json?.data?.ticker;
        if (Array.isArray(list)) {
            for (const item of list) {
                const sym = item.symbol || '';
                if (sym.endsWith('-USDT')) {
                    const base = sym.slice(0, -5).toUpperCase();
                    const bid = parseFloat(item.buy) || parseFloat(item.last) || 0;
                    const ask = parseFloat(item.sell) || parseFloat(item.last) || 0;
                    const vol = parseFloat(item.volValue) || 500000;
                    const change = parseFloat(item.changeRate) * 100 || 0;
                    if (bid > 0 && ask > 0) {
                        map.set(base, { exchange: 'KuCoin', bid, ask, last: (bid + ask) / 2, vol, change24h: change });
                    }
                }
            }
        }
        return map;
    }).catch(() => map);
}

function fetchGateIOPrices() {
    const map = new Map();
    return fetchJson('https://api.gateio.ws/api/v4/spot/tickers').then((data) => {
        if (Array.isArray(data)) {
            for (const item of data) {
                const pair = item.currency_pair || '';
                if (pair.endsWith('_USDT')) {
                    const base = pair.slice(0, -5).toUpperCase();
                    const bid = parseFloat(item.highest_bid) || parseFloat(item.last) || 0;
                    const ask = parseFloat(item.lowest_ask) || parseFloat(item.last) || 0;
                    const vol = parseFloat(item.quote_volume) || parseFloat(item.base_volume) || 300000;
                    const change = parseFloat(item.change_percentage) || 0;
                    if (bid > 0 && ask > 0) {
                        map.set(base, { exchange: 'Gate.io', bid, ask, last: (bid + ask) / 2, vol, change24h: change });
                    }
                }
            }
        }
        return map;
    }).catch(() => map);
}

function fetchBybitPrices() {
    const map = new Map();
    return fetchJson('https://api.bybit.com/v5/market/tickers?category=spot').then((json) => {
        const list = json?.result?.list;
        if (Array.isArray(list)) {
            for (const item of list) {
                const sym = item.symbol || '';
                if (sym.endsWith('USDT')) {
                    const base = sym.slice(0, -4).toUpperCase();
                    const bid = parseFloat(item.bid1Price) || parseFloat(item.lastPrice) || 0;
                    const ask = parseFloat(item.ask1Price) || parseFloat(item.lastPrice) || 0;
                    const vol = parseFloat(item.turnover24h) || parseFloat(item.volume24h) || 800000;
                    const change = parseFloat(item.price24hPcnt) * 100 || 0;
                    if (bid > 0 && ask > 0) {
                        map.set(base, { exchange: 'Bybit', bid, ask, last: (bid + ask) / 2, vol, change24h: change });
                    }
                }
            }
        }
        return map;
    }).catch(() => map);
}

function fetchOKXPrices() {
    const map = new Map();
    return fetchJson('https://www.okx.com/api/v5/market/tickers?instType=SPOT').then((json) => {
        const list = json?.data;
        if (Array.isArray(list)) {
            for (const item of list) {
                const instId = item.instId || '';
                if (instId.endsWith('-USDT')) {
                    const base = instId.slice(0, -5).toUpperCase();
                    const bid = parseFloat(item.bidPx) || parseFloat(item.last) || 0;
                    const ask = parseFloat(item.askPx) || parseFloat(item.last) || 0;
                    const vol = parseFloat(item.volCcy24h) || parseFloat(item.vol24h) || 600000;
                    if (bid > 0 && ask > 0) {
                        map.set(base, { exchange: 'OKX', bid, ask, last: (bid + ask) / 2, vol });
                    }
                }
            }
        }
        return map;
    }).catch(() => map);
}

function fetchMEXCPrices() {
    const map = new Map();
    return fetchJson('https://api.mexc.com/api/v3/ticker/bookTicker').then((data) => {
        if (Array.isArray(data)) {
            for (const item of data) {
                const sym = item.symbol || '';
                if (sym.endsWith('USDT')) {
                    const base = sym.slice(0, -4).toUpperCase();
                    const bid = parseFloat(item.bidPrice) || 0;
                    const ask = parseFloat(item.askPrice) || 0;
                    if (bid > 0 && ask > 0) {
                        map.set(base, { exchange: 'MEXC', bid, ask, last: (bid + ask) / 2, vol: 400000 });
                    }
                }
            }
        }
        return map;
    }).catch(() => map);
}

function fetchBitgetPrices() {
    const map = new Map();
    return fetchJson('https://api.bitget.com/api/v2/spot/market/tickers').then((json) => {
        const list = json?.data;
        if (Array.isArray(list)) {
            for (const item of list) {
                const sym = item.symbol || '';
                if (sym.endsWith('USDT')) {
                    const base = sym.slice(0, -4).toUpperCase();
                    const bid = parseFloat(item.bidPr) || parseFloat(item.lastPr) || 0;
                    const ask = parseFloat(item.askPr) || parseFloat(item.lastPr) || 0;
                    const vol = parseFloat(item.usdtVolume) || 450000;
                    const change = parseFloat(item.change24h) * 100 || 0;
                    if (bid > 0 && ask > 0) {
                        map.set(base, { exchange: 'Bitget', bid, ask, last: (bid + ask) / 2, vol, change24h: change });
                    }
                }
            }
        }
        return map;
    }).catch(() => map);
}

function fetchHuobiPrices() {
    const map = new Map();
    return fetchJson('https://api.huobi.pro/market/tickers').then((json) => {
        const list = json?.data;
        if (Array.isArray(list)) {
            for (const item of list) {
                const sym = item.symbol || '';
                if (sym.endsWith('usdt')) {
                    const base = sym.slice(0, -5).toUpperCase();
                    const bid = parseFloat(item.bid) || parseFloat(item.close) || 0;
                    const ask = parseFloat(item.ask) || parseFloat(item.close) || 0;
                    const vol = parseFloat(item.vol) || 300000;
                    if (bid > 0 && ask > 0) {
                        map.set(base, { exchange: 'Huobi', bid, ask, last: (bid + ask) / 2, vol });
                    }
                }
            }
        }
        return map;
    }).catch(() => map);
}

const EXCHANGE_NAMES = ['Binance', 'KuCoin', 'Gate.io', 'Bybit', 'OKX', 'MEXC', 'Bitget', 'Huobi'];

async function fetchAllTickerMaps() {
    const [binanceMap, kucoinMap, gateMap, bybitMap, okxMap, mexcMap, bitgetMap, huobiMap] = await Promise.all([
        fetchBinancePrices(), fetchKuCoinPrices(), fetchGateIOPrices(), fetchBybitPrices(),
        fetchOKXPrices(), fetchMEXCPrices(), fetchBitgetPrices(), fetchHuobiPrices(),
    ]);
    const sets = [
        { name: 'Gate.io', map: gateMap },
        { name: 'KuCoin', map: kucoinMap },
        { name: 'MEXC', map: mexcMap },
        { name: 'Bybit', map: bybitMap },
        { name: 'Bitget', map: bitgetMap },
        { name: 'Binance', map: binanceMap },
        { name: 'OKX', map: okxMap },
        { name: 'Huobi', map: huobiMap },
    ];
    const online = sets.filter((s) => s.map.size > 0).map((s) => s.name);
    return { sets, online };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-exchange scanner (capital-independent fields computed here)
// ─────────────────────────────────────────────────────────────────────────────

function scanCrossExchange(sets) {
    const allUniqueTokens = new Set();
    for (const ex of sets) {
        for (const key of ex.map.keys()) allUniqueTokens.add(key);
    }

    const opportunities = [];

    for (const token of allUniqueTokens) {
        if (EXCLUDED_BASES.has(token) || LEVERAGED_RE.test(token)) continue;

        const quotes = [];
        for (const ex of sets) {
            let quote = ex.map.get(token);
            if (!quote && ex.map.has(`1000${token}`)) {
                const raw = ex.map.get(`1000${token}`);
                quote = {
                    exchange: ex.name,
                    bid: raw.bid / 1000,
                    ask: raw.ask / 1000,
                    last: raw.last / 1000,
                    vol: raw.vol * 1000,
                };
            }
            if (quote && quote.bid > 0 && quote.ask > 0) quotes.push(quote);
        }

        if (quotes.length < 2) continue;

        // Reject corrupted / illiquid outlier quotes (>35% off the median mid)
        const mids = quotes.map((q) => (q.bid + q.ask) / 2).sort((a, b) => a - b);
        const medianMid = mids[Math.floor(mids.length / 2)];
        const validQuotes = quotes.filter((q) => {
            const mid = (q.bid + q.ask) / 2;
            return Math.abs(mid - medianMid) / medianMid < 0.35;
        });
        if (validQuotes.length < 2) continue;

        let bestBuy = validQuotes[0];
        let bestSell = validQuotes[0];
        for (const q of validQuotes) {
            if (q.ask < bestBuy.ask) bestBuy = q;
            if (q.bid > bestSell.bid) bestSell = q;
        }

        if (bestBuy.exchange === bestSell.exchange) continue;
        if (!(bestBuy.ask > 0 && bestSell.bid > bestBuy.ask)) continue;

        const grossSpreadPct = ((bestSell.bid - bestBuy.ask) / bestBuy.ask) * 100;
        if (grossSpreadPct < 0.3 || grossSpreadPct > 35.0) continue;

        const buyFeePct = EXCHANGE_FEES[bestBuy.exchange]?.takerFeePct || 0.1;
        const sellFeePct = EXCHANGE_FEES[bestSell.exchange]?.takerFeePct || 0.1;
        const networkInfo = getRecommendedTransferNetwork(token);
        const minVol = Math.min(bestBuy.vol, bestSell.vol);

        opportunities.push({
            symbol: `${token}/USDT`,
            baseAsset: token,
            quoteAsset: 'USDT',
            buyExchange: bestBuy.exchange,
            buyAsk: bestBuy.ask,
            sellExchange: bestSell.exchange,
            sellBid: bestSell.bid,
            grossSpreadPct: round3(grossSpreadPct),
            tradingFeePct: round3(buyFeePct + sellFeePct),
            transferFeeUSD: networkInfo.feeUSD,
            recommendedNetwork: networkInfo.network,
            transferTimeEst: networkInfo.time,
            liquidityScore: minVol > 300000 ? 'HIGH' : minVol > 50000 ? 'MEDIUM' : 'LOW',
            riskLevel: grossSpreadPct > 8.0 ? 'HIGH' : grossSpreadPct > 3.0 ? 'MEDIUM' : 'LOW',
            minVol: Math.round(minVol),
        });
    }

    opportunities.sort((a, b) => b.grossSpreadPct - a.grossSpreadPct);
    return { opportunities, totalPairsMonitored: allUniqueTokens.size };
}

// ─────────────────────────────────────────────────────────────────────────────
// New-listing announcements (Bybit / Binance CMS / OKX / KuCoin, 60s cache)
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_BLACKLIST = new Set([
    'USDT', 'USDC', 'USD', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USDE', 'AEUR',
    'EUR', 'TRY', 'BRL', 'JPY', 'ARS', 'PYUSD', 'XUSD', 'USD1', 'PERP', 'SPOT',
]);

function extractTokensFromTitle(title) {
    const out = [];
    const push = (raw) => {
        if (!raw) return;
        const tok = raw.toUpperCase();
        if (tok.length < 2 || tok.length > 12) return;
        if (!/[A-Z]/.test(tok)) return;
        if (tok.endsWith('USDT') || tok.endsWith('USDC')) return;
        if (TOKEN_BLACKLIST.has(tok)) return;
        if (!out.includes(tok)) out.push(tok);
    };

    for (const m of title.matchAll(/\b([A-Z0-9]{2,12})USDT\b/g)) push(m[1]);

    const colon = title.match(/(?:[Ll]ist(?:ing)?|[Ll]aunch)[^:]*:\s*(.+)$/);
    if (colon) {
        for (const frag of colon[1].split(/,|;|\band\b/i)) {
            const t = frag.trim().match(/^[A-Z0-9]{2,12}$/);
            if (t) push(t[0]);
        }
    }

    for (const m of title.matchAll(/\b(?:Will\s+(?:List|Launch|Enable)|Lists?)\s+([A-Z0-9]{2,12})\b/g)) push(m[1]);

    for (const m of title.matchAll(/\b([A-Z0-9]{2,12})\s+(?:Token|Spot|Perpetual|Futures|X-?Perp)/g)) push(m[1]);

    return out;
}

function parseListingTimeFromTitle(title) {
    const iso = title.match(/\b(202[5-9])-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?(?:\s*(?:AM|PM))?\s*(?:UTC|GMT)?\b/i);
    if (iso) {
        const [, y, mo, d, h, mi] = iso;
        return Date.UTC(+y, +mo - 1, +d, h ? +h : 8, mi ? +mi : 0);
    }
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const text = title.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(202[5-9])\b/i);
    if (text) {
        const mo = months.findIndex((m) => text[1].toLowerCase().startsWith(m.toLowerCase()));
        if (mo >= 0) return Date.UTC(+text[3], mo, +text[2], 8, 0);
    }
    return undefined;
}

let announcementsCache = null; // { ts, items }

async function fetchRecentAnnouncements() {
    if (announcementsCache && Date.now() - announcementsCache.ts < 60000) return announcementsCache.items;

    const results = await Promise.all([
        (async () => {
            const json = await fetchJson('https://api.bybit.com/v5/announcements/index?locale=en-US&type=new_crypto&limit=50');
            const list = json?.result?.list;
            if (!Array.isArray(list)) return [];
            return list.map((it) => ({
                exchange: 'Bybit',
                sourceId: it.id ?? it.title,
                title: String(it.title || ''),
                url: it.url,
                publishedAt: parseInt(it.dateTimestamp) || Date.now(),
            }));
        })(),
        (async () => {
            const json = await fetchJson(
                'https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=48&pageNo=1&pageSize=30',
                4500,
                { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            );
            const articles = json?.data?.articles;
            if (!Array.isArray(articles)) return [];
            return articles.map((it) => ({
                exchange: 'Binance',
                sourceId: it.code ?? it.id ?? it.title,
                title: String(it.title || ''),
                url: it.code ? `https://www.binance.com/en/support/announcement/${it.code}` : undefined,
                publishedAt: it.releaseDate ? Number(it.releaseDate) : Date.now(),
            }));
        })(),
        (async () => {
            const json = await fetchJson('https://www.okx.com/api/v5/support/announcements?annType=announcements-new-listings');
            const details = json?.data?.[0]?.details;
            if (!Array.isArray(details)) return [];
            return details.map((it) => ({
                exchange: 'OKX',
                sourceId: it.url ?? it.title,
                title: String(it.title || ''),
                url: it.url,
                publishedAt: it.pTime ? Number(it.pTime) : Date.now(),
            }));
        })(),
        (async () => {
            const json = await fetchJson('https://api.kucoin.com/api/v3/announcements?currentPage=1&pageSize=50');
            const items = json?.data?.items;
            if (!Array.isArray(items)) return [];
            return items
                .filter((it) => Array.isArray(it.annType) && it.annType.includes('new-listings'))
                .map((it) => ({
                    exchange: 'KuCoin',
                    sourceId: it.annId ?? it.annTitle,
                    title: String(it.annTitle || ''),
                    url: it.annUrl,
                    publishedAt: it.cTime ? Number(it.cTime) : Date.now(),
                }));
        })(),
    ]);

    const seen = new Set();
    const items = [];
    for (const raw of results.flat()) {
        const dedupKey = `${raw.exchange}-${raw.sourceId}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        const tokens = extractTokensFromTitle(raw.title);
        if (tokens.length === 0) continue;
        items.push({
            id: dedupKey,
            exchange: raw.exchange,
            tokens,
            title: raw.title,
            url: raw.url,
            publishedAt: raw.publishedAt,
            listingTime: parseListingTimeFromTitle(raw.title),
        });
    }

    items.sort((a, b) => b.publishedAt - a.publishedAt);
    announcementsCache = { ts: Date.now(), items };
    return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fresh DEX pools (GeckoTerminal, Solana & Base)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGeckoTerminalNewPools() {
    const dexOps = [];
    try {
        const [solPools, basePools] = await Promise.all([
            fetchJson('https://api.geckoterminal.com/api/v2/networks/solana/new_pools', 4000, { Accept: 'application/json' }),
            fetchJson('https://api.geckoterminal.com/api/v2/networks/base/new_pools', 4000, { Accept: 'application/json' }),
        ]);

        const combined = [...(solPools?.data || []), ...(basePools?.data || [])];
        for (const pool of combined.slice(0, 15)) {
            const attr = pool.attributes;
            if (!attr || !attr.base_token_price_usd) continue;
            const priceUSD = parseFloat(attr.base_token_price_usd);
            if (isNaN(priceUSD) || priceUSD <= 0) continue;

            const name = attr.name || 'Early DEX Token';
            const parts = name.split('/');
            const tokenSymbol = parts[0]?.trim().toUpperCase() || 'DEX';
            const networkName = pool.relationships?.network?.data?.id === 'base' ? 'Base (Ethereum L2)' : 'Solana SPL';
            const dexName = pool.relationships?.dex?.data?.id?.toUpperCase() || 'Raydium/Uniswap';
            const reserveUSD = parseFloat(attr.reserve_in_usd) || 15000;
            const volumeUSD = parseFloat(attr.volume_usd?.h24) || 8000;

            const poolCreatedTs = attr.pool_created_at ? new Date(attr.pool_created_at).getTime() : Date.now();
            const poolAgeMin = Math.max(1, Math.floor((Date.now() - poolCreatedTs) / 60000));
            const countdownSeconds = Math.max(0, 86400 - poolAgeMin * 60);

            // Heuristic momentum-based spread estimate (volume-to-liquidity)
            const potentialSpread = round2(Math.min(75.0, Math.max(14.5, (volumeUSD / Math.max(3000, reserveUSD)) * 24.0)));

            const poolUrl = `https://www.geckoterminal.com/${pool.relationships?.network?.data?.id || 'solana'}/pools/${attr.address}`;

            dexOps.push({
                id: `dex-early-${tokenSymbol}-${pool.id}`,
                token: tokenSymbol,
                tokenName: name,
                status: 'PRE_MARKET',
                targetExchange: `${dexName} (DEX)`,
                targetPair: `${tokenSymbol}/${parts[1]?.trim() || 'SOL'}`,
                listingDate: attr.pool_created_at || new Date().toISOString(),
                sourceExchange: `${dexName} (DEX)`,
                sourcePair: `${tokenSymbol}/${parts[1]?.trim() || 'SOL'}`,
                sourcePriceUSD: priceUSD,
                source24hVolumeUSD: volumeUSD,
                source24hChangePct: parseFloat(attr.price_change_percentage?.h24 || '0'),
                potentialSpreadPct: potentialSpread,
                tradingFeePct: 0.3,
                transferFeeUSD: networkName.includes('Base') ? 0.25 : 0.05,
                depositStatus: 'ANNOUNCED',
                recommendedNetwork: networkName,
                transferTimeEst: '< 30 sec',
                buyUrl: poolUrl,
                targetTradeUrl: poolUrl,
                actionGuide: `DEX-only token: tradeable on ${dexName} (${networkName}) at $${priceUSD < 0.01 ? priceUSD.toFixed(8) : priceUSD.toFixed(4)} • Pool Liquidity: $${Math.round(reserveUSD).toLocaleString()} • No CEX listing yet — watch for Tier-1 deposit openings before expecting a listing spike.`,
                announcementTitle: `Live DEX Pool: ${name} on ${dexName} ($${(volumeUSD / 1000).toFixed(1)}k 24h Vol)`,
                announcementUrl: poolUrl,
            });
        }
    } catch (err) {
        console.error('[GeckoTerminal New Pools Error]:', err);
    }
    return dexOps;
}

function getExchangeTradeUrl(exchange, token) {
    const sym = token.toUpperCase();
    switch (exchange) {
        case 'Binance': return `https://www.binance.com/en/trade/${sym}_USDT`;
        case 'Bybit': return `https://www.bybit.com/en/trade/spot/${sym}/USDT`;
        case 'Gate.io': return `https://www.gate.io/trade/${sym}_USDT`;
        case 'KuCoin': return `https://www.kucoin.com/trade/${sym}-USDT`;
        case 'MEXC': return `https://www.mexc.com/exchange/${sym}_USDT`;
        case 'Bitget': return `https://www.bitget.com/spot/${sym}USDT`;
        case 'OKX': return `https://www.okx.com/trade-spot/${sym.toLowerCase()}-usdt`;
        case 'Huobi': return `https://www.htx.com/trade/${sym.toLowerCase()}_usdt`;
        default: return `https://www.coingecko.com/en/coins/${sym.toLowerCase()}`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing radar (announcement + DEX + live volatility paths; DB snapshot diff
// is not available on this static host and is intentionally omitted)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchListingOpportunities(mapsByName) {
    const opportunities = [];
    const processedTokens = new Set();
    const now = Date.now();

    const gateMap = mapsByName.get('Gate.io') || new Map();
    const mexcMap = mapsByName.get('MEXC') || new Map();
    const kucoinMap = mapsByName.get('KuCoin') || new Map();
    const bybitMap = mapsByName.get('Bybit') || new Map();
    const bitgetMap = mapsByName.get('Bitget') || new Map();

    try {
        const [announcements, dexEarlyOps] = await Promise.all([
            fetchRecentAnnouncements(),
            fetchGeckoTerminalNewPools(),
        ]);

        // A) GeckoTerminal fresh DEX pools (pre-market stage)
        for (const dexOp of dexEarlyOps) {
            if (!processedTokens.has(dexOp.token)) {
                processedTokens.add(dexOp.token);
                opportunities.push(dexOp);
            }
        }

        // B) Exchange announcements — pre-listing accumulation & fresh-listing plays
        for (const ann of announcements) {
            for (const token of ann.tokens) {
                if (processedTokens.has(`${token}-${ann.exchange}`) || processedTokens.has(token)) continue;

                const sourceQuote =
                    mexcMap.get(token) || gateMap.get(token) || kucoinMap.get(token) || bitgetMap.get(token) || bybitMap.get(token);
                if (!sourceQuote || sourceQuote.ask <= 0) continue;

                processedTokens.add(`${token}-${ann.exchange}`);
                processedTokens.add(token);

                const hasFutureListing = ann.listingTime !== undefined && ann.listingTime > now;
                const status = hasFutureListing ? 'UPCOMING_COUNTDOWN' : 'NEWLY_LISTED_VOLATILITY';

                // Heuristic listing-pump premium estimate: decays from ~22% over ~40h
                const elapsedHours = (now - ann.publishedAt) / 3600000;
                const expectedPremiumPct = round2(Math.max(6.5, 22.5 - elapsedHours * 0.4));
                const expectedListingPrice = sourceQuote.ask * (1 + expectedPremiumPct / 100);
                const network = getRecommendedTransferNetwork(token);

                opportunities.push({
                    id: `list-${ann.exchange}-${token}-${ann.publishedAt}`,
                    token,
                    tokenName: `${token} Token`,
                    status,
                    targetExchange: ann.exchange,
                    targetPair: `${token}/USDT`,
                    listingDate: new Date(ann.listingTime ?? ann.publishedAt).toISOString(),
                    sourceExchange: sourceQuote.exchange,
                    sourcePair: `${token}/USDT`,
                    sourcePriceUSD: sourceQuote.ask,
                    source24hVolumeUSD: sourceQuote.vol,
                    source24hChangePct: sourceQuote.change24h || 0,
                    expectedListingPriceUSD: parseFloat(expectedListingPrice.toFixed(6)),
                    potentialSpreadPct: expectedPremiumPct,
                    tradingFeePct: 0.2,
                    transferFeeUSD: network.feeUSD,
                    depositStatus: hasFutureListing ? 'ANNOUNCED' : 'OPEN',
                    recommendedNetwork: network.network,
                    transferTimeEst: network.time,
                    buyUrl: getExchangeTradeUrl(sourceQuote.exchange, token),
                    targetTradeUrl: getExchangeTradeUrl(ann.exchange, token),
                    actionGuide: hasFutureListing
                        ? `Accumulate on ${sourceQuote.exchange} at $${sourceQuote.ask.toFixed(4)} before ${ann.exchange} spot opens (${new Date(ann.listingTime).toISOString().slice(0, 16).replace('T', ' ')}Z).`
                        : `Buy on ${sourceQuote.exchange} at $${sourceQuote.ask.toFixed(4)} -> Transfer via ${network.network} to ${ann.exchange} -> Sell into opening liquidity spike.`,
                    announcementTitle: ann.title,
                    announcementUrl: ann.url,
                    isHeuristic: true,
                });
                break; // one opportunity per announcement keeps the radar list clean
            }
        }

        // C) Live cross-exchange discrepancies on freshly-listed tokens
        const allTokens = Array.from(new Set([...gateMap.keys(), ...mexcMap.keys(), ...kucoinMap.keys()]));
        let volatilityEvents = 0;
        for (const token of allTokens) {
            if (processedTokens.has(token) || opportunities.length >= 35) continue;

            const quotes = [gateMap.get(token), kucoinMap.get(token), mexcMap.get(token), bybitMap.get(token), bitgetMap.get(token)]
                .filter((q) => q && q.ask > 0 && q.bid > 0);
            if (quotes.length < 2) continue;

            let bestBuy = quotes[0];
            let bestSell = quotes[0];
            for (const q of quotes) {
                if (q.ask < bestBuy.ask) bestBuy = q;
                if (q.bid > bestSell.bid) bestSell = q;
            }

            if (bestBuy.exchange === bestSell.exchange || !(bestSell.bid > bestBuy.ask)) continue;

            const spreadPct = ((bestSell.bid - bestBuy.ask) / bestBuy.ask) * 100;
            if (spreadPct >= 4.0 && spreadPct <= 35.0 && Math.max(bestBuy.vol, bestSell.vol) >= 20000) {
                processedTokens.add(token);
                volatilityEvents++;
                const network = getRecommendedTransferNetwork(token);

                opportunities.push({
                    id: `vol-${token}-${bestBuy.exchange}-${bestSell.exchange}`,
                    token,
                    tokenName: `${token} Asset`,
                    status: 'NEWLY_LISTED_VOLATILITY',
                    targetExchange: bestSell.exchange,
                    targetPair: `${token}/USDT`,
                    sourceExchange: bestBuy.exchange,
                    sourcePair: `${token}/USDT`,
                    sourcePriceUSD: bestBuy.ask,
                    source24hVolumeUSD: bestBuy.vol,
                    source24hChangePct: bestBuy.change24h || 0,
                    expectedListingPriceUSD: bestSell.bid,
                    potentialSpreadPct: round2(spreadPct),
                    tradingFeePct: 0.2,
                    transferFeeUSD: network.feeUSD,
                    depositStatus: 'OPEN',
                    recommendedNetwork: network.network,
                    transferTimeEst: network.time,
                    buyUrl: getExchangeTradeUrl(bestBuy.exchange, token),
                    targetTradeUrl: getExchangeTradeUrl(bestSell.exchange, token),
                    actionGuide: `Buy on ${bestBuy.exchange} at $${bestBuy.ask.toFixed(4)} -> Transfer via ${network.network} -> Instant market sell on ${bestSell.exchange} at $${bestSell.bid.toFixed(4)}.`,
                    announcementTitle: `Live Price Discrepancy: ${bestBuy.exchange} vs ${bestSell.exchange} (${spreadPct.toFixed(1)}% Spread)`,
                    isHeuristic: false,
                });
            }
        }

        opportunities.sort((a, b) => b.potentialSpreadPct - a.potentialSpreadPct);
        return { opportunities, announcementsMonitored: announcements.length, newListingEvents: volatilityEvents };
    } catch (err) {
        console.error('[Listing Arbitrage Matcher Error]:', err);
        return { opportunities, announcementsMonitored: 0, newListingEvents: 0 };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Binance Futures funding rates (30s cache)
// ─────────────────────────────────────────────────────────────────────────────

let fundingCache = null; // { ts, items }

async function fetchLiveFundingRates() {
    if (fundingCache && Date.now() - fundingCache.ts < 30000) return fundingCache.items;
    try {
        const data = await fetchJson('https://fapi.binance.com/fapi/v1/premiumIndex', 4000);
        const valid = [];
        if (Array.isArray(data)) {
            for (const item of data) {
                const rate = parseFloat(item.lastFundingRate);
                if (isNaN(rate) || Math.abs(rate) <= 0.0001 || !item.symbol.endsWith('USDT')) continue;

                const markPrice = parseFloat(item.markPrice) || 0;
                const sym = item.symbol.replace('USDT', '');

                let nextFundingIn = '04:00:00';
                if (item.nextFundingTime) {
                    const diff = item.nextFundingTime - Date.now();
                    if (diff > 0) {
                        const h = Math.floor(diff / 3600000);
                        const m = Math.floor((diff % 3600000) / 60000);
                        const s = Math.floor((diff % 60000) / 1000);
                        nextFundingIn = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                    }
                }

                valid.push({
                    id: `funding-${item.symbol}`,
                    symbol: `${sym}/USDT`,
                    exchange: 'Binance / Bybit Futures',
                    spotPrice: parseFloat((markPrice / (1 + rate * 3)).toFixed(6)),
                    perpPrice: parseFloat(markPrice.toFixed(6)),
                    basisPct: round3(rate * 3 * 100),
                    fundingRate8h: parseFloat((rate * 100).toFixed(4)),
                    annualizedYieldAPR: round2(rate * 3 * 365 * 100),
                    recommendedStrategy: rate > 0 ? 'CASH_AND_CARRY' : 'REVERSE_CASH_AND_CARRY',
                    nextFundingIn,
                });
            }
        }
        valid.sort((a, b) => Math.abs(b.annualizedYieldAPR) - Math.abs(a.annualizedYieldAPR));
        fundingCache = { ts: Date.now(), items: valid.slice(0, 30) };
        return fundingCache.items;
    } catch (err) {
        console.error('[Live funding rates fetch error]:', err);
        return fundingCache ? fundingCache.items : [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Coin Matrix mode — deep multi-market data for one coin (CoinGecko, 15s cache)
// ─────────────────────────────────────────────────────────────────────────────

const coinMarketsCache = new Map(); // coinId -> { ts, data }
const COIN_MARKETS_CACHE_TTL = 15 * 1000;

const DEX_IDENTIFIERS = [
    'uniswap', 'raydium', 'pancakeswap', 'orca', 'aerodrome', 'sushiswap',
    'balancer', 'curve', 'traderjoe', 'camelot', 'meteora', 'jupiter', 'stonfi', 'dedust',
];

async function fetchDeepCoinMarkets(coinQuery, capitalUSD) {
    const normQuery = coinQuery.trim().toUpperCase();
    let coinMeta = COIN_ID_MAP[normQuery];

    if (!coinMeta) {
        const searchJson = await fetchJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(coinQuery)}`, 3000);
        const firstCoin = searchJson?.coins?.[0];
        if (firstCoin) {
            coinMeta = { id: firstCoin.id, name: firstCoin.name };
        }
    }

    const coinId = coinMeta?.id || coinQuery.toLowerCase();
    const coinSymbol = normQuery;
    const coinName = coinMeta?.name || normQuery;

    const cached = coinMarketsCache.get(coinId);
    if (cached && Date.now() - cached.ts < COIN_MARKETS_CACHE_TTL) return cached.data;

    const failResponse = {
        success: false,
        coinInfo: { id: coinId, name: coinName, symbol: coinSymbol, priceUSD: 0, vwapUSD: 0, totalVolume24hUSD: 0, marketsCount: 0, maxSpreadPct: 0, dexMarketsCount: 0, cexMarketsCount: 0 },
        bestArbitrageRoute: null,
        markets: [],
        timestamp: Date.now(),
    };

    try {
        const json = await fetchJson(
            `https://api.coingecko.com/api/v3/coins/${coinId}/tickers?include_exchange_logo=true&depth=true`,
            6000
        );
        if (!json) return failResponse;

        const rawTickers = json.tickers || [];
        let totalWeightedPrice = 0;
        let totalVolume = 0;
        const validMarkets = [];

        for (let i = 0; i < rawTickers.length; i++) {
            const t = rawTickers[i];
            if (t.is_stale || t.is_anomaly) continue;

            const price = parseFloat(t.converted_last?.usd) || 0;
            const volume = parseFloat(t.converted_volume?.usd) || 0;
            if (price <= 0 || volume <= 0) continue;

            const exName = t.market?.name || 'Unknown Exchange';
            const exId = t.market?.identifier || exName.toLowerCase();
            const isDEX = DEX_IDENTIFIERS.some((d) => exId.includes(d) || exName.toLowerCase().includes(d));

            totalWeightedPrice += price * volume;
            totalVolume += volume;

            validMarkets.push({
                id: `${exId}-${t.base}-${t.target}-${i}`,
                exchangeName: exName,
                exchangeId: exId,
                exchangeLogo: t.market?.logo,
                pair: `${t.base}/${t.target}`,
                base: t.base,
                target: t.target,
                priceUSD: price,
                spreadPctVsVwap: 0,
                bidAskSpreadPct: parseFloat(t.bid_ask_spread_percentage) || 0.1,
                volume24hUSD: volume,
                depthUpUSD: parseFloat(t.cost_to_move_up_usd) || undefined,
                depthDownUSD: parseFloat(t.cost_to_move_down_usd) || undefined,
                tradeUrl: t.trade_url || undefined,
                isDEX,
                trustScore: t.trust_score || 'green',
                lastTradedAt: t.last_traded_at || new Date().toISOString(),
            });
        }

        const vwap = totalVolume > 0 ? totalWeightedPrice / totalVolume : (validMarkets[0]?.priceUSD || 1);
        for (const m of validMarkets) {
            m.spreadPctVsVwap = round3(((m.priceUSD - vwap) / vwap) * 100);
        }
        validMarkets.sort((a, b) => b.volume24hUSD - a.volume24hUSD);

        const liquidMarkets = validMarkets.filter((m) => m.volume24hUSD >= 1000 && Math.abs(m.spreadPctVsVwap) < 15);
        let bestBuy = null;
        let bestSell = null;
        for (const m of liquidMarkets) {
            if (!bestBuy || m.priceUSD < bestBuy.priceUSD) bestBuy = m;
            if (!bestSell || m.priceUSD > bestSell.priceUSD) bestSell = m;
        }

        let bestRoute = null;
        let maxSpread = 0;
        if (bestBuy && bestSell && bestBuy.exchangeName !== bestSell.exchangeName && bestSell.priceUSD > bestBuy.priceUSD) {
            const grossSpread = ((bestSell.priceUSD - bestBuy.priceUSD) / bestBuy.priceUSD) * 100;
            maxSpread = grossSpread;

            const buyFeePct = EXCHANGE_FEES[bestBuy.exchangeName]?.takerFeePct || 0.1;
            const sellFeePct = EXCHANGE_FEES[bestSell.exchangeName]?.takerFeePct || 0.1;
            const totalFeePct = buyFeePct + sellFeePct;

            const network = getRecommendedTransferNetwork(coinSymbol);
            const grossProfit = capitalUSD * (grossSpread / 100);
            const totalFees = capitalUSD * (totalFeePct / 100) + network.feeUSD;
            const netProfit = grossProfit - totalFees;

            bestRoute = {
                buyExchange: bestBuy.exchangeName,
                buyPair: bestBuy.pair,
                buyPrice: bestBuy.priceUSD,
                buyTradeUrl: bestBuy.tradeUrl,
                sellExchange: bestSell.exchangeName,
                sellPair: bestSell.pair,
                sellPrice: bestSell.priceUSD,
                sellTradeUrl: bestSell.tradeUrl,
                grossSpreadPct: round3(grossSpread),
                netSpreadPct: round3((netProfit / capitalUSD) * 100),
                estimatedProfitUSD: round2(netProfit),
                capitalUSD,
                recommendedNetwork: network.network,
                transferFeeUSD: network.feeUSD,
                transferTimeEst: network.time,
                isDEXInvolved: bestBuy.isDEX || bestSell.isDEX,
            };
        }

        const response = {
            success: true,
            coinInfo: {
                id: coinId,
                name: coinName,
                symbol: coinSymbol,
                image: json.image?.small || json.image?.large,
                priceUSD: vwap,
                vwapUSD: vwap,
                totalVolume24hUSD: totalVolume,
                marketsCount: validMarkets.length,
                maxSpreadPct: round2(maxSpread),
                dexMarketsCount: validMarkets.filter((m) => m.isDEX).length,
                cexMarketsCount: validMarkets.filter((m) => !m.isDEX).length,
            },
            bestArbitrageRoute: bestRoute,
            markets: validMarkets.slice(0, 120),
            timestamp: Date.now(),
        };

        coinMarketsCache.set(coinId, { ts: Date.now(), data: response });
        return response;
    } catch (err) {
        console.error('[Deep Coin Markets error]:', err);
        return failResponse;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cached scan core — the expensive part runs at most once per 45s per container
// ─────────────────────────────────────────────────────────────────────────────

let scanCoreCache = null; // { ts, sets, online, totalPairs, crossOpps, listingOps, announcementsMonitored, newListingEvents }

async function getScanCore() {
    if (scanCoreCache && Date.now() - scanCoreCache.ts < SCAN_CACHE_TTL_MS) return scanCoreCache;

    const { sets, online } = await fetchAllTickerMaps();
    const totalPairs = sets.reduce((n, s) => n + s.map.size, 0);
    if (totalPairs === 0) {
        return null; // every exchange feed failed (e.g. network outage)
    }

    const { opportunities: crossOpps, totalPairsMonitored } = scanCrossExchange(sets);
    const mapsByName = new Map(sets.map((s) => [s.name, s.map]));
    const { opportunities: listingOps, announcementsMonitored, newListingEvents } =
        await fetchListingOpportunities(mapsByName);

    scanCoreCache = {
        ts: Date.now(),
        sets,
        online,
        totalPairsMonitored,
        crossOpps,
        listingOps,
        announcementsMonitored,
        newListingEvents,
    };
    return scanCoreCache;
}

function buildOpportunities(core, capitalUSD, minSpreadPct, minVolume) {
    const opps = [];
    for (const r of core.crossOpps) {
        if (minVolume > 0 && r.minVol < minVolume) continue;

        const grossProfit = capitalUSD * (r.grossSpreadPct / 100);
        const totalFees = capitalUSD * (r.tradingFeePct / 100) + r.transferFeeUSD;
        const netProfit = grossProfit - totalFees;
        const netSpreadPct = (netProfit / capitalUSD) * 100;
        if (netProfit <= 0 || netSpreadPct < minSpreadPct) continue;

        opps.push({
            id: `${r.baseAsset}-${r.buyExchange}-${r.sellExchange}`,
            symbol: r.symbol,
            baseAsset: r.baseAsset,
            quoteAsset: r.quoteAsset,
            buyExchange: r.buyExchange,
            buyAsk: r.buyAsk,
            buyUrl: getExchangeTradeUrl(r.buyExchange, r.baseAsset),
            sellExchange: r.sellExchange,
            sellBid: r.sellBid,
            sellUrl: getExchangeTradeUrl(r.sellExchange, r.baseAsset),
            grossSpreadPct: r.grossSpreadPct,
            netSpreadPct: round3(netSpreadPct),
            estimatedProfitUSD: round2(netProfit),
            transferFeeUSD: r.transferFeeUSD,
            tradingFeePct: r.tradingFeePct,
            recommendedNetwork: r.recommendedNetwork,
            transferTimeEst: r.transferTimeEst,
            liquidityScore: r.liquidityScore,
            riskLevel: r.riskLevel,
            volume24hUSD: r.minVol,
            timestamp: Date.now(),
        });
    }
    opps.sort((a, b) => b.netSpreadPct - a.netSpreadPct);
    return opps.slice(0, 100);
}

function buildListings(core, capitalUSD) {
    const now = Date.now();
    return core.listingOps.slice(0, 30).map((op) => {
        const grossProfit = capitalUSD * (op.potentialSpreadPct / 100);
        const totalFees = capitalUSD * (op.tradingFeePct / 100) + op.transferFeeUSD;
        const netProfit = grossProfit - totalFees;

        let countdownSeconds = 0;
        if (op.status === 'UPCOMING_COUNTDOWN' && op.listingDate) {
            const diff = new Date(op.listingDate).getTime() - now;
            countdownSeconds = Math.max(0, Math.floor(diff / 1000));
        }

        return {
            ...op,
            estimatedProfitUSD: round2(netProfit),
            countdownSeconds,
            timestamp: now,
        };
    });
}

function clampNum(value, min, max, fallback) {
    const n = parseFloat(value);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    try {
        const qp = event.queryStringParameters || {};
        const capitalUSD = clampNum(qp.capital, 100, 100000000, 1000);
        const minSpread = clampNum(qp.minSpread, 0, 35, 0.5);
        const minVolume = clampNum(qp.minVolume, 0, 1e12, 0);
        const coin = (qp.coin || qp.symbol || '').trim();

        // Coin Matrix mode
        if (coin || qp.action === 'coin_markets') {
            const data = await fetchDeepCoinMarkets(coin || 'BTC', capitalUSD);
            return {
                statusCode: 200,
                headers: { ...headers, 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' },
                body: JSON.stringify(data),
            };
        }

        // Global scan mode
        const core = await getScanCore();
        if (!core) {
            return {
                statusCode: 502,
                headers,
                body: JSON.stringify({ success: false, error: 'All exchange feeds are currently unavailable. Try again shortly.' }),
            };
        }

        const crossExchangeOpportunities = buildOpportunities(core, capitalUSD, minSpread, minVolume);

        const body = {
            success: true,
            timestamp: Date.now(),
            exchangesMonitored: EXCHANGE_NAMES,
            exchangesOnline: core.online,
            totalPairsMonitored: core.totalPairsMonitored,
            crossExchangeOpportunities,
            listingOpportunities: buildListings(core, capitalUSD),
            announcementsMonitored: core.announcementsMonitored,
            newListingEvents: core.newListingEvents,
            fundingRateOpportunities: (await fetchLiveFundingRates()).slice(0, 20),
            fastestArbitragePair: crossExchangeOpportunities[0] || null,
        };

        return {
            statusCode: 200,
            headers: { ...headers, 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30' },
            body: JSON.stringify(body),
        };
    } catch (error) {
        console.error('[Arbitrage API Error]:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, error: error?.message || 'Arbitrage calculation error' }),
        };
    }
};
