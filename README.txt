Summary overview of the TekWealth XAUUSD Bot codebase, including backend functions and UI components, reflecting our latest work:

I. Backend (Supabase Edge Functions - primarily trading-engine/index.ts)

•	Core Logic (processBotSession, run_bot_logic endpoint):
o	Scheduled or manually triggered to run bot logic for active sessions.
o	Retrieves session settings (trading account, risk, strategy mode, strategy params) from bot_sessions table.
o	Selects a ITradeExecutionProvider (SimulatedTradeProvider or MetaTraderBridgeProvider) based on ENV settings or session config.
o	Fetches current market price (XAUUSD) via Alpha Vantage (with caching).
o	Fetches historical price data (XAUUSD, 15min default) from Alpha Vantage for analysis.
o	analyzeMarketConditions (Master Strategy Dispatcher):
	Calculates core indicators: ATR, ADX (+DI, -DI), EMA, Bollinger Bands, RSI.
	Strategy Modules:
	analyzeSMACrossoverStrategy: 20/50 SMA crossover, optional ADX confirmation, ATR-based SL/TP.
	analyzeMeanReversionStrategy: Bollinger Bands + RSI signals, ATR-based SL/TP.
	analyzeBreakoutStrategy: (Foundation exists, indicators calculated, but specific signal logic not fully integrated into dispatcher yet).
	Regime Detection (detectMarketRegime): (Foundation exists - ADX/ATR/BBW/EMA, but specific function not fully integrated yet). Currently, 'ADAPTIVE' mode in analyzeMarketConditions uses ADX levels to switch between SMA and Mean Reversion.
	Generates trading signals (BUY, SELL, HOLD, SL, TP).
o	Executes trades (simulated or real via provider) based on signals and risk settings.
o	Records trades (trades table for simulated, or relies on broker for real).
o	Sends email notifications (via SendGrid) for live trades.
o	Updates bot_sessions with last run time, status, etc.
•	Trade Execution Providers (ITradeExecutionProvider interface):
o	SimulatedTradeProvider: Writes trades to Supabase trades table. Simulates SL/TP hits based on price movement (if checked periodically). Implements all provider interface methods with simulated logic.
o	MetaTraderBridgeProvider: Makes HTTP requests to an external MetaTrader EA bridge API (URL and API key from ENV) to execute/manage trades on MT4/MT5. Implements all provider interface methods.
o	Methods: executeOrder, closeOrder, getAccountSummary, getOpenPositions, getServerTime.
•	Backtesting Engine (run_backtest_action endpoint):
o	Fetches historical price data from price_data table (populated by fetch_historical_data_action).
o	Iterates through data, calling analyzeMarketConditions with specified strategy settings and parameters.
o	Simulates trades, P/L, SL/TP hits.
o	Calculates performance metrics (P/L, win rate, trade counts).
o	Saves backtest reports to backtest_reports table and simulated trades to simulated_trades table.
o	Sends email notification on completion.
•	Data & Utility Actions:
o	get_current_price_action: Returns current XAUUSD price from Alpha Vantage cache/API.
o	fetch_historical_data_action: Fetches historical data from Alpha Vantage and saves/upserts to price_data table.
o	get_backtest_report_action, list_backtests_action: Retrieve backtest results.
o	Provider-specific actions (provider_get_account_summary, etc.): Expose provider methods directly.
•	Supporting Logic:
o	Indicator calculation functions (SMA, EMA, ATR, ADX, RSI, Bollinger Bands, BBW, StdDev).
o	SendGrid email helper.
o	Alpha Vantage API interaction helper.

II. Frontend (React + Vite + TailwindCSS)

•	Core Services (src/services/tradingService.ts):
o	Singleton class acting as a client-side interface to Supabase functions and tables.
o	Manages trading account CRUD (placeholder encryption for password).
o	Manages bot sessions: startBot (with complex strategy params), stopBot, getActiveUserBotSessions.
o	Provider actions: getProviderAccountSummary, listProviderOpenPositions, closeTradeOrderProvider, fetchProviderServerTime.
o	Fetches user trades, notifications (getUserNotifications, markNotificationAsRead).
o	Price data: getCurrentPrice (polls backend), fetchHistoricalData (for backtesting setup).
o	Backtesting: runBacktest (with complex strategy params), getBacktestReport, listBacktests.
o	Defines StrategyParams interface, crucial for bot configuration forms.
•	Main UI Components (src/pages/ & src/components/):
o	App.tsx (Main Layout & Routing - conceptual):
	Handles overall page structure, likely including Navigation.
	Manages routing between Dashboard, Trading Bot, Backtesting, Settings, Auth pages.
