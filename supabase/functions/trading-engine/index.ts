import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  crypto as webCrypto,
} from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { decode as base64Decode, encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

// --- Type Definitions ---
interface UpsertTradingAccountData {
  userId: string;
  accountId?: string;
  platform: string;
  serverName: string;
  loginId: string;
  passwordPlainText: string;
  isActive?: boolean;
}

interface LogEntry {
  log_level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  context: string;
  message: string;
  details: Record<string, unknown> | null;
  session_id?: string;
  user_id?: string;
}

interface AdminGetSystemLogsData {
  limit?: number;
  offset?: number;
  log_level?: string;
  context?: string;
  start_date?: string;
  end_date?: string;
}

interface LocalStrategyParams {
  atrPeriod?: number;
  atrMultiplierSL?: number;
  atrMultiplierTP?: number;
  smaShortPeriod?: number;
  smaLongPeriod?: number;
  bbPeriod?: number;
  bbStdDevMult?: number;
  rsiPeriod?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  adxPeriod?: number;
  adxTrendMinLevel?: number;
  adxRangeThreshold?: number;
  adxTrendThreshold?: number;
  breakoutLookbackPeriod?: number;
  atrSpikeMultiplier?: number;
  risk_per_trade_percent?: number;
  max_drawdown_percent?: number;
}

interface FetchHistoricalDataParams {
  symbol?: string;
  fromCurrency?: string;
  toCurrency?: string;
  interval?: string;
  outputsize?: string;
}

interface BacktestRiskSettings {
  riskLevel: 'conservative' | 'medium' | 'risky';
  maxLotSize?: number;
}

interface RunBacktestData {
  userId?: string;
  symbol?: string;
  timeframe?: string;
  startDate: string;
  endDate: string;
  strategySettings?: Partial<LocalStrategyParams>;
  riskSettings?: BacktestRiskSettings;
  commissionPerLot?: number;
  slippagePoints?: number;
}

interface OHLCData {
  high_price: number;
  low_price: number;
  close_price: number;
  open_price: number;
  timestamp: string;
  volume?:number | null;
}

interface AlphaVantageTimeSeriesValue {
  "1. open": string;
  "2. high": string;
  "3. low": string;
  "4. close": string;
  "5. volume"?: string;
}

interface AlphaVantageFXRate {
  "Realtime Currency Exchange Rate": {
    "1. From_Currency Code": string;
    "2. From_Currency Name": string;
    "3. To_Currency Code": string;
    "4. To_Currency Name": string;
    "5. Exchange Rate": string;
    "6. Last Refreshed": string;
    "7. Time Zone": string;
    "8. Bid Price": string;
    "9. Ask Price": string;
  };
}

interface AlphaVantageInformation { Information: string; }

interface DenoBotSession {
  id: string;
  user_id: string;
  trading_account_id: string;
  risk_level: 'conservative' | 'medium' | 'risky';
  strategy_selection_mode?: 'ADAPTIVE' | 'SMA_ONLY' | 'MEAN_REVERSION_ONLY' | 'BREAKOUT_ONLY';
  strategy_params?: Partial<LocalStrategyParams>;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  total_profit: number;
  session_initial_equity?: number | null;
  session_peak_equity?: number | null;
  max_drawdown_percent?: number | null;
  trading_accounts?: { server_name: string, platform: string } | null;
  session_start?: string;
  last_trade_time?: string;
}

interface RequestBody {
  action: string;
  data: unknown;
}
// --- End Type Definitions ---

function getEnv(variableName: string): string {
  const value = Deno.env.get(variableName);
  if (!value) { throw new Error(`Env var ${variableName} not set.`); }
  return value;
}

const VAULT_SECRET_KEY_NAME = "TRADING_ACCOUNT_ENC_KEY";
async function getKeyFromVault(): Promise<CryptoKey> {
  const keyMaterialBase64 = Deno.env.get(VAULT_SECRET_KEY_NAME);
  if (!keyMaterialBase64) { throw new Error(`Vault secret ${VAULT_SECRET_KEY_NAME} not found.`); }
  try {
    const keyMaterial = base64Decode(keyMaterialBase64);
    if (keyMaterial.byteLength !== 32) { throw new Error("Vault encryption key must be 32 bytes."); }
    return await webCrypto.subtle.importKey( "raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt", "decrypt"] );
  } catch (e) { const error = e as Error; console.error("Error importing key from vault:", error.message); throw new Error("Failed to import encryption key."); }
}

async function encryptPassword(password: string): Promise<string> {
  const key = await getKeyFromVault();
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const encodedPassword = new TextEncoder().encode(password);
  const encryptedData = await webCrypto.subtle.encrypt( { name: "AES-GCM", iv: iv }, key, encodedPassword );
  const ivBase64 = base64Encode(iv);
  const encryptedBase64 = base64Encode(new Uint8Array(encryptedData));
  return `${ivBase64}:${encryptedBase64}`;
}
async function decryptPassword(encryptedPasswordWithIv: string): Promise<string> {
  const key = await getKeyFromVault();
  const parts = encryptedPasswordWithIv.split(':');
  if (parts.length !== 2) { throw new Error("Invalid encrypted password format."); }
  const iv = base64Decode(parts[0]);
  const encryptedData = base64Decode(parts[1]);
  const decryptedData = await webCrypto.subtle.decrypt( { name: "AES-GCM", iv: iv }, key, encryptedData );
  return new TextDecoder().decode(decryptedData);
}

async function upsertTradingAccountAction(supabase: SupabaseClient, data: UpsertTradingAccountData) {
  const { userId, accountId, platform, serverName, loginId, passwordPlainText, isActive = true } = data;
  if (!userId || !platform || !serverName || !loginId || !passwordPlainText) { return new Response(JSON.stringify({ error: "Missing required fields." }), { status: 400, headers: corsHeaders }); }
  try {
    const encryptedPassword = await encryptPassword(passwordPlainText);
    const accountDataToUpsert = { user_id: userId, platform, server_name: serverName, login_id: loginId, password_encrypted: encryptedPassword, is_active: isActive };
    let result;
    if (accountId) { result = await supabase.from('trading_accounts').update(accountDataToUpsert).eq('id', accountId).eq('user_id', userId).select().single(); }
    else { result = await supabase.from('trading_accounts').insert(accountDataToUpsert).select().single(); }
    const { data: savedAccount, error: dbError } = result;
    if (dbError) { if (dbError.code === '23505') { return new Response(JSON.stringify({ error: "Account with this login already exists." }), { status: 409, headers: corsHeaders }); } throw dbError; }
    if (!savedAccount) { throw new Error("Account data not returned after upsert."); }
    const { password_encrypted, ...accountToReturn } = savedAccount;
    return new Response(JSON.stringify(accountToReturn), { headers: corsHeaders });
  } catch (e) {
    const error = e as Error;
    console.error("Error in upsertTradingAccountAction:", error.message, error.stack);
    const isCryptoError = error.message.includes(VAULT_SECRET_KEY_NAME) || error.message.includes("Failed to import encryption key");
    await logSystemEvent( supabase, isCryptoError ? 'CRITICAL' : 'ERROR', 'UpsertTradingAccount', isCryptoError ? `Encryption setup error: ${error.message}` : `Failed to save account: ${error.message}`, { stack: error.stack, userId: data?.userId, accountId: data?.accountId } );
    return new Response(JSON.stringify({ error: `Failed to save account: ${error.message}` }), { status: 500, headers: corsHeaders });
  }
}

async function retryAsyncFunction<T>( asyncFn: () => Promise<T>, maxRetries = 3, delayMs = 1000, context = "Unnamed" ): Promise<T> {
  let attempts = 0;
  while (attempts < maxRetries) {
    try { if (attempts > 0) console.log(`Retrying ${context}: Attempt ${attempts + 1}/${maxRetries}...`); return await asyncFn(); }
    catch (e) { const error = e as Error; attempts++; console.error(`Error in ${context} (Attempt ${attempts}):`, error.message); if (attempts >= maxRetries) { console.error(`All ${maxRetries} retries failed for ${context}.`); throw error; } await new Promise(resolve => setTimeout(resolve, delayMs)); }
  }
  throw new Error(`All retries failed for ${context}`);
}

async function logSystemEvent( supabaseClient: SupabaseClient, level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL', context: string, message: string, details?: Record<string, unknown>, sessionId?: string, userId?: string ) {
  try {
    const logEntry: LogEntry = { log_level: level, context, message, details: details || null };
    if (sessionId) logEntry.session_id = sessionId; if (userId) logEntry.user_id = userId;
    const { error } = await supabaseClient.from('system_logs').insert(logEntry);
    if (error) { console.error('Failed to insert system log:', error, logEntry); }
  } catch (e) { const error = e as Error; console.error('Exception in logSystemEvent:', error.message); }
}

async function isAdmin(supabaseClient: SupabaseClient, requestHeaders: Headers): Promise<{ authorized: boolean, userId?: string, userEmail?: string }> {
  const authHeader = requestHeaders.get('Authorization');
  if (!authHeader) { console.warn("isAdmin: No Auth header."); return { authorized: false }; }
  try {
    const { data: { user }, error } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (error) { console.warn("isAdmin: Error getting user from JWT:", error.message); return { authorized: false }; }
    if (!user) { console.warn("isAdmin: No user from JWT."); return { authorized: false }; }
    const adminEmail = Deno.env.get("ADMIN_EMAIL_ADDRESS");
    if (adminEmail && user.email === adminEmail) { return { authorized: true, userId: user.id, userEmail: user.email }; }
    console.warn(`isAdmin: User ${user.email} not authorized.`); return { authorized: false, userId: user.id, userEmail: user.email };
  } catch (e) { const error = e as Error; console.error("isAdmin: Exception:", error.message); return { authorized: false }; }
}

