// --- Imports ---
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto as webCrypto } from "https://deno.land/std@0.168.0/crypto/mod.ts"
import { decode as base64Decode, encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"

// --- Type Definitions ---
interface UpsertTradingAccountData {
  userId: string
  accountId?: string
  platform: string
  serverName: string
  loginId: string
  passwordPlainText: string
  isActive?: boolean
}

interface LogEntry {
  log_level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL'
  context: string
  message: string
  details: Record<string, unknown> | null
  session_id?: string
  user_id?: string
}

interface AdminGetSystemLogsData {
  limit?: number
  offset?: number
  log_level?: string
  context?: string
  start_date?: string
  end_date?: string
}

interface LocalStrategyParams {
  atrPeriod?: number
  atrMultiplierSL?: number
  atrMultiplierTP?: number
  smaShortPeriod?: number
  smaLongPeriod?: number
  bbPeriod?: number
  bbStdDevMult?: number
  rsiPeriod?: number
  rsiOversold?: number
  rsiOverbought?: number
  adxPeriod?: number
  adxTrendMinLevel?: number
  adxRangeThreshold?: number
  adxTrendThreshold?: number
  breakoutLookbackPeriod?: number
  atrSpikeMultiplier?: number
  risk_per_trade_percent?: number
  max_drawdown_percent?: number
  minChannelWidthATR?: number
  strategySelectionMode?: 'ADAPTIVE' | 'SMA_ONLY' | 'MEAN_REVERSION_ONLY' | 'BREAKOUT_ONLY'
}

interface OHLCData {
  high_price: number
  low_price: number
  close_price: number
  open_price: number
  timestamp: string
  volume?: number | null
}

interface DenoBotSession {
  id: string
  user_id: string
  trading_account_id: string
  risk_level: 'conservative' | 'medium' | 'risky'
  strategy_selection_mode?: LocalStrategyParams['strategySelectionMode']
  strategy_params?: Partial<LocalStrategyParams>
  total_trades: number
  winning_trades: number
  losing_trades: number
  total_profit: number
  session_initial_equity?: number | null
  session_peak_equity?: number | null
  max_drawdown_percent?: number | null
  trading_accounts?: { server_name: string, platform: string } | null
  session_start?: string
  last_trade_time?: string
}

interface ExecuteOrderParams {
  userId: string
  tradingAccountId: string
  symbol: string
  tradeType: 'BUY' | 'SELL'
  lotSize: number
  openPrice: number
  stopLossPrice: number
  takeProfitPrice?: number
  botSessionId?: string
}

interface ExecuteOrderResult {
  success: boolean
  tradeId?: string
  ticketId?: string
  error?: string
}

interface CloseOrderParams {
  ticketId: string
  lots?: number
  price?: number
  slippage?: number
  userId?: string
  tradingAccountId?: string
}

interface CloseOrderResult {
  success: boolean
  ticketId: string
  closePrice?: number
  profit?: number
  error?: string
}

interface AccountSummary {
  balance: number
  equity: number
  margin: number
  freeMargin: number
  currency: string
  error?: string
}

interface OpenPosition {
  ticket: string
  symbol: string
  type: 'BUY' | 'SELL'
  lots: number
  openPrice: number
  openTime: string
  stopLoss?: number
  takeProfit?: number
  currentPrice?: number
  profit?: number
  swap?: number
  comment?: string
}

interface ServerTime {
  time: string
  error?: string
}

interface ITradeExecutionProvider {
  executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult>
  closeOrder(params: CloseOrderParams): Promise<CloseOrderResult>
  getAccountSummary(tradingAccountId?: string): Promise<AccountSummary>
  getOpenPositions(tradingAccountId?: string): Promise<OpenPosition[]>
  getServerTime(): Promise<ServerTime>
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const VAULT_SECRET_KEY_NAME = "TRADING_ACCOUNT_ENC_KEY"

// --- Utility Functions ---
function getEnv(variableName: string): string {
  const value = Deno.env.get(variableName)
  if (!value) throw new Error(`Env var ${variableName} not set.`)
  return value
}

async function retryAsyncFunction<T>(fn: () => Promise<T>, maxRetries = 3, delayMs = 1000, context = "Unnamed"): Promise<T> {
  let attempts = 0
  while (attempts < maxRetries) {
    try {
      if (attempts > 0) console.log(`Retrying ${context}: Attempt ${attempts + 1}/${maxRetries}...`)
      return await fn()
    } catch (e) {
      const err = e as Error
      attempts++
      console.error(`Error in ${context} (Attempt ${attempts}):`, err.message)
      if (attempts >= maxRetries) throw err
      await new Promise(res => setTimeout(res, delayMs))
    }
  }
  throw new Error(`All retries failed for ${context}`)
}

// --- Encryption / Decryption ---
async function getKeyFromVault(): Promise<CryptoKey> {
  const keyMaterialBase64 = Deno.env.get(VAULT_SECRET_KEY_NAME)
  if (!keyMaterialBase64) throw new Error(`Vault secret ${VAULT_SECRET_KEY_NAME} not found.`)
  const keyMaterial = base64Decode(keyMaterialBase64)
  if (keyMaterial.byteLength !== 32) throw new Error("Vault encryption key must be 32 bytes.")
  return await webCrypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
}

async function encryptPassword(password: string): Promise<string> {
  const key = await getKeyFromVault()
  const iv = webCrypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(password)
  const encrypted = await webCrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded)
  return `${base64Encode(iv)}:${base64Encode(new Uint8Array(encrypted))}`
}

async function decryptPassword(encryptedPasswordWithIv: string): Promise<string> {
  const key = await getKeyFromVault()
  const [ivB64, encryptedB64] = encryptedPasswordWithIv.split(':')
  if (!ivB64 || !encryptedB64) throw new Error("Invalid encrypted password format.")
  const iv = base64Decode(ivB64)
  const encrypted = base64Decode(encryptedB64)
  const decrypted = await webCrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted)
  return new TextDecoder().decode(decrypted)
}
// --- Simulated Trade Provider ---
class SimulatedTradeProvider implements ITradeExecutionProvider {
  constructor(private supabase: SupabaseClient, private apiKey: string) {}