o	Navigation.tsx (src/components/):
	Persistent sidebar navigation.
	Links: Dashboard, Trading Bot, Backtesting, Settings (conditional for admin/user).
	Displays app title, user role.
	Includes NotificationBell.tsx for sitewide notifications.
	Logout button.
o	NotificationBell.tsx (src/components/):
	Bell icon in navigation, shows unread notification count.
	Dropdown list of recent notifications (title, message, time).
	Mark as read functionality (individual, all unread).
	Polls for new notifications.
o	UserDashboard.tsx (src/pages/):
	Stats Grid: Displays Account Balance, Today's P&L (from provider summary), Active Positions count (from provider open positions). Win Rate is a placeholder.
	Portfolio Performance Chart: Semi-static placeholder chart; uses live equity if available but not a true historical curve.
	Active Positions List: Dynamically lists open trades from the provider (symbol, type, lots, open price, current price, P&L).
	Fetches data on load and via a "Refresh" button.
	Handles loading states and error messages.
	Balance visibility toggle.
o	TradingBot.tsx (src/pages/):
	Session Management: Lists active bot sessions with details (account, risk, strategy, start time). Allows stopping active sessions.
	Start New Session: Button opens a configuration modal.
	Configuration Modal:
	Select Trading Account, Risk Level.
	Select Strategy Selection Mode: ADAPTIVE, SMA_ONLY, MEAN_REVERSION_ONLY, BREAKOUT_ONLY.
	Dynamically displays input fields for Strategy Parameters based on selected mode (ATR period/multipliers, SMA periods, BB period/stddev, RSI period/levels, ADX period/thresholds, Breakout lookback/ATR spike).
	Submits configuration to tradingService.startBot.
	Live Activity: Shows basic stats (trades today, open positions count) and a list of recent trades (from trades table, mainly for simulated mode).
	Handles loading and error states.
o	BacktestingPage.tsx (src/pages/):
	Form to configure and run backtests:
	Date range, symbol, timeframe.
	Strategy Selection Mode and detailed Strategy Parameters (identical to TradingBot.tsx modal for consistency).
	Risk settings.
	Submits to tradingService.runBacktest.
	Displays list of past backtest reports.
	Shows detailed report for a selected backtest (P/L, win rate, trades, parameters used).
o	Authentication Pages (AuthPage.tsx, SignupPage.tsx, LoginPage.tsx - conceptual, based on typical Supabase auth):
	User login, registration, password reset UI.
o	Settings Page (Conceptual):
	Manage trading accounts (add, view - password handling is placeholder).
	User profile settings.
	Subscription management (if Stripe is fully integrated on UI).
•	Hooks (src/hooks/):
o	useAuth.tsx: Provides user authentication state and context throughout the application.

III. Database (Supabase PostgreSQL)

•	users: Standard Supabase auth users.
•	trading_accounts: Stores user's broker account details (login, server, platform, encrypted password - placeholder encryption).
•	bot_sessions: Configuration for each active or past bot instance (user_id, trading_account_id, risk_level, status, start/end times, strategy_selection_mode, strategy_params as JSONB).
•	trades: Records individual trades, primarily for SimulatedTradeProvider (symbol, type, lots, open/close price, P/L, status, user_id, session_id).
•	price_data: Stores historical OHLCV price data (symbol, timeframe, timestamp, open, high, low, close, volume) for backtesting.
•	backtest_reports: Summary results of backtests (user_id, parameters, P/L, win_rate, etc.).
•	simulated_trades: Detailed trades generated during backtests.
•	notifications: User-specific notifications (trade alerts, system messages, backtest completion).
•	subscriptions: (For Stripe integration) User subscription status, plan type, Stripe IDs.

IV. External Services

•	Alpha Vantage: Primary source for real-time and historical XAUUSD price data.
•	SendGrid: For sending email notifications (trade alerts, backtest completion).
•	Stripe: (Partially integrated) For subscription management.

This overview should cover the main components and their interactions within the codebase as of our latest developments.