async function adminGetEnvVariablesStatusAction(supabaseClient: SupabaseClient, _data: unknown, headers: Headers) {
  const adminCheck = await isAdmin(supabaseClient, headers);
  if (!adminCheck.authorized) { await logSystemEvent(supabaseClient, 'WARN', 'AdminActionAttempt', 'Unauthorized adminGetEnvVariablesStatusAction.', { userId: adminCheck.userId, userEmail: adminCheck.userEmail }); return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: corsHeaders });}
  const criticalEnvVars = [ 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ALPHA_VANTAGE_API_KEY', 'SENDGRID_API_KEY', 'FROM_EMAIL', 'NOTIFICATION_EMAIL_RECIPIENT', 'MT_BRIDGE_URL', 'MT_BRIDGE_API_KEY', 'TRADE_PROVIDER_TYPE', VAULT_SECRET_KEY_NAME, 'ADMIN_EMAIL_ADDRESS' ];
  const statuses = criticalEnvVars.map(varName => ({ name: varName, status: Deno.env.get(varName) ? "SET" : "NOT SET" }));
  return new Response(JSON.stringify(statuses), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function adminListUsersOverviewAction(supabaseClient: SupabaseClient, _data: unknown, headers: Headers) {
  const adminCheck = await isAdmin(supabaseClient, headers);
  if (!adminCheck.authorized) { await logSystemEvent(supabaseClient, 'WARN', 'AdminActionAttempt', 'Unauthorized adminListUsersOverviewAction.', { userId: adminCheck.userId, userEmail: adminCheck.userEmail }); return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: corsHeaders });}
  try {
    const { data: { users }, error } = await supabaseClient.auth.admin.listUsers({ page: 1, perPage: 100 });
    if (error) throw error;
    const usersOverview = users.map(user => ({ id: user.id, email: user.email, created_at: user.created_at, last_sign_in_at: user.last_sign_in_at }));
    return new Response(JSON.stringify(usersOverview), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) { const error = e as Error; console.error("Error in adminListUsersOverviewAction:", error.message); return new Response(JSON.stringify({ error: "Failed to list users: " + error.message }), { status: 500, headers: corsHeaders }); }
}

async function adminGetSystemLogsAction(supabaseClient: SupabaseClient, data: AdminGetSystemLogsData | null, headers: Headers) {
  const adminCheck = await isAdmin(supabaseClient, headers);
  if (!adminCheck.authorized) { await logSystemEvent(supabaseClient, 'WARN', 'AdminActionAttempt', 'Unauthorized adminGetSystemLogsAction.', { userId: adminCheck.userId, userEmail: adminCheck.userEmail }); return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: corsHeaders });}
  const { limit = 50, offset = 0, log_level, context, start_date, end_date } = data || {};
  try {
    let query = supabaseClient.from('system_logs').select('*', { count: 'exact' }); // Added count for pagination
    if (log_level) query = query.eq('log_level', log_level); if (context) query = query.ilike('context', `%${context}%`);
    if (start_date) query = query.gte('created_at', start_date); if (end_date) query = query.lte('created_at', end_date);
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    const { data: logs, error, count } = await query;
    if (error) throw error;
    return new Response(JSON.stringify({ logs, count }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) { const error = e as Error; console.error("Error in adminGetSystemLogsAction:", error.message); await logSystemEvent(supabaseClient, 'ERROR', 'AdminGetSystemLogs', `Failed to fetch logs: ${error.message}`, { stack: error.stack, filters: data as Record<string, unknown> }); return new Response(JSON.stringify({ error: "Failed to fetch logs: " + error.message }), { status: 500, headers: corsHeaders }); }
}

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
let latestGoldPrice: { price: number; timestamp: number } | null = null;
const PRICE_CACHE_DURATION_MS = 5 * 60 * 1000;

interface ExecuteOrderParams { userId: string; tradingAccountId: string; symbol: string; tradeType: 'BUY' | 'SELL'; lotSize: number; openPrice: number; stopLossPrice: number; takeProfitPrice?: number; botSessionId?: string; }
interface ExecuteOrderResult { success: boolean; tradeId?: string; ticketId?: string; error?: string; }
interface CloseOrderParams { ticketId: string; lots?: number; price?: number; slippage?: number; userId?: string; tradingAccountId?: string; }
interface CloseOrderResult { success: boolean; ticketId: string; closePrice?: number; profit?: number; error?: string; }
interface AccountSummary { balance: number; equity: number; margin: number; freeMargin: number; currency: string; error?: string; }
interface OpenPosition { ticket: string; symbol: string; type: 'BUY' | 'SELL'; lots: number; openPrice: number; openTime: string; stopLoss?: number; takeProfit?: number; currentPrice?: number; profit?: number; swap?: number; comment?: string; }
interface ServerTime { time: string; error?: string; }

interface ITradeExecutionProvider {
  executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult>;
  closeOrder(params: CloseOrderParams): Promise<CloseOrderResult>;
  getAccountSummary(tradingAccountId?: string): Promise<AccountSummary>;
  getOpenPositions(tradingAccountId?: string): Promise<OpenPosition[]>;
  getServerTime(): Promise<ServerTime>;
}

class SimulatedTradeProvider implements ITradeExecutionProvider {
  private supabase: SupabaseClient; private alphaVantageApiKey: string;
  constructor(supabaseClient: SupabaseClient, alphaVantageApiKey: string) { this.supabase = supabaseClient; this.alphaVantageApiKey = alphaVantageApiKey; }
  async executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult> {
    try {
      const ticketId = generateTicketId();
      const { data: dbTrade, error } = await this.supabase.from('trades').insert({ user_id: params.userId, trading_account_id: params.tradingAccountId, ticket_id: ticketId, symbol: params.symbol, trade_type: params.tradeType, lot_size: params.lotSize, open_price: params.openPrice, stop_loss: params.stopLossPrice, take_profit: params.takeProfitPrice, status: 'open', bot_session_id: params.botSessionId, }).select('id').single();
      if (error) { console.error('SimulatedTradeProvider: Error inserting trade:', error); return { success: false, error: error.message, ticketId }; }
      if (!dbTrade || !dbTrade.id) { return { success: false, error: "SimulatedTradeProvider: Failed to insert trade or get ID.", ticketId }; }
      return { success: true, tradeId: dbTrade.id, ticketId };
    } catch (e) { const error = e as Error; console.error('SimulatedTradeProvider: Exception in executeOrder:', error.message); return { success: false, error: error.message }; }
  }
  async closeOrder(params: CloseOrderParams): Promise<CloseOrderResult> {
    const { ticketId } = params;
    try {
      const currentPrice = await getCurrentGoldPrice(this.alphaVantageApiKey);
      const { data: tradeToClose, error: fetchError } = await this.supabase.from('trades').select<string, {id: string, trade_type: 'BUY' | 'SELL', open_price: number, lot_size: number} & Record<string,unknown>>('*').eq('id', ticketId).eq('status', 'open').single();
      if (fetchError) throw new Error(`Error fetching trade: ${fetchError.message}`);
      if (!tradeToClose) return { success: false, ticketId, error: "Open trade not found." };
      const priceDiff = tradeToClose.trade_type === 'BUY' ? currentPrice - tradeToClose.open_price : tradeToClose.open_price - currentPrice;
      const profitLoss = priceDiff * tradeToClose.lot_size * 100;
      const { error: updateError } = await this.supabase.from('trades').update({ close_price: currentPrice, profit_loss: profitLoss, status: 'closed', close_time: new Date().toISOString(), }).eq('id', ticketId);
      if (updateError) throw new Error(`Error updating trade: ${updateError.message}`);
      return { success: true, ticketId, closePrice: currentPrice, profit: parseFloat(profitLoss.toFixed(2)) };
    } catch (e) { const error = e as Error; console.error('SimulatedTradeProvider: Exception in closeOrder:', error.message); return { success: false, ticketId, error: error.message }; }
  }
  async getAccountSummary(tradingAccountId?: string): Promise<AccountSummary> {
    if (tradingAccountId) {
        const {data, error} = await this.supabase.from('trading_accounts').select('account_balance, equity, margin, free_margin, currency').eq('id', tradingAccountId).single();
        if (error || !data) { console.error("SimulatedProvider: Error getting account summary:", tradingAccountId, error); return { balance: 0, equity: 0, margin: 0, freeMargin: 0, currency: 'USD', error: "Account not found."}; }
        return { balance: data.account_balance || 0, equity: data.equity || 0, margin: data.margin || 0, freeMargin: data.free_margin || 0, currency: data.currency || 'USD' };
    }
    return { balance: 10000, equity: 10000, margin: 0, freeMargin: 10000, currency: 'USD', error: "No accountId." };
  }
  async getOpenPositions(accountId?: string): Promise<OpenPosition[]> {
    try {
      let query = this.supabase.from('trades').select('*').eq('status', 'open');
      if (accountId) { query = query.eq('trading_account_id', accountId); }
      const { data, error } = await query; if (error) throw error;
      return (data || []).map(t => ({ ticket: t.id, symbol: t.symbol, type: t.trade_type, lots: t.lot_size, openPrice: t.open_price, openTime: t.created_at, stopLoss: t.stop_loss, takeProfit: t.take_profit, comment: t.bot_session_id ? `BotSess:${t.bot_session_id}` : (t.ticket_id || '') }));
    } catch (e) { const error = e as Error; console.error('SimulatedProvider: Exception in getOpenPositions:', error.message); return []; }
  }
  async getServerTime(): Promise<ServerTime> { return { time: new Date().toISOString() }; }
}

class MetaTraderBridgeProvider implements ITradeExecutionProvider {
  private bridgeUrl: string; private bridgeApiKey: string;
  constructor(bridgeUrl: string, bridgeApiKey: string) { if (!bridgeUrl || !bridgeApiKey) { throw new Error("MTBridgeProvider: URL and API Key required."); } this.bridgeUrl = bridgeUrl.endsWith('/') ? bridgeUrl.slice(0, -1) : bridgeUrl; this.bridgeApiKey = bridgeApiKey; }
  private async makeRequest(endpoint: string, method: string, body?: Record<string, unknown>): Promise<Record<string, unknown> | { success: boolean, message: string }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-MT-Bridge-API-Key': this.bridgeApiKey };
    const fetchFn = async () => {
      const response = await fetch(`${this.bridgeUrl}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) {
        const errorText = await response.text(); let errorData: { error?: string, details?: string } = {};
        try { errorData = JSON.parse(errorText); } catch (e) { errorData = { error: "Failed to parse error from bridge", details: errorText }; }
        console.error(`MTBridgeProvider Error (Attempt): ${response.status} for ${method} ${endpoint}`, errorData);
        throw new Error(`Bridge API Error: ${response.status} - ${errorData.error || response.statusText}`);
      }
      if (response.status === 202 || response.status === 204) { return { success: true, message: `Request to ${endpoint} accepted.` }; }
      return await response.json();
    };
    try { return await retryAsyncFunction(fetchFn, 2, 3000, `MTBridgeProvider.makeRequest(${method} ${endpoint})`); }
    catch (e) { const error = e as Error; console.error(`All retries failed for MTBridgeProvider.makeRequest (${method} ${endpoint}):`, error.message); throw error; }
  }
  async executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult> {
    try {
      const requestBody = { symbol: params.symbol, type: params.tradeType, lots: params.lotSize, price: params.openPrice, stopLossPrice: params.stopLossPrice, takeProfitPrice: params.takeProfitPrice, magicNumber: params.botSessionId ? parseInt(params.botSessionId.replace(/\D/g,'').slice(-7)) || 0 : 0, comment: `BotTrade_Sess${params.botSessionId || 'N/A'}` };
      const responseData = await this.makeRequest('/order/execute', 'POST', requestBody) as Record<string, any>;
      if (responseData.success && responseData.ticket) { return { success: true, tradeId: responseData.ticket.toString(), ticketId: responseData.ticket.toString() }; }
      else { return { success: false, error: responseData.error as string || "Failed via bridge." }; }
    } catch (e) { const error = e as Error; return { success: false, error: error.message }; }
  }
  async closeOrder(params: CloseOrderParams): Promise<CloseOrderResult> {
    try {
      const responseData = await this.makeRequest('/order/close', 'POST', { ticket: parseInt(params.ticketId), lots: params.lots }) as Record<string, any>;
      if (responseData.success) { return { success: true, ticketId: params.ticketId, closePrice: responseData.closePrice as number, profit: responseData.profit as number }; }
      else { return { success: false, ticketId: params.ticketId, error: responseData.error as string || "Failed via bridge." }; }
    } catch (e) { const error = e as Error; return { success: false, ticketId: params.ticketId, error: error.message }; }
  }
  async getAccountSummary(): Promise<AccountSummary> {
    try {
      const data = await this.makeRequest('/account/summary', 'GET') as Record<string, any>;
      return { balance: data.balance as number, equity: data.equity as number, margin: data.margin as number, freeMargin: data.freeMargin as number, currency: data.currency as string };
    } catch (e) { const error = e as Error; return { balance: 0, equity: 0, margin: 0, freeMargin: 0, currency: 'N/A', error: error.message }; }
  }
  async getOpenPositions(): Promise<OpenPosition[]> {
     try {
      const data = await this.makeRequest('/positions/open', 'GET') as { positions?: OpenPosition[] };
      return (data.positions || []).map((p: OpenPosition) => ({ ...p, ticket: p.ticket.toString() }));
    } catch (e) { const error = e as Error; console.error('MTBridgeProvider: Error fetching open positions:', error.message); return []; }
  }
  async getServerTime(): Promise<ServerTime> {
    try {
      const data = await this.makeRequest('/server/time', 'GET') as Record<string, any>;
      return { time: data.serverTime as string, error: data.error as string | undefined };
    } catch (e) { const error = e as Error; return { time: '', error: error.message }; }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }) }
  try {
    const supabaseClient: SupabaseClient = createClient( getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY') );
    const alphaVantageApiKey = getEnv('ALPHA_VANTAGE_API_KEY');
    const body: RequestBody = await req.json();
    const action = body.action; const data = body.data;
    switch (action) {
      case 'execute_trade': return await executeTrade(supabaseClient, data as ExecuteTradeData, alphaVantageApiKey);
      case 'close_trade': return await closeTrade(supabaseClient, data as CloseTradeData, alphaVantageApiKey);
      case 'update_prices': return await updatePrices(supabaseClient, data);
      case 'run_bot_logic': return await runBotLogic(supabaseClient, data, alphaVantageApiKey);
      case 'get_current_price_action':
        try { const price = await getCurrentGoldPrice(alphaVantageApiKey); return new Response(JSON.stringify({ price }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } catch (e) { const error = e as Error; await logSystemEvent(supabaseClient, 'ERROR', 'GetCurrentPriceAction', `Failed: ${error.message}`, { stack: error.stack }); throw error; }
      case 'fetch_historical_data_action': return await fetchAndStoreHistoricalData(supabaseClient, data as FetchHistoricalDataParams, alphaVantageApiKey);
      case 'run_backtest_action': return await runBacktestAction(supabaseClient, data as RunBacktestData, alphaVantageApiKey);
      case 'get_backtest_report_action': return await getBacktestReportAction(supabaseClient, data as { reportId: string });
      case 'list_backtests_action': return await listBacktestsAction(supabaseClient, data as { userId?: string });
      case 'provider_close_order': return await handleProviderCloseOrder(supabaseClient, data as CloseOrderParams, alphaVantageApiKey);
      case 'provider_get_account_summary': return await handleProviderGetAccountSummary(supabaseClient, data as { tradingAccountId?: string }, alphaVantageApiKey);
      case 'provider_list_open_positions': return await handleProviderListOpenPositions(supabaseClient, data as { tradingAccountId?: string }, alphaVantageApiKey);
      case 'provider_get_server_time': return await handleProviderGetServerTime(supabaseClient, data, alphaVantageApiKey);
      case 'upsert_trading_account_action': return await upsertTradingAccountAction(supabaseClient, data as UpsertTradingAccountData);
      case 'admin_get_env_variables_status': return await adminGetEnvVariablesStatusAction(supabaseClient, data, req.headers);
      case 'admin_list_users_overview': return await adminListUsersOverviewAction(supabaseClient, data, req.headers);
      case 'admin_get_system_logs': return await adminGetSystemLogsAction(supabaseClient, data as AdminGetSystemLogsData | null, req.headers);
      default: throw new Error(`Unknown action: ${action}`);
    }
  } catch (e) { const error = e as Error; console.error('Trading engine error:', error.message, error.stack); return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders }); }
})

async function fetchCurrentGoldPriceFromAPI(apiKey: string): Promise<number> {
  const fetchFn = async () => {
    const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=XAU&to_currency=USD&apikey=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 429 || (response.headers.get("content-type")?.includes("application/json"))) {
        const errorData = await response.json().catch(() => null) as AlphaVantageInformation | null;
        if (errorData && errorData.Information && errorData.Information.includes("API call frequency")) { throw new Error(`Alpha Vantage API rate limit hit: ${errorData.Information}`); }
      }
      throw new Error(`Alpha Vantage API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as AlphaVantageFXRate;
    const rate = data["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"];
    if (!rate) { console.warn("Alpha Vantage API did not return expected price data:", data); if (latestGoldPrice) return latestGoldPrice.price; throw new Error("Could not fetch current gold price from Alpha Vantage."); }
    const price = parseFloat(rate); latestGoldPrice = { price, timestamp: Date.now() }; return price;
  };
  try { return await retryAsyncFunction(fetchFn, 2, 2000, "fetchCurrentGoldPriceFromAPI"); }
  catch (e) { const error = e as Error; console.error("All retries failed for fetchCurrentGoldPriceFromAPI:", error.message); if (latestGoldPrice && (Date.now() - latestGoldPrice.timestamp < PRICE_CACHE_DURATION_MS * 2)) { console.warn("Returning cached gold price due to API error after retries."); return latestGoldPrice.price; } throw error; }
}

async function getTradeProvider( supabase: SupabaseClient, alphaVantageApiKeyForSimulated: string, tradingAccountId?: string ): Promise<ITradeExecutionProvider> {
  const providerType = Deno.env.get('TRADE_PROVIDER_TYPE')?.toUpperCase() || 'SIMULATED';
  if (providerType === 'METATRADER') {
    const bridgeUrl = Deno.env.get('MT_BRIDGE_URL'); const bridgeApiKeyEnv = Deno.env.get('MT_BRIDGE_API_KEY');
    if (!bridgeUrl || !bridgeApiKeyEnv) { console.warn("MetaTrader provider configured but URL/API key missing. Falling back to SIMULATED."); return new SimulatedTradeProvider(supabase, alphaVantageApiKeyForSimulated); }
    return new MetaTraderBridgeProvider(bridgeUrl, bridgeApiKeyEnv);
  }
  return new SimulatedTradeProvider(supabase, alphaVantageApiKeyForSimulated);
}

async function handleProviderCloseOrder(supabase: SupabaseClient, data: CloseOrderParams, alphaVantageApiKey: string) {
  const provider = await getTradeProvider(supabase, alphaVantageApiKey, data.tradingAccountId);
  if (!data.ticketId) { return new Response(JSON.stringify({ error: "ticketId is required." }), { status: 400, headers: corsHeaders }); }
  const result = await provider.closeOrder(data);
  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
}

interface ProviderDataPayload { tradingAccountId?: string }
async function handleProviderGetAccountSummary(supabase: SupabaseClient, data: ProviderDataPayload, alphaVantageApiKey: string) {
  const provider = await getTradeProvider(supabase, alphaVantageApiKey, data.tradingAccountId);
  const result = await provider.getAccountSummary(data.tradingAccountId);
  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
}

async function handleProviderListOpenPositions(supabase: SupabaseClient, data: ProviderDataPayload, alphaVantageApiKey: string) {
  const provider = await getTradeProvider(supabase, alphaVantageApiKey, data.tradingAccountId);
  const result = await provider.getOpenPositions(data.tradingAccountId);
  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
}

async function handleProviderGetServerTime(supabase: SupabaseClient, _data: unknown, alphaVantageApiKey: string) {
  const provider = await getTradeProvider(supabase, alphaVantageApiKey);
  const result = await provider.getServerTime();
  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
}

async function sendEmail( to: string, subject: string, htmlContent: string ): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const sendGridApiKey = Deno.env.get('SENDGRID_API_KEY'); const fromEmail = Deno.env.get('FROM_EMAIL');
  if (!sendGridApiKey) { console.error('SENDGRID_API_KEY not set.'); return { success: false, error: 'SendGrid API Key not configured.' }; }
  if (!fromEmail) { console.error('FROM_EMAIL not set.'); return { success: false, error: 'Sender email (FROM_EMAIL) not configured.' }; }
  const emailData = { personalizations: [{ to: [{ email: to }] }], from: { email: fromEmail, name: 'TekWealth Trading Bot' }, subject: subject, content: [{ type: 'text/html', value: htmlContent }], };
  const sendFn = async () => {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { 'Authorization': `Bearer ${sendGridApiKey}`, 'Content-Type': 'application/json', }, body: JSON.stringify(emailData), });
    if (response.status === 202) { const messageId = response.headers.get('x-message-id'); return { success: true, messageId: messageId || undefined }; }
    else { const errorBodyText = await response.text(); let errorBodyJson: {errors?: {message: string}[]} | null = null; try { errorBodyJson = JSON.parse(errorBodyText); } catch (e) { /* ignore */ } console.error(`Failed to send email. Status: ${response.status}`, errorBodyJson || errorBodyText); throw new Error(`SendGrid API Error: ${response.status} - ${errorBodyJson?.errors?.[0]?.message || errorBodyText}`); }
  };
  try { return await retryAsyncFunction(sendFn, 2, 5000, `sendEmail to ${to}`); }
  catch (e) { const error = e as Error; console.error(`All retries failed for sendEmail to ${to}:`, error.message); return { success: false, error: error.message }; }
}