  async executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult> {
    try {
      const ticketId = crypto.randomUUID()
      const { error } = await this.supabase.from('trades').insert({
        user_id: params.userId,
        trading_account_id: params.tradingAccountId,
        ticket_id: ticketId,
        symbol: params.symbol,
        trade_type: params.tradeType,
        lot_size: params.lotSize,
        open_price: params.openPrice,
        stop_loss: params.stopLossPrice,
        take_profit: params.takeProfitPrice,
        status: 'open',
        bot_session_id: params.botSessionId
      })
      if (error) return { success: false, error: error.message }
      return { success: true, tradeId: ticketId, ticketId }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  }

  async closeOrder(params: CloseOrderParams): Promise<CloseOrderResult> {
    try {
      const price = await fetchCurrentGoldPriceFromAPI(this.apiKey)
      const { error } = await this.supabase.from('trades').update({
        close_price: price,
        status: 'closed',
        close_time: new Date().toISOString()
      }).eq('ticket_id', params.ticketId)
      if (error) throw error
      return { success: true, ticketId: params.ticketId, closePrice: price }
    } catch (e) {
      return { success: false, ticketId: params.ticketId, error: (e as Error).message }
    }
  }

  async getAccountSummary(): Promise<AccountSummary> {
    return { balance: 10000, equity: 10000, margin: 0, freeMargin: 10000, currency: 'USD' }
  }

  async getOpenPositions(): Promise<OpenPosition[]> {
    return []
  }

  async getServerTime(): Promise<ServerTime> {
    return { time: new Date().toISOString() }
  }
}

// --- MetaTrader Bridge Provider (stub if needed) ---
class MetaTraderBridgeProvider implements ITradeExecutionProvider {
  constructor(private url: string, private key: string) {}
  async executeOrder(): Promise<ExecuteOrderResult> { return { success: false, error: "Not implemented" } }
  async closeOrder(): Promise<CloseOrderResult> { return { success: false, ticketId: '', error: "Not implemented" } }
  async getAccountSummary(): Promise<AccountSummary> { return { balance: 0, equity: 0, margin: 0, freeMargin: 0, currency: 'USD' } }
  async getOpenPositions(): Promise<OpenPosition[]> { return [] }
  async getServerTime(): Promise<ServerTime> { return { time: new Date().toISOString() } }
}

// --- Indicator Calculations ---
function calculateSMA(prices: number[], period: number): (number | null)[] {
  const sma: (number | null)[] = Array(prices.length).fill(null)
  for (let i = period - 1; i < prices.length; i++) {
    const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    sma[i] = sum / period
  }
  return sma
}

function calculateATR(ohlc: OHLCData[], period: number): (number | null)[] {
  const atr: (number | null)[] = Array(ohlc.length).fill(null)
  for (let i = 1; i < ohlc.length; i++) {
    const tr = Math.max(
      ohlc[i].high_price - ohlc[i].low_price,
      Math.abs(ohlc[i].high_price - ohlc[i - 1].close_price),
      Math.abs(ohlc[i].low_price - ohlc[i - 1].close_price)
    )
    if (i >= period) {
      const slice = ohlc.slice(i - period + 1, i + 1)
      const sum = slice.reduce((acc, c, idx) => {
        const prev = slice[idx - 1] || c
        const range = Math.max(
          c.high_price - c.low_price,
          Math.abs(c.high_price - prev.close_price),
          Math.abs(c.low_price - prev.close_price)
        )
        return acc + range
      }, 0)
      atr[i] = sum / period
    }
  }
  return atr
}

function calculateRSI(ohlc: OHLCData[], period: number): (number | null)[] {
  const rsi: (number | null)[] = Array(ohlc.length).fill(null)
  const closes = ohlc.map(c => c.close_price)
  let gains = 0, losses = 0

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }

