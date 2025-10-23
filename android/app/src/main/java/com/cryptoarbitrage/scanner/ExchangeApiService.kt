package com.cryptoarbitrage.scanner

import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * Exchange API Service - Fetches real prices from 8 cryptocurrency exchanges
 * This replaces the fake Math.random() price generation with real exchange API calls
 */
object ExchangeApiService {

    data class ExchangePrice(
        val exchangeName: String,
        val price: Double?
    )

    data class ExchangePrices(
        val symbol: String,
        val prices: Map<String, Double?>,
        val validPriceCount: Int
    )

    private data class ExchangeConfig(
        val name: String,
        val fee: Double,
        val urlBuilder: (String) -> String,
        val priceParser: (String) -> Double?
    )

    private val exchanges = listOf(
        ExchangeConfig(
            name = "Binance",
            fee = 0.1,
            urlBuilder = { symbol -> "https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT" },
            priceParser = { response ->
                try {
                    val json = JSONObject(response)
                    json.getDouble("price")
                } catch (e: Exception) {
                    null
                }
            }
        ),
        ExchangeConfig(
            name = "KuCoin",
            fee = 0.1,
            urlBuilder = { symbol -> "https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${symbol}-USDT" },
            priceParser = { response ->
                try {
                    val json = JSONObject(response)
                    if (json.getString("code") == "200000") {
                        json.getJSONObject("data").getDouble("price")
                    } else null
                } catch (e: Exception) {
                    null
                }
            }
        ),
        ExchangeConfig(
            name = "Gate.io",
            fee = 0.2,
            urlBuilder = { symbol -> "https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${symbol}_USDT" },
            priceParser = { response ->
                try {
                    val jsonArray = JSONArray(response)
                    if (jsonArray.length() > 0) {
                        jsonArray.getJSONObject(0).getDouble("last")
                    } else null
                } catch (e: Exception) {
                    null
                }
            }
        ),
        ExchangeConfig(
            name = "MEXC",
            fee = 0.2,
            urlBuilder = { symbol -> "https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}USDT" },
            priceParser = { response ->
                try {
                    val json = JSONObject(response)
                    if (json.has("price")) {
                        json.getDouble("price")
                    } else null
                } catch (e: Exception) {
                    null
                }
            }
        ),
        ExchangeConfig(
            name = "Bybit",
            fee = 0.1,
            urlBuilder = { symbol -> "https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}USDT" },
            priceParser = { response ->
                try {
                    val json = JSONObject(response)
                    val result = json.getJSONObject("result")
                    val list = result.getJSONArray("list")
                    if (list.length() > 0) {
                        list.getJSONObject(0).getDouble("lastPrice")
                    } else null
                } catch (e: Exception) {
                    null
                }
            }
        ),
        ExchangeConfig(
            name = "OKX",
            fee = 0.1,
            urlBuilder = { symbol -> "https://www.okx.com/api/v5/market/ticker?instId=${symbol}-USDT" },
            priceParser = { response ->
                try {
                    val json = JSONObject(response)
                    val data = json.getJSONArray("data")
                    if (data.length() > 0) {
                        data.getJSONObject(0).getDouble("last")
                    } else null
                } catch (e: Exception) {
                    null
                }
            }
        ),
        ExchangeConfig(
            name = "Huobi",
            fee = 0.2,
            urlBuilder = { symbol -> "https://api.huobi.pro/market/detail/merged?symbol=${symbol.lowercase()}usdt" },
            priceParser = { response ->
                try {
                    val json = JSONObject(response)
                    val tick = json.getJSONObject("tick")
                    tick.getDouble("close")
                } catch (e: Exception) {
                    null
                }
            }
        ),
        ExchangeConfig(
            name = "Bitget",
            fee = 0.1,
            urlBuilder = { symbol -> "https://api.bitget.com/api/spot/v1/market/ticker?symbol=${symbol}USDT" },
            priceParser = { response ->
                try {
                    val json = JSONObject(response)
                    val data = json.getJSONObject("data")
                    data.getDouble("close")
                } catch (e: Exception) {
                    null
                }
            }
        )
    )

    /**
     * Fetches real prices from all exchanges for a single symbol
     */
    suspend fun fetchPricesForSymbol(symbol: String): ExchangePrices = withContext(Dispatchers.IO) {
        val priceMap = mutableMapOf<String, Double?>()

        // Fetch from all exchanges in parallel
        val jobs = exchanges.map { exchange ->
            async {
                val price = fetchFromExchange(exchange, symbol)
                Pair(exchange.name, price)
            }
        }

        // Wait for all results
        jobs.awaitAll().forEach { (name, price) ->
            priceMap[name] = price
        }

        val validCount = priceMap.values.count { it != null }

        ExchangePrices(
            symbol = symbol,
            prices = priceMap,
            validPriceCount = validCount
        )
    }

    /**
     * Fetches real prices from all exchanges for multiple symbols
     */
    suspend fun fetchPricesForSymbols(symbols: List<String>): Map<String, ExchangePrices> = withContext(Dispatchers.IO) {
        val results = mutableMapOf<String, ExchangePrices>()

        // Process symbols in batches to avoid overwhelming the device
        symbols.chunked(10).forEach { batch ->
            val batchResults = batch.map { symbol ->
                async {
                    Pair(symbol, fetchPricesForSymbol(symbol))
                }
            }.awaitAll()

            batchResults.forEach { (symbol, prices) ->
                results[symbol] = prices
            }
        }

        results
    }

    /**
     * Fetches price from a single exchange with timeout
     */
    private suspend fun fetchFromExchange(
        exchange: ExchangeConfig,
        symbol: String,
        timeoutMs: Long = 6000
    ): Double? = withContext(Dispatchers.IO) {
        try {
            withTimeout(timeoutMs) {
                val url = exchange.urlBuilder(symbol)
                val connection = URL(url).openConnection() as HttpsURLConnection

                connection.apply {
                    requestMethod = "GET"
                    connectTimeout = 5000
                    readTimeout = 5000
                    setRequestProperty("User-Agent", "Mozilla/5.0")
                }

                val responseCode = connection.responseCode
                if (responseCode == 200) {
                    val response = connection.inputStream.bufferedReader().use { it.readText() }
                    exchange.priceParser(response)
                } else {
                    null
                }
            }
        } catch (e: Exception) {
            // Silently fail - this is expected for coins not available on certain exchanges
            null
        }
    }

    /**
     * Gets exchange fee by name
     */
    fun getExchangeFee(exchangeName: String): Double {
        return exchanges.find { it.name.equals(exchangeName, ignoreCase = true) }?.fee ?: 0.1
    }

    /**
     * Gets all exchange names
     */
    fun getAllExchangeNames(): List<String> {
        return exchanges.map { it.name }
    }
}