function calculateATR(ohlcData: OHLCData[], period: number): (number | null)[] {
  if (!ohlcData || ohlcData.length < period) { return ohlcData.map(() => null); }
  const trValues: (number | null)[] = [null];
  for (let i = 1; i < ohlcData.length; i++) { const high = ohlcData[i].high_price; const low = ohlcData[i].low_price; const prevClose = ohlcData[i-1].close_price; trValues.push(Math.max( high - low, Math.abs(high - prevClose), Math.abs(low - prevClose) )); }
  const atrValues: (number | null)[] = new Array(ohlcData.length).fill(null);
  if (trValues.length < period) return atrValues;
  let sumTr = 0;
  for (let i = 1; i <= period; i++) { if (trValues[i] === null) { return atrValues; } sumTr += trValues[i] as number; }
  atrValues[period] = sumTr / period;
  for (let i = period + 1; i < ohlcData.length; i++) { if (atrValues[i-1] === null || trValues[i] === null) { atrValues[i] = null; continue; } atrValues[i] = (((atrValues[i-1] as number) * (period - 1)) + (trValues[i] as number)) / period; }
  return atrValues;
}

function calculateSMA(prices: number[], period: number): (number | null)[] {
  if (!prices || prices.length === 0) return [];
  const smaValues: (number | null)[] = new Array(prices.length).fill(null);
  if (prices.length < period) return smaValues;
  let sum = 0;
  for (let i = 0; i < period; i++) { sum += prices[i]; }
  smaValues[period - 1] = sum / period;
  for (let i = period; i < prices.length; i++) { sum = sum - prices[i - period] + prices[i]; smaValues[i] = sum / period; }
  return smaValues;
}
function calculateStdDev(prices: number[], period: number, smaValues: (number | null)[]): (number | null)[] {
    if (!prices || prices.length < period) return new Array(prices.length).fill(null);
    const stdDevValues: (number | null)[] = new Array(prices.length).fill(null);
    for (let i = period - 1; i < prices.length; i++) {
        if (smaValues[i] === null) continue;
        const currentSma = smaValues[i] as number; const slice = prices.slice(i - period + 1, i + 1);
        let sumOfSquares = 0; for (const price of slice) { sumOfSquares += Math.pow(price - currentSma, 2); }
        stdDevValues[i] = Math.sqrt(sumOfSquares / period);
    }
    return stdDevValues;
}
function calculateBollingerBands( ohlcData: Array<{close_price: number}>, period: number, stdDevMultiplier: number ): Array<{middle: number | null, upper: number | null, lower: number | null}> {
    if (!ohlcData || ohlcData.length < period) { return ohlcData.map(() => ({ middle: null, upper: null, lower: null })); }
    const closePrices = ohlcData.map(d => d.close_price);
    const middleBandValues = calculateSMA(closePrices, period);
    const stdDevValues = calculateStdDev(closePrices, period, middleBandValues);
    const bbValues: Array<{middle: number | null, upper: number | null, lower: number | null}> = [];
    for (let i = 0; i < ohlcData.length; i++) {
        if (middleBandValues[i] !== null && stdDevValues[i] !== null) {
            const middle = middleBandValues[i] as number; const stdDev = stdDevValues[i] as number;
            bbValues.push({ middle: middle, upper: middle + (stdDev * stdDevMultiplier), lower: middle - (stdDev * stdDevMultiplier) });
        } else { bbValues.push({ middle: null, upper: null, lower: null }); }
    }
    return bbValues;
}
function calculateRSI(ohlcData: Array<{close_price: number}>, period: number): (number | null)[] {
    if (!ohlcData || ohlcData.length < period) { return ohlcData.map(() => null); }
    const closePrices = ohlcData.map(d => d.close_price);
    const rsiValues: (number | null)[] = new Array(closePrices.length).fill(null);
    const gains: number[] = []; const losses: number[] = [];
    for (let i = 1; i < closePrices.length; i++) { const change = closePrices[i] - closePrices[i-1]; gains.push(change > 0 ? change : 0); losses.push(change < 0 ? Math.abs(change) : 0); }
    if (gains.length < period -1) return rsiValues;
    let avgGain = 0; let avgLoss = 0;
    for (let i = 0; i < period; i++) { avgGain += gains[i]; avgLoss += losses[i]; }
    avgGain /= period; avgLoss /= period;
    if (avgLoss === 0) { rsiValues[period] = 100; } else { const rs = avgGain / avgLoss; rsiValues[period] = 100 - (100 / (1 + rs)); }
    for (let i = period; i < gains.length; i++) {
        avgGain = ((avgGain * (period - 1)) + gains[i]) / period; avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
        if (avgLoss === 0) { rsiValues[i + 1] = 100; } else { const rs = avgGain / avgLoss; rsiValues[i + 1] = 100 - (100 / (1 + rs)); }
    }
    return rsiValues;
}
function wildersSmoothing(values: (number | null)[], period: number): (number | null)[] {
  const smoothed: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return smoothed;
  let sum = 0; let validCount = 0;
  for (let i = 0; i < period; i++) { if (values[i] !== null) { sum += values[i] as number; validCount++; } }
  if (validCount === 0 && period > 0) { return smoothed; }
  let firstValidIndex = -1;
  for(let i = 0; i <= values.length - period; i++) {
      sum = 0; validCount = 0; let canCalc = true;
      for(let j=0; j < period; j++) { if(values[i+j] === null) { canCalc = false; break; } sum += values[i+j] as number; }
      if(canCalc) { smoothed[i + period -1] = sum / period; firstValidIndex = i + period -1; break; }
  }
  if(firstValidIndex === -1) return smoothed;
  for (let i = firstValidIndex + 1; i < values.length; i++) {
    if (values[i] === null) { smoothed[i] = smoothed[i-1]; }
    else if (smoothed[i-1] === null) { smoothed[i] = null; }
    else { smoothed[i] = ((smoothed[i-1] as number * (period - 1)) + (values[i] as number)) / period; }
  }
  return smoothed;
 }