  let avgGain = gains / period
  let avgLoss = losses / period
  rsi[period] = 100 - (100 / (1 + avgGain / avgLoss))

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period
      avgLoss = (avgLoss * (period - 1)) / period
    } else {
      avgGain = (avgGain * (period - 1)) / period
      avgLoss = (avgLoss * (period - 1) - diff) / period
    }

    rsi[i] = 100 - (100 / (1 + avgGain / avgLoss))
  }

  return rsi
}

function calculateBollingerBands(prices: number[], period: number, stdDevMult: number): { upper: number | null, middle: number | null, lower: number | null }[] {
  const result: { upper: number | null, middle: number | null, lower: number | null }[] = []
  const sma = calculateSMA(prices, period)

  for (let i = 0; i < prices.length; i++) {
    const middle = sma[i]
    if (i >= period - 1 && middle !== null) {
      const slice = prices.slice(i - period + 1, i + 1)
      const variance = slice.reduce((acc, p) => acc + (p - middle!) ** 2, 0) / period
      const stdDev = Math.sqrt(variance)
      result.push({
        middle,
        upper: middle + stdDev * stdDevMult,
        lower: middle - stdDev * stdDevMult
      })
    } else {
      result.push({ upper: null, middle: null, lower: null })
    }
  }

  return result
}
// --- Strategy Result Types ---
interface MarketAnalysisResult {
  shouldTrade: boolean
  tradeType?: 'BUY' | 'SELL'
  priceAtDecision?: number
  stopLoss?: number
  takeProfit?: number
}

