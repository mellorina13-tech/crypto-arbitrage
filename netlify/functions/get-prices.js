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
    }
};

// Fetch price from a single exchange with timeout
async function fetchExchangePrice(exchange, symbol, timeout = 3000) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(exchange.url(symbol), {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return null;
        }

        const data = await response.json();
        return exchange.parsePrice(data);

    } catch (error) {
        console.log(`Error fetching ${symbol} from ${exchange.name}:`, error.message);
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

    console.log(`Fetching prices for: ${symbolList.join(', ')}`);

    try {
        // Fetch prices for all symbols from all exchanges in parallel
        const results = {};

        for (const symbol of symbolList) {
            console.log(`Fetching ${symbol}...`);

            const prices = await Promise.all([
                fetchExchangePrice(EXCHANGES.binance, symbol),
                fetchExchangePrice(EXCHANGES.kucoin, symbol),
                fetchExchangePrice(EXCHANGES.gateio, symbol),
                fetchExchangePrice(EXCHANGES.mexc, symbol)
            ]);

            results[symbol] = {
                binance: prices[0],
                kucoin: prices[1],
                gateio: prices[2],
                mexc: prices[3],
                timestamp: Date.now()
            };

            console.log(`${symbol} results:`, results[symbol]);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                data: results,
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