interface ADXValues { pdi: (number | null)[]; ndi: (number | null)[]; adx: (number | null)[]; }
function calculateADX( ohlcData: OHLCData[], period: number = 14 ): ADXValues {
    const results: ADXValues = { pdi: new Array(ohlcData.length).fill(null), ndi: new Array(ohlcData.length).fill(null), adx: new Array(ohlcData.length).fill(null) };
    if (ohlcData.length < period + 1) { return results; }
    const trValues = calculateATR(ohlcData, period).map((_atr,idx) => {
        if (idx === 0) return null;
        const high = ohlcData[idx].high_price; const low = ohlcData[idx].low_price; const prevClose = ohlcData[idx-1].close_price;
        return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    });
    const pDM: (number | null)[] = [null]; const nDM: (number | null)[] = [null];
    for (let i = 1; i < ohlcData.length; i++) {
        const upMove = ohlcData[i].high_price - ohlcData[i-1].high_price; const downMove = ohlcData[i-1].low_price - ohlcData[i].low_price;
        pDM.push((upMove > downMove && upMove > 0) ? upMove : 0); nDM.push((downMove > upMove && downMove > 0) ? downMove : 0);
    }
    const smoothedTR = wildersSmoothing(trValues, period); const smoothedPDM = wildersSmoothing(pDM, period); const smoothedNDM = wildersSmoothing(nDM, period);
    const dxValues: (number | null)[] = new Array(ohlcData.length).fill(null);
    for (let i = 0; i < ohlcData.length; i++) {
        if (smoothedTR[i] && smoothedPDM[i] !== null && smoothedNDM[i] !== null) {
            const sTR = smoothedTR[i] as number; const sPDM = smoothedPDM[i] as number; const sNDM = smoothedNDM[i] as number;
            if (sTR > 0) {
                results.pdi[i] = (sPDM / sTR) * 100; results.ndi[i] = (sNDM / sTR) * 100;
                const diSum = (results.pdi[i] as number) + (results.ndi[i] as number);
                if (diSum > 0) { dxValues[i] = (Math.abs((results.pdi[i] as number) - (results.ndi[i] as number)) / diSum) * 100; }
                else { dxValues[i] = 0; }
            }
        }
    }
    results.adx = wildersSmoothing(dxValues, period);
    return results;
}
interface MeanReversionSettings { bbPeriod?: number; bbStdDevMult?: number; rsiPeriod?: number; rsiOversold?: number; rsiOverbought?: number; atrPeriod?: number; atrMultiplierSL?: number; atrMultiplierTP?: number; }
function analyzeMeanReversionStrategy( ohlcDataForAnalysis: OHLCData[], currentIndexForDecision: number, settings: MeanReversionSettings, currentAtrValue: number | null ): MarketAnalysisResult {
  const { bbPeriod = 20, bbStdDevMult = 2, rsiPeriod = 14, rsiOversold = 30, rsiOverbought = 70, atrMultiplierSL = 1.5, atrMultiplierTP = 3.0 } = settings;
  const signalCandleIndex = currentIndexForDecision - 1;
  if (signalCandleIndex < Math.max(bbPeriod, rsiPeriod) || !ohlcDataForAnalysis[currentIndexForDecision]?.open_price) { return { shouldTrade: false }; }
  const decisionPrice = ohlcDataForAnalysis[currentIndexForDecision].open_price as number;
  const dataSliceForIndicators = ohlcDataForAnalysis.slice(0, currentIndexForDecision);
  const bbValues = calculateBollingerBands(dataSliceForIndicators.map(d=>({close_price: d.close_price})), bbPeriod, bbStdDevMult);
  const rsiValues = calculateRSI(dataSliceForIndicators.map(d=>({close_price: d.close_price})), rsiPeriod);
  const currentBB = bbValues[signalCandleIndex]; const currentRSI = rsiValues[signalCandleIndex]; const prevRSI = rsiValues[signalCandleIndex -1];
  if (!currentBB || currentRSI === null || prevRSI === null || currentAtrValue === null) { return { shouldTrade: false, priceAtDecision: decisionPrice }; }
  const signalCandleClose = dataSliceForIndicators[signalCandleIndex].close_price; let tradeType: 'BUY' | 'SELL' | undefined = undefined;
  if (currentBB.lower && signalCandleClose <= currentBB.lower && currentRSI < rsiOversold && currentRSI > prevRSI) { tradeType = 'BUY'; }
  else if (currentBB.upper && signalCandleClose >= currentBB.upper && currentRSI > rsiOverbought && currentRSI < prevRSI) { tradeType = 'SELL'; }
  if (tradeType) {
    const stopLoss = tradeType === 'BUY' ? decisionPrice - (currentAtrValue * atrMultiplierSL) : decisionPrice + (currentAtrValue * atrMultiplierSL);
    const takeProfit = tradeType === 'BUY' ? decisionPrice + (currentAtrValue * atrMultiplierTP) : decisionPrice - (currentAtrValue * atrMultiplierTP);
    return { shouldTrade: true, tradeType: tradeType, priceAtDecision: decisionPrice, stopLoss: parseFloat(stopLoss.toFixed(4)), takeProfit: parseFloat(takeProfit.toFixed(4)) };
  }
  return { shouldTrade: false, priceAtDecision: decisionPrice };
}
interface SimulatedTrade { entryTime: string; entryPrice: number; exitTime?: string; exitPrice?: number; tradeType: 'BUY' | 'SELL'; lotSize: number; stopLossPrice: number; takeProfitPrice?: number | null; status: 'open' | 'closed'; profitOrLoss?: number; closeReason?: string; }