// --- Strategy Logic ---
async function analyzeMarketConditions(apiKey: string, strategy: LocalStrategyParams): Promise<MarketAnalysisResult> {
  // Example logic: Fetch historical data & apply one strategy
  const data = await fetchHistoricalGoldPrices(apiKey)
  if (data.length < 50) return { shouldTrade: false }

  const closes = data.map(c => c.close_price)
  const atr = calculateATR(data, strategy.atrPeriod ?? 14)
  const rsi = calculateRSI(data, strategy.rsiPeriod ?? 14)
  const latestClose = closes[closes.length - 1]
  const lastRSI = rsi[rsi.length - 1]

  if (lastRSI && lastRSI < (strategy.rsiOversold ?? 30)) {
    return {
      shouldTrade: true,
      tradeType: 'BUY',
      priceAtDecision: latestClose,
      stopLoss: latestClose - (atr[atr.length - 1] ?? 1) * (strategy.atrMultiplierSL ?? 1.5),
      takeProfit: latestClose + (atr[atr.length - 1] ?? 1) * (strategy.atrMultiplierTP ?? 3.0)
    }
  }

  if (lastRSI && lastRSI > (strategy.rsiOverbought ?? 70)) {
    return {
      shouldTrade: true,
      tradeType: 'SELL',
      priceAtDecision: latestClose,
      stopLoss: latestClose + (atr[atr.length - 1] ?? 1) * (strategy.atrMultiplierSL ?? 1.5),
      takeProfit: latestClose - (atr[atr.length - 1] ?? 1) * (strategy.atrMultiplierTP ?? 3.0)
    }
  }

  return { shouldTrade: false }
}

async function fetchHistoricalGoldPrices(apiKey: string): Promise<OHLCData[]> {
  const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=XAU&to_symbol=USD&interval=15min&apikey=${apiKey}&outputsize=compact`
  const response = await fetch(url)
  const json = await response.json()
  const series = json["Time Series FX (15min)"]
  if (!series) return []
  return Object.entries(series).map(([timestamp, values]: [string, any]) => ({
    open_price: parseFloat(values["1. open"]),
    high_price: parseFloat(values["2. high"]),
    low_price: parseFloat(values["3. low"]),
    close_price: parseFloat(values["4. close"]),
    timestamp
  })).reverse()
}

async function fetchCurrentGoldPriceFromAPI(apiKey: string): Promise<number> {
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=XAU&to_currency=USD&apikey=${apiKey}`
  const response = await fetch(url)
  const data = await response.json()
  const rate = data["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"]
  if (!rate) throw new Error("Rate not found")
  return parseFloat(rate)
}

// --- Bot Session Processing ---
async function processBotSession(supabase: SupabaseClient, session: DenoBotSession, apiKey: string) {
  const strategy = session.strategy_params || {}
  const analysis = await analyzeMarketConditions(apiKey, strategy)
  if (!analysis.shouldTrade || !analysis.tradeType || !analysis.priceAtDecision || !analysis.stopLoss) return

  const tradeProvider = new SimulatedTradeProvider(supabase, apiKey)

  const result = await tradeProvider.executeOrder({
    userId: session.user_id,
    tradingAccountId: session.trading_account_id,
    symbol: 'XAUUSD',
    tradeType: analysis.tradeType,
    lotSize: 0.01,
    openPrice: analysis.priceAtDecision,
    stopLossPrice: analysis.stopLoss,
    takeProfitPrice: analysis.takeProfit,
    botSessionId: session.id
  })

  if (result.success) {
    console.log(`Trade executed for session ${session.id}`)
  } else {
    console.warn(`Trade failed for session ${session.id}:`, result.error)
  }
}

// --- Serve block must come LAST ---
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const action = body.action
    const data = body.data

    const supabase = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'))
    const apiKey = getEnv('ALPHA_VANTAGE_API_KEY')

    switch (action) {
      case 'get_current_price_action': {
        const price = await fetchCurrentGoldPriceFromAPI(apiKey)
        return new Response(JSON.stringify({ price }), { headers: corsHeaders })
      }

      case 'run_bot_logic': {
        const { data: sessions } = await supabase.from('bot_sessions').select('*').eq('status', 'active')
        if (sessions && Array.isArray(sessions)) {
          for (const session of sessions) {
            await processBotSession(supabase, session, apiKey)
          }
        }
        return new Response(JSON.stringify({ status: 'Bot logic completed.' }), { headers: corsHeaders })
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: corsHeaders })
    }
  } catch (err) {
    const error = err as Error
    console.error("Error in handler:", error.message)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
  }
})
// -- Additional indicators like ADX, Breakout can go here if needed
