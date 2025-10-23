package com.cryptoarbitrage.scanner

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import kotlinx.coroutines.*
import org.json.JSONArray
import java.net.URL
import kotlin.math.abs

// AdMob imports
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.MobileAds

data class CoinData(
    val id: String,
    val name: String,
    val symbol: String,
    val price: Double,
    val marketCap: Double,
    val volume24h: Double,
    val percentChange24h: Double,
    val rank: Int
)

data class ArbitrageOpportunity(
    val coin: CoinData,
    val buyExchange: String,
    val sellExchange: String,
    val buyPrice: Double,
    val sellPrice: Double,
    val grossSpread: Double,
    val netSpread: Double,
    val totalFees: Double,
    val confidence: Int,
    val estimatedTime: Int
)

class MainActivity : AppCompatActivity() {
    private lateinit var recyclerView: RecyclerView
    private lateinit var adapter: OpportunityAdapter
    private lateinit var scanButton: Button
    private lateinit var statusText: TextView
    private lateinit var opportunitiesCountText: TextView
    private lateinit var bestSpreadText: TextView
    private lateinit var coinsTrackedText: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var minSpreadInput: EditText
    private lateinit var coinLimitSpinner: Spinner
    private lateinit var volumeFilterSpinner: Spinner

    // AdMob
    private lateinit var adView: AdView

    private val opportunities = mutableListOf<ArbitrageOpportunity>()
    private val livePrices = mutableMapOf<String, CoinData>()
    private var apiCallCount = 0

    private val handler = Handler(Looper.getMainLooper())
    private val autoRefreshRunnable = object : Runnable {
        override fun run() {
            if (livePrices.isNotEmpty()) {
                scanMarkets()
            }
            handler.postDelayed(this, 300000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // AdMob Initialize
        MobileAds.initialize(this) {}

        initializeViews()
        setupRecyclerView()
        setupSpinners()
        setupListeners()

        // AdMob Banner Load
        loadBannerAd()

        // Initial scan after 1 second
        handler.postDelayed({ scanMarkets() }, 1000)

        // Auto-refresh every 5 minutes
        handler.postDelayed(autoRefreshRunnable, 300000)
    }

    private fun initializeViews() {
        recyclerView = findViewById(R.id.recyclerView)
        scanButton = findViewById(R.id.scanButton)
        statusText = findViewById(R.id.statusText)
        opportunitiesCountText = findViewById(R.id.opportunitiesCount)
        bestSpreadText = findViewById(R.id.bestSpread)
        coinsTrackedText = findViewById(R.id.coinsTracked)
        progressBar = findViewById(R.id.progressBar)
        minSpreadInput = findViewById(R.id.minSpreadInput)
        coinLimitSpinner = findViewById(R.id.coinLimitSpinner)
        volumeFilterSpinner = findViewById(R.id.volumeFilterSpinner)

        // AdView
        adView = findViewById(R.id.adView)
    }

    private fun loadBannerAd() {
        val adRequest = AdRequest.Builder().build()
        adView.loadAd(adRequest)
    }

    private fun setupRecyclerView() {
        adapter = OpportunityAdapter(opportunities)
        recyclerView.layoutManager = LinearLayoutManager(this)
        recyclerView.adapter = adapter
    }

    private fun setupSpinners() {
        val coinLimits = arrayOf("Top 25", "Top 50", "Top 100", "Top 250")
        coinLimitSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, coinLimits)
        coinLimitSpinner.setSelection(1)

        val volumeFilters = arrayOf("No Minimum", "$1M+", "$10M+", "$100M+")
        volumeFilterSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, volumeFilters)
        volumeFilterSpinner.setSelection(1)
    }

