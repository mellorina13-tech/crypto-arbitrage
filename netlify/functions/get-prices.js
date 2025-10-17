// Netlify Function to fetch cryptocurrency prices from exchanges
// This runs on the server, so NO CORS issues!

const fetch = require('node-fetch');

// Exchange configurations
const EXCHANGES = {
    binance: {
        name: 'Binance',
        fee: 0.1,
        url: (symbol) => `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`,
        parsePrice: (data) => parseFloat(data.price)
    },
    kucoin: {
        name: 'KuCoin',
        fee: 0.1,
        url: (symbol) => `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${symbol}-USDT`,
        parsePrice: (data) => data.code === '200000' ? parseFloat(data.data.price) : null
    },
    gateio: {
        name: 'Gate.io',
        fee: 0.2,
        url: (symbol) => `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${symbol}_USDT`,
        parsePrice: (data) => data && data.length > 0 ? parseFloat(data[0].last) : null
    },
    mexc: {
        name: 'MEXC',
        fee: 0.2,
        url: (symbol) => `https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}USDT`,
        parsePrice: (data) => data.price ? parseFloat(data.price) : null
    },
    bybit: {
        name: 'Bybit',
        fee: 0.1,
        url: (symbol) => `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}USDT`,
        parsePrice: (data) => data?.result?.list?.[0]?.lastPrice ? parseFloat(data.result.list[0].lastPrice) : null
    },
    okx: {
        name: 'OKX',
        fee: 0.1,
        url: (symbol) => `https://www.okx.com/api/v5/market/ticker?instId=${symbol}-USDT`,
        parsePrice: (data) => data?.data?.[0]?.last ? parseFloat(data.data[0].last) : null
    },
    huobi: {
        name: 'Huobi',
        fee: 0.2,
        url: (symbol) => `https://api.huobi.pro/market/detail/merged?symbol=${symbol.toLowerCase()}usdt`,
        parsePrice: (data) => data?.tick?.close ? parseFloat(data.tick.close) : null
    },
    bitget: {
        name: 'Bitget',
        fee: 0.1,
        url: (symbol) => `https://api.bitget.com/api/spot/v1/market/ticker?symbol=${symbol}USDT`,
        parsePrice: (data) => data?.data?.close ? parseFloat(data.data.close) : null
    }
};

// Fetch price from a single exchange with timeout
async function fetchExchangePrice(exchange, symbol, timeout = 6000) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const url = exchange.url(symbol);
        
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return null;
        }

        const data = await response.json();
        const price = exchange.parsePrice(data);
        
        return price;

    } catch (error) {
        return null;
    }
}

// Main handler
exports.handler = async (event, context) => {
    // Enable CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    // Get symbols from query parameters
    const symbols = event.queryStringParameters?.symbols;
    
    if (!symbols) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                error: 'Missing symbols parameter. Usage: ?symbols=BTC,ETH,XRP' 
            })
        };
    }

    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());

    console.log(`\n🚀 Processing ${symbolList.length} symbols with 26s timeout`);

    try {
        // Process all symbols in parallel
        const results = await Promise.all(
            symbolList.map(async (symbol) => {
                // Fetch all exchanges in parallel for this symbol
                const priceResults = await Promise.allSettled([
                    fetchExchangePrice(EXCHANGES.binance, symbol),
                    fetchExchangePrice(EXCHANGES.kucoin, symbol),
                    fetchExchangePrice(EXCHANGES.gateio, symbol),
                    fetchExchangePrice(EXCHANGES.mexc, symbol),
                    fetchExchangePrice(EXCHANGES.bybit, symbol),
                    fetchExchangePrice(EXCHANGES.okx, symbol),
                    fetchExchangePrice(EXCHANGES.huobi, symbol),
                    fetchExchangePrice(EXCHANGES.bitget, symbol)
                ]);

                const prices = priceResults.map((result) => {
                    return result.status === 'fulfilled' ? result.value : null;
                });

                const validPrices = prices.filter(p => p !== null).length;
                if (validPrices > 0) {
                    console.log(`✓ ${symbol}: ${validPrices}/8 exchanges`);
                }

                return {
                    symbol,
                    data: {
                        binance: prices[0],
                        kucoin: prices[1],
                        gateio: prices[2],
                        mexc: prices[3],
                        bybit: prices[4],
                        okx: prices[5],
                        huobi: prices[6],
                        bitget: prices[7],
                        timestamp: Date.now()
                    }
                };
            })
        );

        // Convert array to object
        const finalResults = {};
        results.forEach(({ symbol, data }) => {
            finalResults[symbol] = data;
        });

        const successCount = results.filter(r => {
            const validCount = Object.values(r.data).filter(v => v !== null && typeof v === 'number').length;
            return validCount > 0;
        }).length;

        console.log(`✅ Completed: ${successCount}/${symbolList.length} coins with data\n`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                data: finalResults,
                timestamp: Date.now()
            })
        };

    } catch (error) {
        console.error('Error in get-prices function:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};