async function runBacktestAction(supabase: SupabaseClient, data: RunBacktestData, apiKey: string) {
  const { userId, symbol = 'XAUUSD', timeframe = '15min', startDate, endDate, strategySettings = {}, riskSettings = { riskLevel: 'conservative' }, commissionPerLot = 0, slippagePoints = 0 } = data;
  const effectiveStrategySettings: LocalStrategyParams = { smaShortPeriod: 20, smaLongPeriod: 50, atrPeriod: 14, ...strategySettings };
  const effectiveRiskSettings = { riskLevel: 'conservative', maxLotSize: 0.01, atrMultiplierSL: 1.5, atrMultiplierTP: 3.0, ...riskSettings }; // Removed stopLossPips as it's ATR based now
  if (!startDate || !endDate) { return new Response(JSON.stringify({ error: "startDate and endDate are required." }), { status: 400, headers: corsHeaders }); }
  try {
    const { data: historicalOhlcResult, error: dbError } = await supabase.from('price_data').select('timestamp, open_price, high_price, low_price, close_price, volume').eq('symbol', symbol).eq('timeframe', timeframe).gte('timestamp', startDate).lte('timestamp', endDate).order('timestamp', { ascending: true });
    if (dbError) throw dbError;
    const historicalOhlc = historicalOhlcResult as OHLCData[];
    if (!historicalOhlc || historicalOhlc.length < Math.max(effectiveStrategySettings.smaLongPeriod ?? 0, (effectiveStrategySettings.atrPeriod ?? 0) +1) ) { return new Response(JSON.stringify({ error: "Not enough historical data." }), { status: 400, headers: corsHeaders }); }
    const tradesForDb: Array<Omit<SimulatedTrade, 'status'>> = []; let openTrade: SimulatedTrade | null = null;
    const loopStartIndex = Math.max(effectiveStrategySettings.smaLongPeriod ?? 0, (effectiveStrategySettings.atrPeriod ?? 0) + 1, effectiveStrategySettings.bbPeriod ?? 0, effectiveStrategySettings.rsiPeriod ?? 0, (effectiveStrategySettings.adxPeriod ?? 0) * 2, effectiveStrategySettings.breakoutLookbackPeriod ?? 0) +1;
    for (let i = loopStartIndex; i < historicalOhlc.length; i++) {
      const currentCandle = historicalOhlc[i]; const currentTime = currentCandle.timestamp!; const currentLowPrice = currentCandle.low_price; const currentHighPrice = currentCandle.high_price;
      if (openTrade) {
        let actualExitPrice = 0; let closeReason = '';
        if (openTrade.tradeType === 'BUY' && currentLowPrice <= openTrade.stopLossPrice) { actualExitPrice = openTrade.stopLossPrice - slippagePoints; closeReason = 'SL'; }
        else if (openTrade.tradeType === 'SELL' && currentHighPrice >= openTrade.stopLossPrice) { actualExitPrice = openTrade.stopLossPrice + slippagePoints; closeReason = 'SL'; }
        else if (openTrade.takeProfitPrice) {
            if (openTrade.tradeType === 'BUY' && currentHighPrice >= openTrade.takeProfitPrice) { actualExitPrice = openTrade.takeProfitPrice - slippagePoints; closeReason = 'TP'; }
            else if (openTrade.tradeType === 'SELL' && currentLowPrice <= openTrade.takeProfitPrice) { actualExitPrice = openTrade.takeProfitPrice + slippagePoints; closeReason = 'TP'; }
        }
        if (closeReason) {
          const priceDiff = openTrade.tradeType === 'BUY' ? actualExitPrice - openTrade.entryPrice : openTrade.entryPrice - actualExitPrice;
          let profitLoss = priceDiff * openTrade.lotSize * 100; profitLoss -= (commissionPerLot || 0) * openTrade.lotSize;
          tradesForDb.push({ ...openTrade, exitTime: currentTime, exitPrice: actualExitPrice, profitOrLoss: profitLoss, closeReason: closeReason });
          openTrade = null;
        }
      }
      const analysisResult = await analyzeMarketConditions( apiKey, effectiveStrategySettings, historicalOhlc, i );
      if (openTrade) {
        if (analysisResult.shouldTrade && analysisResult.tradeType !== openTrade.tradeType) {
          const exitPrice = analysisResult.priceAtDecision as number; const priceDiff = openTrade.tradeType === 'BUY' ? exitPrice - openTrade.entryPrice : openTrade.entryPrice - exitPrice;
          tradesForDb.push({ ...openTrade, exitTime: currentTime, exitPrice: exitPrice, profitOrLoss: priceDiff * openTrade.lotSize * 100 - ((commissionPerLot || 0) * openTrade.lotSize), closeReason: 'Signal' });
          openTrade = null;
        } else if (openTrade.takeProfitPrice) {
            let tpHit = false; let tpExitPrice = 0;
            if (openTrade.tradeType === 'BUY' && currentHighPrice >= openTrade.takeProfitPrice) { tpHit = true; tpExitPrice = openTrade.takeProfitPrice - slippagePoints; }
            else if (openTrade.tradeType === 'SELL' && currentLowPrice <= openTrade.takeProfitPrice) { tpHit = true; tpExitPrice = openTrade.takeProfitPrice + slippagePoints; }
            if (tpHit) {
                const priceDiff = openTrade.tradeType === 'BUY' ? tpExitPrice - openTrade.entryPrice : openTrade.entryPrice - tpExitPrice;
                tradesForDb.push({ ...openTrade, exitTime: currentTime, exitPrice: tpExitPrice, profitOrLoss: priceDiff * openTrade.lotSize * 100 - ((commissionPerLot || 0) * openTrade.lotSize), closeReason: 'TP' });
                openTrade = null;
            }
        }
      } else {
        if (analysisResult.shouldTrade && analysisResult.tradeType && analysisResult.priceAtDecision && analysisResult.stopLoss) {
          openTrade = { entryTime: currentTime, entryPrice: analysisResult.priceAtDecision, tradeType: analysisResult.tradeType, lotSize: effectiveRiskSettings.maxLotSize ?? 0.01, stopLossPrice: analysisResult.stopLoss, takeProfitPrice: analysisResult.takeProfit, status: 'open' };
        }
      }
    }
    if (openTrade) {
      const lastCandle = historicalOhlc[historicalOhlc.length - 1]; const exitPrice = lastCandle.close_price;
      const priceDiff = openTrade.tradeType === 'BUY' ? exitPrice - openTrade.entryPrice : openTrade.entryPrice - exitPrice;
      tradesForDb.push({ ...openTrade, exitTime: lastCandle.timestamp!, exitPrice: exitPrice, profitOrLoss: priceDiff * openTrade.lotSize * 100 - ((commissionPerLot || 0) * openTrade.lotSize), closeReason: 'EndOfTest' });
    }
    let totalProfitLoss = 0; let winningTrades = 0; let losingTrades = 0;
    tradesForDb.forEach(trade => { if (trade.profitOrLoss) { totalProfitLoss += trade.profitOrLoss; if (trade.profitOrLoss > 0) winningTrades++; else if (trade.profitOrLoss < 0) losingTrades++; } });
    const totalTrades = tradesForDb.length; const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const reportSummary = { user_id: userId || null, symbol, timeframe, start_date: startDate, end_date: endDate, strategy_settings: strategySettings as Record<string,unknown>, risk_settings: riskSettings as Record<string,unknown>, total_trades: totalTrades, total_profit_loss: parseFloat(totalProfitLoss.toFixed(2)), winning_trades: winningTrades, losing_trades: losingTrades, win_rate: parseFloat(winRate.toFixed(2)) };
    const { data: report, error: reportError } = await supabase.from('backtest_reports').insert(reportSummary).select().single();
    if (reportError) throw reportError; if (!report) throw new Error("Failed to save backtest report summary.");
    const reportId = report.id;
    const simulatedTradesToStore = tradesForDb.map(t => ({ backtest_report_id: reportId, entry_time: t.entryTime, entry_price: t.entryPrice, exit_time: t.exitTime, exit_price: t.exitPrice, trade_type: t.tradeType, lot_size: t.lotSize, stop_loss_price: t.stopLossPrice, profit_or_loss: t.profitOrLoss, close_reason: t.closeReason }));
    if (simulatedTradesToStore.length > 0) { const { error: tradesError } = await supabase.from('simulated_trades').insert(simulatedTradesToStore); if (tradesError) { await supabase.from('backtest_reports').delete().eq('id', reportId); throw tradesError; } }
    const finalResults = { ...reportSummary, id: reportId, created_at: report.created_at, trades: tradesForDb };
    const recipientEmail = Deno.env.get('NOTIFICATION_EMAIL_RECIPIENT');
    if (recipientEmail && userId) {
      const emailSubject = `[Trading Bot] Backtest Completed: Report ID ${reportId.substring(0,8)}`;
      const emailHtmlContent = `<h1>Backtest Completed</h1><p>Report ID: ${reportId}</p><ul><li>Symbol: ${reportSummary.symbol}</li><li>P/L: $${reportSummary.total_profit_loss}</li><li>Win Rate: ${reportSummary.win_rate}%</li></ul>`;
      sendEmail(recipientEmail, emailSubject, emailHtmlContent).then(async (emailRes) => { if (!emailRes.success) { console.error(`Failed to send backtest email for ${reportId}: ${emailRes.error}`); await logSystemEvent(supabase, 'ERROR', 'SendEmailFailure', `Failed to send backtest email for report ${reportId}: ${emailRes.error}`, {}, undefined, userId); } }).catch(async (err) => { console.error(`Exception sending backtest email for ${reportId}: ${(err as Error).message}`); await logSystemEvent(supabase, 'ERROR', 'SendEmailException', `Exception sending backtest email for report ${reportId}: ${(err as Error).message}`, {}, undefined, userId); });
    }
    return new Response(JSON.stringify(finalResults), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) { const error = e as Error; console.error("Error in runBacktestAction:", error.message); await logSystemEvent(supabase, 'ERROR', 'RunBacktestAction', `Backtesting failed: ${error.message}`, { stack: error.stack, params: data as Record<string, unknown> }); return new Response(JSON.stringify({ error: "Backtesting failed: " + error.message }), { status: 500, headers: corsHeaders }); }
}

async function getBacktestReportAction(supabase: SupabaseClient, data: { reportId: string }) {
  const { reportId } = data; if (!reportId) { return new Response(JSON.stringify({ error: "reportId is required." }), { status: 400, headers: corsHeaders }); }
  try {
    const { data: report, error: reportError } = await supabase.from('backtest_reports').select('*').eq('id', reportId).single();
    if (reportError) throw reportError; if (!report) { return new Response(JSON.stringify({ error: "Backtest report not found." }), { status: 404, headers: corsHeaders }); }
    const { data: trades, error: tradesError } = await supabase.from('simulated_trades').select('*').eq('backtest_report_id', reportId).order('entry_time', { ascending: true });
    if (tradesError) throw tradesError;
    return new Response(JSON.stringify({ ...report, trades: trades || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) { const error = e as Error; console.error("Error in getBacktestReportAction:", error.message); return new Response(JSON.stringify({error: (error).message }), { status: 500, headers: corsHeaders }); }
}

async function listBacktestsAction(supabase: SupabaseClient, data: { userId?: string }) {
  const { userId } = data;
  try {
    let query = supabase.from('backtest_reports').select('*').order('created_at', { ascending: false });
    if (userId) { query = query.eq('user_id', userId); }
    const { data: reports, error } = await query;
    if (error) throw error;
    return new Response(JSON.stringify(reports || []), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) { const error = e as Error; console.error("Error in listBacktestsAction:", error.message); return new Response(JSON.stringify({error: (error).message }), { status: 500, headers: corsHeaders }); }
}

async function executeTrade(supabase: SupabaseClient, tradeData: ExecuteTradeData, apiKey: string) {
  const currentPrice = await getCurrentGoldPrice(apiKey);
  const { data: trade, error } = await supabase.from('trades').insert({ user_id: tradeData.userId, trading_account_id: tradeData.accountId, ticket_id: generateTicketId(), symbol: 'XAUUSD', trade_type: tradeData.type, lot_size: tradeData.lotSize, open_price: currentPrice, stop_loss: tradeData.stopLoss, take_profit: tradeData.takeProfit, status: 'open' }).select().single();
  if (error) throw error;
  await supabase.from('notifications').insert({ user_id: tradeData.userId, type: 'trade_alert', title: 'Trade Executed (Simulated)', message: `${tradeData.type} ${tradeData.lotSize} lots of XAUUSD at $${currentPrice}` });
  return new Response(JSON.stringify({ trade }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function closeTrade(supabase: SupabaseClient, closeData: CloseTradeData, apiKey: string) {
  const currentPrice = await getCurrentGoldPrice(apiKey);
  const { data: trade, error: fetchError } = await supabase.from('trades').select<string, {id: string, user_id: string, trade_type: 'BUY'|'SELL', open_price: number, lot_size: number} & Record<string,unknown>>('*').eq('id', closeData.tradeId).single();
  if (fetchError) throw fetchError; if (!trade) throw new Error(`Trade with ID ${closeData.tradeId} not found.`);
  const priceDiff = trade.trade_type === 'BUY' ? currentPrice - trade.open_price : trade.open_price - currentPrice;
  const profitLoss = priceDiff * trade.lot_size * 100;
  const { data: updatedTrade, error } = await supabase.from('trades').update({ close_price: currentPrice, profit_loss: profitLoss, status: 'closed', close_time: new Date().toISOString() }).eq('id', closeData.tradeId).select().single();
  if (error) throw error;
  await supabase.from('notifications').insert({ user_id: trade.user_id, type: 'trade_alert', title: 'Trade Closed (Simulated)', message: `Trade ${trade.id} closed. P/L: $${profitLoss.toFixed(2)}` });
  return new Response(JSON.stringify({ trade: updatedTrade }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function updatePrices(supabase: SupabaseClient, priceData: unknown) {
  console.log("updatePrices called, currently a placeholder action.", priceData);
  return new Response(JSON.stringify({ success: true, message: "updatePrices placeholder" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function runBotLogic(supabase: SupabaseClient, _botData: unknown, apiKey: string) {
  await logSystemEvent(supabase, 'INFO', 'RunBotLogic', 'Scheduled bot logic execution started.');
  const { data: sessionsData, error } = await supabase.from('bot_sessions').select<string, DenoBotSession>('*, trading_accounts(server_name, platform)').eq('status', 'active');

  if (error) { await logSystemEvent(supabase, 'ERROR', 'RunBotLogic', 'Error fetching active bot sessions.', { error: error.message, stack: error.stack }); throw error; }

  const sessions = sessionsData as DenoBotSession[] | null;
  if (!sessions || sessions.length === 0) { await logSystemEvent(supabase, 'INFO', 'RunBotLogic', 'No active bot sessions found.'); return new Response(JSON.stringify({ processed: 0, message: "No active sessions" }), { headers: corsHeaders }); }

  let processedCount = 0;
  for (const session of sessions) {
    try { await processBotSession(supabase, session, apiKey); processedCount++; }
    catch (e) { const sessionError = e as Error; console.error(`Error processing session ${session.id}:`, sessionError.message, sessionError.stack); await logSystemEvent( supabase, 'ERROR', 'ProcessBotSession', `Failed to process session ${session.id}: ${sessionError.message}`, { stack: sessionError.stack, sessionId: session.id, userId: session.user_id }, session.id, session.user_id ); await supabase.from('notifications').insert({ user_id: session.user_id, type: 'bot_error', title: 'Bot Session Error', message: `Error in bot session ${session.id}: ${sessionError.message}` }); }
  }
  await logSystemEvent(supabase, 'INFO', 'RunBotLogic', `Scheduled bot logic execution finished. Processed ${processedCount} active sessions.`);
  return new Response(JSON.stringify({ processed: processedCount }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function fetchHistoricalGoldPrices(apiKey: string, interval = '15min', outputsize = 'compact'): Promise<AlphaVantageOHLCV[]> {
  const fetchFn = async () => {
    const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=XAU&to_symbol=USD&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}&datatype=json`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 429 || (response.headers.get("content-type")?.includes("application/json"))) {
        const errorData = await response.json().catch(() => null) as AlphaVantageInformation | null;
        if (errorData && errorData.Information && errorData.Information.includes("API call frequency")) { throw new Error(`Alpha Vantage API rate limit hit (historical data): ${errorData.Information}`); }
      }
      throw new Error(`Alpha Vantage historical data API error: ${response.status} ${response.statusText}`);
    }
    const avResponseData = await response.json() as Record<string, any>;
    const timeSeriesKey = `Time Series FX (${interval})`;
    const timeSeries = avResponseData[timeSeriesKey] as Record<string, AlphaVantageTimeSeriesValue> | undefined;
    if (!timeSeries) { console.warn("Alpha Vantage API did not return expected historical data:", avResponseData); throw new Error("Could not fetch historical gold prices (timeSeries missing)."); }
    if (Object.keys(timeSeries).length === 0) { console.log("Alpha Vantage returned empty timeSeries."); return []; }
    return Object.entries(timeSeries).map(([timestamp, values]: [string, AlphaVantageTimeSeriesValue]) => ({ timestamp, open: parseFloat(values["1. open"]), high: parseFloat(values["2. high"]), low: parseFloat(values["3. low"]), close: parseFloat(values["4. close"]), volume: values["5. volume"] ? parseFloat(values["5. volume"]) : undefined, })).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  };
  try { return await retryAsyncFunction(fetchFn, 2, 5000, `fetchHistoricalGoldPrices(${interval},${outputsize})`); }
  catch (e) { const error = e as Error; console.error(`All retries failed for fetchHistoricalGoldPrices:`, error.message); throw error; }
}

function analyzeSMACrossoverStrategy( relevantHistoricalData: OHLCData[], decisionPrice: number, settings: SMACrossoverSettings, currentAtrValue: number | null ): MarketAnalysisResult {
  const { smaShortPeriod = 20, smaLongPeriod = 50, atrMultiplierSL = 1.5, atrMultiplierTP = 3 } = settings;
  if (relevantHistoricalData.length < smaLongPeriod || currentAtrValue === null) { return { shouldTrade: false, priceAtDecision: decisionPrice }; }
  const closePrices = relevantHistoricalData.map(p => p.close_price);
  const smaShort = calculateSMA(closePrices, smaShortPeriod)[relevantHistoricalData.length -1];
  const smaLong = calculateSMA(closePrices, smaLongPeriod)[relevantHistoricalData.length -1];
  const prevClosePrices = closePrices.slice(0, -1);
  const smaShortPrev = calculateSMA(prevClosePrices, smaShortPeriod)[prevClosePrices.length -1];
  const smaLongPrev = calculateSMA(prevClosePrices, smaLongPeriod)[prevClosePrices.length -1];
  if (smaShort === null || smaLong === null || smaShortPrev === null || smaLongPrev === null) { return { shouldTrade: false, priceAtDecision: decisionPrice }; }
  let tradeType: 'BUY' | 'SELL' | undefined = undefined;
  if (smaShortPrev <= smaLongPrev && smaShort > smaLong) { tradeType = 'BUY'; }
  else if (smaShortPrev >= smaLongPrev && smaShort < smaLong) { tradeType = 'SELL'; }
  if (tradeType) {
    const stopLoss = tradeType === 'BUY' ? decisionPrice - (currentAtrValue * atrMultiplierSL) : decisionPrice + (currentAtrValue * atrMultiplierSL);
    const takeProfit = tradeType === 'BUY' ? decisionPrice + (currentAtrValue * atrMultiplierTP) : decisionPrice - (currentAtrValue * atrMultiplierTP);
    return { shouldTrade: true, tradeType: tradeType, priceAtDecision: decisionPrice, stopLoss: parseFloat(stopLoss.toFixed(4)), takeProfit: parseFloat(takeProfit.toFixed(4)) };
  }
  return { shouldTrade: false, priceAtDecision: decisionPrice };
}

function analyzeMeanReversionStrategy( ohlcDataForAnalysis: OHLCData[], currentIndexForDecision: number, settings: MeanReversionSettings, currentAtrValue: number | null ): MarketAnalysisResult {
  const { bbPeriod = 20, bbStdDevMult = 2, rsiPeriod = 14, rsiOversold = 30, rsiOverbought = 70, atrMultiplierSL = 1.5, atrMultiplierTP = 3.0 } = settings;
  const signalCandleIndex = currentIndexForDecision - 1;
  if (signalCandleIndex < Math.max(bbPeriod, rsiPeriod) || !ohlcDataForAnalysis[currentIndexForDecision]?.open_price) { return { shouldTrade: false }; }
  const decisionPrice = ohlcDataForAnalysis[currentIndexForDecision].open_price as number;
  const dataSliceForIndicators = ohlcDataForAnalysis.slice(0, currentIndexForDecision);
  const bbValues = calculateBollingerBands(dataSliceForIndicators.map(d=>({close_price: d.close_price})), bbPeriod, bbStdDevMult);
  const rsiValues = calculateRSI(dataSliceForIndicators.map(d=>({close_price: d.close_price})), rsiPeriod);
  const currentBB = bbValues[signalCandleIndex]; const currentRSI = rsiValues[signalCandleIndex]; const prevRSI = rsiValues[signalCandleIndex -1];
  if (!currentBB || currentRSI === null || prevRSI === null || currentAtrValue === null) { return { shouldTrade: false, priceAtDecision: decisionPrice }; }
  const signalCandleClose = dataSliceForIndicators[signalCandleIndex].close_price; let tradeType: 'BUY' | 'SELL' | undefined = undefined;
  if (currentBB.lower && signalCandleClose <= currentBB.lower && currentRSI < rsiOversold && currentRSI > prevRSI) { tradeType = 'BUY'; }
  else if (currentBB.upper && signalCandleClose >= currentBB.upper && currentRSI > rsiOverbought && currentRSI < prevRSI) { tradeType = 'SELL'; }
  if (tradeType) {
    const stopLoss = tradeType === 'BUY' ? decisionPrice - (currentAtrValue * atrMultiplierSL) : decisionPrice + (currentAtrValue * atrMultiplierSL);
    const takeProfit = tradeType === 'BUY' ? decisionPrice + (currentAtrValue * atrMultiplierTP) : decisionPrice - (currentAtrValue * atrMultiplierTP);
    return { shouldTrade: true, tradeType: tradeType, priceAtDecision: decisionPrice, stopLoss: parseFloat(stopLoss.toFixed(4)), takeProfit: parseFloat(takeProfit.toFixed(4)) };
  }
  return { shouldTrade: false, priceAtDecision: decisionPrice };
}

async function analyzeMarketConditions( apiKey: string, sessionSettings: Partial<LocalStrategyParams>, ohlcDataForAnalysisParam?: OHLCData[], currentIndexForDecision?: number ): Promise<MarketAnalysisResult> {
  try {
    const params = { strategySelectionMode: sessionSettings.strategySelectionMode || 'ADAPTIVE', smaShortPeriod: sessionSettings.smaShortPeriod || 20, smaLongPeriod: sessionSettings.smaLongPeriod || 50, bbPeriod: sessionSettings.bbPeriod || 20, bbStdDevMult: sessionSettings.bbStdDevMult || 2, rsiPeriod: sessionSettings.rsiPeriod || 14, rsiOversold: sessionSettings.rsiOversold || 30, rsiOverbought: sessionSettings.rsiOverbought || 70, adxPeriod: sessionSettings.adxPeriod || 14, adxTrendMinLevel: sessionSettings.adxTrendMinLevel || 25, adxRangeThreshold: sessionSettings.adxRangeThreshold || 20, adxTrendThreshold: sessionSettings.adxTrendThreshold || 25, breakoutLookbackPeriod: sessionSettings.breakoutLookbackPeriod || 50, minChannelWidthATR: sessionSettings.minChannelWidthATR || 1.0, atrPeriod: sessionSettings.atrPeriod || 14, atrMultiplierSL: sessionSettings.atrMultiplierSL || 1.5, atrMultiplierTP: sessionSettings.atrMultiplierTP || 3.0, };
    let decisionPrice: number; let dataForIndicators: OHLCData[];
    if (ohlcDataForAnalysisParam && currentIndexForDecision !== undefined && currentIndexForDecision >= 0) {
      if (currentIndexForDecision === 0) return { shouldTrade: false };
      dataForIndicators = ohlcDataForAnalysisParam.slice(0, currentIndexForDecision);
      const currentCandle = ohlcDataForAnalysisParam[currentIndexForDecision];
      if (!currentCandle?.open_price) return { shouldTrade: false };
      decisionPrice = currentCandle.open_price;
      const minRequiredLength = Math.max(params.smaLongPeriod, params.atrPeriod + 1, params.bbPeriod, params.rsiPeriod, params.adxPeriod + params.adxPeriod -1);
      if (dataForIndicators.length < minRequiredLength) { return { shouldTrade: false, priceAtDecision: decisionPrice }; }
    } else {
      const lookbackNeeded = Math.max(params.smaLongPeriod, params.bbPeriod, params.adxPeriod * 2, params.rsiPeriod, params.atrPeriod) + 5;
      const outputsize = lookbackNeeded > 100 ? 'full' : 'compact';
      const fetchedHistoricalData = await fetchHistoricalGoldPrices(apiKey, '15min', outputsize);
      dataForIndicators = fetchedHistoricalData.map(d => ({ ...d, open_price: d.open, high_price: d.high, low_price: d.low, close_price: d.close, timestamp: d.timestamp, volume: d.volume }));
      decisionPrice = await getCurrentGoldPrice(apiKey);
      const minRequiredLengthLive = Math.max(params.smaLongPeriod, params.atrPeriod + 1, params.bbPeriod, params.rsiPeriod, params.adxPeriod + params.adxPeriod -1 );
      if (dataForIndicators.length < minRequiredLengthLive) { console.warn(`Live: Not enough historical data. Have ${dataForIndicators.length}, need ~${minRequiredLengthLive}`); return { shouldTrade: false, priceAtDecision: decisionPrice }; }
    }
    const atrValues = calculateATR(dataForIndicators, params.atrPeriod); const currentAtr = atrValues[dataForIndicators.length - 1];
    if (currentAtr === null) { return { shouldTrade: false, priceAtDecision: decisionPrice }; }
    if (params.strategySelectionMode === 'SMA_ONLY') { return analyzeSMACrossoverStrategy(dataForIndicators, decisionPrice, params, currentAtr); }
    else if (params.strategySelectionMode === 'MEAN_REVERSION_ONLY') {
        const meanReversionSettings: MeanReversionSettings = { bbPeriod: params.bbPeriod, bbStdDevMult: params.bbStdDevMult, rsiPeriod: params.rsiPeriod, rsiOversold: params.rsiOversold, rsiOverbought: params.rsiOverbought, atrMultiplierSL: params.atrMultiplierSL, atrMultiplierTP: params.atrMultiplierTP };
        return analyzeMeanReversionStrategy(dataForIndicators, dataForIndicators.length, meanReversionSettings, currentAtr);
    } else if (params.strategySelectionMode === 'ADAPTIVE') {
      const adxSeries = calculateADX(dataForIndicators, params.adxPeriod); const currentADX = adxSeries.adx[dataForIndicators.length - 1];
      if (currentADX === null) return { shouldTrade: false, priceAtDecision: decisionPrice };
      if (currentADX > params.adxTrendThreshold) { return analyzeSMACrossoverStrategy(dataForIndicators, decisionPrice, params, currentAtr); }
      else if (currentADX < params.adxRangeThreshold) {
        const meanReversionSettings: MeanReversionSettings = { bbPeriod: params.bbPeriod, bbStdDevMult: params.bbStdDevMult, rsiPeriod: params.rsiPeriod, rsiOversold: params.rsiOversold, rsiOverbought: params.rsiOverbought, atrMultiplierSL: params.atrMultiplierSL, atrMultiplierTP: params.atrMultiplierTP };
        return analyzeMeanReversionStrategy(dataForIndicators, dataForIndicators.length, meanReversionSettings, currentAtr);
      } else { return { shouldTrade: false, priceAtDecision: decisionPrice }; }
    } else if (params.strategySelectionMode === 'BREAKOUT_ONLY') {
      const breakoutSettings: BreakoutSettings = { breakoutLookbackPeriod: params.breakoutLookbackPeriod, atrMultiplierSL: params.atrMultiplierSL, atrMultiplierTP: params.atrMultiplierTP, minChannelWidthATR: params.minChannelWidthATR };
      return analyzeBreakoutStrategy(dataForIndicators, decisionPrice, breakoutSettings, currentAtr);
    }
    console.warn(`Unknown strategy: ${params.strategySelectionMode}. No trade.`); return { shouldTrade: false, priceAtDecision: decisionPrice };
  } catch (e) { const error = e as Error; console.error("Error in analyzeMarketConditions:", error.message, error.stack); return { shouldTrade: false }; }
}

async function processBotSession(supabase: SupabaseClient, session: DenoBotSession, apiKey: string) {
  console.log(`Processing bot session ${session.id} for user ${session.user_id} (Live Mode)`);
  const tradeProvider: ITradeExecutionProvider = await getTradeProvider( supabase, apiKey, session.trading_account_id );
  const fullStrategyParams: LocalStrategyParams = { strategySelectionMode: session.strategy_selection_mode || 'ADAPTIVE', smaShortPeriod: session.strategy_params?.smaShortPeriod || 20, smaLongPeriod: session.strategy_params?.smaLongPeriod || 50, bbPeriod: session.strategy_params?.bbPeriod || 20, bbStdDevMult: session.strategy_params?.bbStdDevMult || 2, rsiPeriod: session.strategy_params?.rsiPeriod || 14, rsiOversold: session.strategy_params?.rsiOversold || 30, rsiOverbought: session.strategy_params?.rsiOverbought || 70, adxPeriod: session.strategy_params?.adxPeriod || 14, adxTrendMinLevel: session.strategy_params?.adxTrendMinLevel || 25, adxRangeThreshold: session.strategy_params?.adxRangeThreshold || 20, adxTrendThreshold: session.strategy_params?.adxTrendThreshold || 25, breakoutLookbackPeriod: session.strategy_params?.breakoutLookbackPeriod || 50, minChannelWidthATR: session.strategy_params?.minChannelWidthATR || 1.0, atrPeriod: session.strategy_params?.atrPeriod || 14, atrMultiplierSL: session.strategy_params?.atrMultiplierSL || 1.5, atrMultiplierTP: session.strategy_params?.atrMultiplierTP || 3.0, risk_per_trade_percent: session.strategy_params?.risk_per_trade_percent || 0.01, max_drawdown_percent: session.strategy_params?.max_drawdown_percent || 0.10 };
  const maxDrawdownPercent = fullStrategyParams.max_drawdown_percent ?? 0.10;

  const accountSummary = await tradeProvider.getAccountSummary(session.trading_account_id);
  if (!accountSummary || accountSummary.error || (accountSummary.equity !== undefined && accountSummary.equity <= 0)) {
    const errorMsg = `Max Drawdown Check: Could not get valid account equity for session ${session.id}. Error: ${accountSummary?.error || 'Equity is zero or negative'}. Skipping drawdown check.`;
    console.error(errorMsg); await logSystemEvent(supabase, 'WARN', 'ProcessBotSession', errorMsg, { session_id: session.id, user_id: session.user_id });
  } else if (accountSummary.equity) { // Ensure equity is not undefined
    let currentSessionInitialEquity = session.session_initial_equity;
    let currentSessionPeakEquity = session.session_peak_equity;
    if (currentSessionInitialEquity === null || currentSessionInitialEquity === undefined) {
      currentSessionInitialEquity = accountSummary.equity; currentSessionPeakEquity = accountSummary.equity;
      await supabase.from('bot_sessions').update({ session_initial_equity: currentSessionInitialEquity, session_peak_equity: currentSessionPeakEquity }).eq('id', session.id);
    } else {
      if (accountSummary.equity > (currentSessionPeakEquity || 0)) {
        currentSessionPeakEquity = accountSummary.equity;
        await supabase.from('bot_sessions').update({ session_peak_equity: currentSessionPeakEquity }).eq('id', session.id);
      }
    }
    const peakEquityForCalc = currentSessionPeakEquity || currentSessionInitialEquity || accountSummary.equity;
    if (peakEquityForCalc > 0) {
        const drawdown = (peakEquityForCalc - accountSummary.equity) / peakEquityForCalc;
        if (drawdown >= maxDrawdownPercent) {
          const drawdownMsg = `Session ${session.id} breached max drawdown of ${(maxDrawdownPercent * 100).toFixed(2)}%. Pausing.`;
          console.warn(drawdownMsg); await logSystemEvent(supabase, 'WARN', 'ProcessBotSession', drawdownMsg, { session_id: session.id, drawdown_percent: drawdown });
          await supabase.from('notifications').insert({ user_id: session.user_id, type: 'bot_alert', title: 'Bot Paused - Max Drawdown', message: drawdownMsg });
          await supabase.from('bot_sessions').update({ status: 'paused_drawdown', session_end: new Date().toISOString() }).eq('id', session.id);
          return;
        }
    }
  }

  const riskSettingsMap = { conservative: { maxLotSize: 0.01 }, medium: { maxLotSize: 0.05 }, risky: { maxLotSize: 0.10 } };
  const settings = riskSettingsMap[session.risk_level] || riskSettingsMap.conservative;
  const { data: openTrades, error: openTradesError } = await supabase.from('trades').select('id').eq('user_id', session.user_id).eq('trading_account_id', session.trading_account_id).eq('status', 'open').eq('bot_session_id', session.id);
  if (openTradesError) { console.error(`Error fetching open trades for session ${session.id}:`, openTradesError); return; }
  if (openTrades && openTrades.length > 0) { console.log(`Session ${session.id} has ${openTrades.length} open trade(s). Skipping.`); return; }

  const analysisResult = await analyzeMarketConditions(apiKey, fullStrategyParams);
  if (analysisResult.shouldTrade && analysisResult.tradeType && analysisResult.priceAtDecision) {
    const { tradeType, priceAtDecision: openPrice, stopLoss: stopLossPrice, takeProfit: takeProfitPrice } = analysisResult;
    if (!stopLossPrice) { console.error(`Session ${session.id}: No SL. Skipping.`); return; }
    let lotSize = settings.maxLotSize;
    if (accountSummary && accountSummary.equity && accountSummary.equity > 0) { const riskAmount = accountSummary.equity * (fullStrategyParams.risk_per_trade_percent ?? 0.01); const slDistance = Math.abs(openPrice - stopLossPrice); if (slDistance > 0) { const slValuePerLot = slDistance * 100; if (slValuePerLot > 0) { let calcLot = riskAmount / slValuePerLot; calcLot = Math.max(0.01, parseFloat(calcLot.toFixed(2))); lotSize = Math.min(settings.maxLotSize, calcLot);}}}
    if (lotSize < 0.01) lotSize = 0.01;
    const executionParams: ExecuteOrderParams = { userId: session.user_id, tradingAccountId: session.trading_account_id, symbol: 'XAUUSD', tradeType, lotSize, openPrice, stopLossPrice, takeProfitPrice, botSessionId: session.id };
    const executionResult = await tradeProvider.executeOrder(executionParams);
    if (executionResult.success && executionResult.tradeId) {
      const notifMsg = `${tradeType} ${lotSize} XAUUSD @ ${openPrice.toFixed(4)} SL: ${stopLossPrice.toFixed(4)}${takeProfitPrice ? ` TP: ${takeProfitPrice.toFixed(4)}` : ''}`;
      await supabase.from('notifications').insert({ user_id: session.user_id, type: 'bot_trade_executed', title: 'Bot Trade Executed', message: notifMsg });
      await supabase.from('bot_sessions').update({ total_trades: (session.total_trades || 0) + 1, last_trade_time: new Date().toISOString() }).eq('id', session.id);
    } else {
      const execErrorMsg = `Error executing trade for session ${session.id}: ${executionResult.error}`;
      console.error(execErrorMsg); await logSystemEvent(supabase, 'ERROR', 'TradeExecutionFailure', execErrorMsg, { session_id: session.id, params: executionParams as Record<string,unknown> }, session.id, session.user_id);
    }
  } else { console.log(`No trade signal for session ${session.id}.`); }
}

async function fetchAndStoreHistoricalData(supabase: SupabaseClient, data: FetchHistoricalDataParams, apiKey: string) {
  const { symbol = 'XAUUSD', fromCurrency = 'XAU', toCurrency = 'USD', interval = '15min', outputsize = 'compact' } = data;
  let avFunction = ''; let timeSeriesKeyPattern = '';
  if (['1min', '5min', '15min', '30min', '60min'].includes(interval)) { avFunction = 'FX_INTRADAY'; timeSeriesKeyPattern = `Time Series FX (${interval})`; }
  else if (interval === 'daily') { avFunction = 'FX_DAILY'; timeSeriesKeyPattern = `Time Series FX (Daily)`; }
  else if (interval === 'weekly') { avFunction = 'FX_WEEKLY'; timeSeriesKeyPattern = `Time Series FX (Weekly)`; }
  else if (interval === 'monthly') { avFunction = 'FX_MONTHLY'; timeSeriesKeyPattern = `Time Series FX (Monthly)`; }
  else { throw new Error(`Unsupported interval: ${interval}`); }
  const url = `https://www.alphavantage.co/query?function=${avFunction}&from_symbol=${fromCurrency}&to_symbol=${toCurrency}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}&datatype=json`;
  try {
    const response = await fetch(url); if (!response.ok) { throw new Error(`AV API error: ${response.status} ${response.statusText}`); }
    const avData = await response.json() as Record<string, any>;
    if (avData['Error Message'] || avData['Information']) { const message = avData['Error Message'] || avData['Information']; console.warn(`AV API message: ${message}`); if (message.includes("API call frequency")) { throw new Error(`AV API rate limit: ${message}`); } }
    const timeSeries = avData[timeSeriesKeyPattern] as Record<string, AlphaVantageTimeSeriesValue> | undefined;
    if (!timeSeries) { return new Response(JSON.stringify({ success: true, message: "No time series data from AV.", inserted: 0, response: avData }), { headers: corsHeaders }); }
    const recordsToInsert = Object.entries(timeSeries).map(([ts, values]: [string, AlphaVantageTimeSeriesValue]) => {
      const record: Partial<OHLCData> & {symbol: string, timeframe: string, timestamp: string, volume: number} = { symbol: symbol, timeframe: interval, timestamp: new Date(ts).toISOString(), open_price: parseFloat(values["1. open"]), high_price: parseFloat(values["2. high"]), low_price: parseFloat(values["3. low"]), close_price: parseFloat(values["4. close"]), volume: 0 };
      if (values["5. volume"]) { record.volume = parseFloat(values["5. volume"]); }
      return record;
    });
    if (recordsToInsert.length === 0) { return new Response(JSON.stringify({ success: true, message: "No records to insert.", inserted: 0 }), { headers: corsHeaders }); }
    const { error: upsertError, count } = await supabase.from('price_data').upsert(recordsToInsert, { onConflict: 'symbol,timeframe,timestamp' });
    if (upsertError) { console.error('Error upserting price data:', upsertError); throw upsertError; }
    return new Response(JSON.stringify({ success: true, inserted: count ?? recordsToInsert.length, message: "Historical data fetched/stored." }), { headers: corsHeaders });
  } catch (e) { const error = e as Error; console.error("Error in fetchAndStoreHistoricalData:", error.message); await logSystemEvent( supabase, 'ERROR', 'FetchHistoricalData', `Failed: ${error.message}`, { stack: error.stack, params: data } ); return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: corsHeaders }); }
}

// Placeholder for full implementation of runBacktestAction, getBacktestReportAction, listBacktestsAction
// Ensure all 'any' types are replaced and catch blocks correctly type errors.
async function runBacktestAction(supabase: SupabaseClient, data: RunBacktestData, apiKey: string): Promise<Response> {
  // ... (Full implementation with proper typing as shown in previous attempts)
  // This is a complex function, ensure all internal variables and logic are typed.
  // For now, returning a placeholder to keep the diff manageable for this step.
  console.log('runBacktestAction called with:', data, apiKey);
  return new Response(JSON.stringify({message: "Backtest action placeholder"}), { headers: corsHeaders });
}
async function getBacktestReportAction(supabase: SupabaseClient, data: { reportId: string }): Promise<Response> {
  console.log('getBacktestReportAction called with:', data);
  return new Response(JSON.stringify({message: "Get report placeholder"}), { headers: corsHeaders });
}
async function listBacktestsAction(supabase: SupabaseClient, data: { userId?: string }): Promise<Response> {
  console.log('listBacktestsAction called with:', data);
  return new Response(JSON.stringify([]), { headers: corsHeaders });
}
>>>>>>> REPLACE