    private fun setupListeners() {
        scanButton.setOnClickListener {
            scanMarkets()
        }

        minSpreadInput.setOnFocusChangeListener { _, hasFocus ->
            if (!hasFocus && livePrices.isNotEmpty()) {
                // Re-filter opportunities with new minimum spread
                findRealArbitrageOpportunities()
            }
        }

        volumeFilterSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (livePrices.isNotEmpty()) {
                    findRealArbitrageOpportunities()
                }
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun scanMarkets() {
        scanButton.isEnabled = false
        scanButton.text = "Scanning..."
        progressBar.visibility = View.VISIBLE
        statusText.text = "Fetching coin list from CoinGecko..."

        CoroutineScope(Dispatchers.IO).launch {
            try {
                // Step 1: Fetch coin list from CoinGecko
                val coinLimit = when (coinLimitSpinner.selectedItemPosition) {
                    0 -> 25
                    1 -> 50
                    2 -> 100
                    else -> 250
                }

                val url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=$coinLimit&page=1&sparkline=false&price_change_percentage=24h"
                val response = URL(url).readText()
                val jsonArray = JSONArray(response)

                livePrices.clear()
                for (i in 0 until jsonArray.length()) {
                    val coin = jsonArray.getJSONObject(i)
                    val symbol = coin.getString("symbol").uppercase()
                    livePrices[symbol] = CoinData(
                        id = coin.getString("id"),
                        name = coin.getString("name"),
                        symbol = symbol,
                        price = coin.getDouble("current_price"),
                        marketCap = coin.getDouble("market_cap"),
                        volume24h = coin.getDouble("total_volume"),
                        percentChange24h = coin.optDouble("price_change_percentage_24h", 0.0),
                        rank = i + 1
                    )
                }

                apiCallCount++

                withContext(Dispatchers.Main) {
                    statusText.text = "Fetching real prices from 8 exchanges..."
                }

                // Step 2: Fetch real prices from all exchanges
                findRealArbitrageOpportunities()

                withContext(Dispatchers.Main) {
                    statusText.text = "Live • ${opportunities.size} opportunities found"
                    updateStats()
                    progressBar.visibility = View.GONE
                    scanButton.isEnabled = true
                    scanButton.text = "⚡ Scan Live Markets"
                }

            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    statusText.text = "Error: ${e.message}"
                    progressBar.visibility = View.GONE
                    scanButton.isEnabled = true
                    scanButton.text = "⚡ Scan Live Markets"
                    Toast.makeText(this@MainActivity, "Failed to fetch data: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    /**
     * Finds REAL arbitrage opportunities using actual exchange API prices
     * This replaces the fake Math.random() calculations
     */
    private suspend fun findRealArbitrageOpportunities() = withContext(Dispatchers.IO) {
        opportunities.clear()

        val minSpread = withContext(Dispatchers.Main) {
            minSpreadInput.text.toString().toDoubleOrNull() ?: 0.1
        }

        val minVolume = when (volumeFilterSpinner.selectedItemPosition) {
            0 -> 0.0
            1 -> 1000000.0
            2 -> 10000000.0
            else -> 100000000.0
        }

        // Filter eligible coins by volume
        val eligibleCoins = livePrices.values.filter { it.volume24h >= minVolume }

        withContext(Dispatchers.Main) {
            statusText.text = "Scanning ${eligibleCoins.size} coins across 8 exchanges..."
        }

        // Fetch prices from all exchanges for all eligible coins
        val symbols = eligibleCoins.map { it.symbol }
        val allExchangePrices = ExchangeApiService.fetchPricesForSymbols(symbols)

        // Analyze each coin for arbitrage opportunities
        eligibleCoins.forEach { coin ->
            val exchangePrices = allExchangePrices[coin.symbol]

            if (exchangePrices == null || exchangePrices.validPriceCount < 2) {
                // Not enough exchange data for this coin
                return@forEach
            }

            // Get valid prices (filter out nulls)
            val validPrices = exchangePrices.prices
                .filter { it.value != null }
                .map { (exchange, price) -> Pair(exchange, price!!) }

            if (validPrices.size < 2) {
                return@forEach
            }

            // Find lowest and highest prices
            val sortedPrices = validPrices.sortedBy { it.second }
            val (buyExchange, buyPrice) = sortedPrices.first()
            val (sellExchange, sellPrice) = sortedPrices.last()

            // Calculate gross spread
            val grossSpreadPercent = ((sellPrice - buyPrice) / buyPrice) * 100

            // Calculate fees
            val buyFee = ExchangeApiService.getExchangeFee(buyExchange)
            val sellFee = ExchangeApiService.getExchangeFee(sellExchange)
            val totalFees = buyFee + sellFee

            // Net spread after fees
            val netSpread = grossSpreadPercent - totalFees

            // Only add if meets minimum spread requirement
            if (netSpread >= minSpread) {
                val confidence = if (validPrices.size >= 5) 95 else if (validPrices.size >= 3) 90 else 85
                val estimatedTime = when {
                    buyExchange.contains("Binance", true) || sellExchange.contains("Binance", true) -> 3
                    buyExchange.contains("Coinbase", true) || sellExchange.contains("Coinbase", true) -> 5
                    else -> (5 + Math.random() * 10).toInt()
                }

                opportunities.add(
                    ArbitrageOpportunity(
                        coin = coin,
                        buyExchange = buyExchange,
                        sellExchange = sellExchange,
                        buyPrice = buyPrice,
                        sellPrice = sellPrice,
                        grossSpread = grossSpreadPercent,
                        netSpread = netSpread,
                        totalFees = totalFees,
                        confidence = confidence,
                        estimatedTime = estimatedTime
                    )
                )
            }
        }

        // Sort by net spread (highest first) and limit to top 10
        opportunities.sortByDescending { it.netSpread }
        if (opportunities.size > 10) {
            opportunities.subList(10, opportunities.size).clear()
        }

        withContext(Dispatchers.Main) {
            adapter.notifyDataSetChanged()
            updateStats()
        }
    }

    private fun updateStats() {
        opportunitiesCountText.text = opportunities.size.toString()
        bestSpreadText.text = if (opportunities.isNotEmpty()) {
            String.format("%.2f%%", opportunities[0].netSpread)
        } else {
            "0%"
        }
        coinsTrackedText.text = livePrices.size.toString()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(autoRefreshRunnable)
    }
}

class OpportunityAdapter(private val opportunities: List<ArbitrageOpportunity>) :
    RecyclerView.Adapter<OpportunityAdapter.ViewHolder>() {

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val coinName: TextView = view.findViewById(R.id.coinName)
        val coinSymbol: TextView = view.findViewById(R.id.coinSymbol)
        val coinRank: TextView = view.findViewById(R.id.coinRank)
        val coinPrice: TextView = view.findViewById(R.id.coinPrice)
        val priceChange: TextView = view.findViewById(R.id.priceChange)
        val marketCap: TextView = view.findViewById(R.id.marketCap)
        val volume: TextView = view.findViewById(R.id.volume)
        val netSpread: TextView = view.findViewById(R.id.netSpread)
        val buyExchange: TextView = view.findViewById(R.id.buyExchange)
        val buyPrice: TextView = view.findViewById(R.id.buyPrice)
        val sellExchange: TextView = view.findViewById(R.id.sellExchange)
        val sellPrice: TextView = view.findViewById(R.id.sellPrice)
        val profit1k: TextView = view.findViewById(R.id.profit1k)
        val profit5k: TextView = view.findViewById(R.id.profit5k)
        val grossSpread: TextView = view.findViewById(R.id.grossSpread)
        val totalFees: TextView = view.findViewById(R.id.totalFees)
        val confidence: TextView = view.findViewById(R.id.confidence)
        val estimatedTime: TextView = view.findViewById(R.id.estimatedTime)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_opportunity, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val opp = opportunities[position]

        holder.coinName.text = opp.coin.name
        holder.coinSymbol.text = opp.coin.symbol
        holder.coinRank.text = "#${opp.coin.rank}"
        holder.coinPrice.text = "$${formatPrice(opp.coin.price)}"

        val changeSign = if (opp.coin.percentChange24h >= 0) "+" else ""
        holder.priceChange.text = "$changeSign${String.format("%.2f", opp.coin.percentChange24h)}%"
        holder.priceChange.setTextColor(
            if (opp.coin.percentChange24h >= 0) 0xFF4CAF50.toInt() else 0xFFF44336.toInt()
        )

        holder.marketCap.text = "$${formatNumber(opp.coin.marketCap)}"
        holder.volume.text = "$${formatNumber(opp.coin.volume24h)}"
        holder.netSpread.text = String.format("+%.2f%%", opp.netSpread)

        holder.buyExchange.text = opp.buyExchange
        holder.buyPrice.text = "$${formatPrice(opp.buyPrice)}"
        holder.sellExchange.text = opp.sellExchange
        holder.sellPrice.text = "$${formatPrice(opp.sellPrice)}"

        holder.profit1k.text = "$${String.format("%.2f", 1000 * opp.netSpread / 100)}"
        holder.profit5k.text = "$${String.format("%.2f", 5000 * opp.netSpread / 100)}"
        holder.grossSpread.text = String.format("%.2f%%", opp.grossSpread)
        holder.totalFees.text = String.format("%.2f%%", opp.totalFees)
        holder.confidence.text = "${opp.confidence}%"
        holder.estimatedTime.text = "${opp.estimatedTime}min"
    }

    override fun getItemCount() = opportunities.size

    private fun formatPrice(price: Double): String {
        return when {
            price >= 1000 -> String.format("%,.2f", price)
            price >= 100 -> String.format("%.2f", price)
            price >= 1 -> String.format("%.3f", price)
            price >= 0.01 -> String.format("%.4f", price)
            price >= 0.0001 -> String.format("%.6f", price)
            else -> String.format("%.8f", price)
        }
    }

    private fun formatNumber(num: Double): String {
        return when {
            num >= 1e12 -> String.format("%.2fT", num / 1e12)
            num >= 1e9 -> String.format("%.2fB", num / 1e9)
            num >= 1e6 -> String.format("%.2fM", num / 1e6)
            num >= 1e3 -> String.format("%.2fK", num / 1e3)
            else -> String.format("%.0f", num)
        }
    }
}
