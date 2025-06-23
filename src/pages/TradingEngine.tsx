import React, { useState, useEffect, useCallback } from 'react';
import { 
  Cpu, 
  Activity, 
  BarChart3, 
  Settings,
  CheckCircle,
  Zap
} from 'lucide-react';
import { TradingEngineControl } from '../components/TradingEngineControl';
import { MarketDataWidget } from '../components/MarketDataWidget';
import { tradingEngine } from '../services/tradingEngine';
import { supabase } from '../lib/supabase';
// import { Database } from '../types/database'; // Not strictly needed if we don't type supabase results here

type EngineLog = { time: string; level: string; message: string };

export function TradingEnginePage() {
  const [engineStatus, setEngineStatus] = useState(() => tradingEngine.getEngineStatus());
  const [uptime, setUptime] = useState('0s');
  const [tradesToday, setTradesToday] = useState(0);
  const [successRate, setSuccessRate] = useState(0.0);
  const [engineLogs, setEngineLogs] = useState<EngineLog[]>([]);

  const formatUptime = (startTime: Date | null): string => {
    if (!startTime) return '0s';
    const totalSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
    if (totalSeconds < 0) return '0s'; // Clock sync issue safeguard
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let uptimeString = '';
    if (hours > 0) uptimeString += `${hours}h `;
    if (minutes > 0 || hours > 0) uptimeString += `${minutes}m `;
    uptimeString += `${seconds}s`;
    return uptimeString.trim() || '0s';
  };

  const fetchTradesData = useCallback(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    // Trades Executed Today
    const { count: tradesTodayCount, error: tradesTodayError } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayISO);

    if (tradesTodayError) {
      console.error('Error fetching trades today:', tradesTodayError.message);
      // Optionally, use the engine's logger if it's enhanced for UI display
      // tradingEngine.addLog('ERROR', `Supabase: Failed to fetch trades today: ${tradesTodayError.message}`);
    } else {
      setTradesToday(tradesTodayCount || 0);
    }

    // Success Rate (Overall)
    const { data: closedTrades, error: closedTradesError } = await supabase
      .from('trades')
      .select('profit_loss')
      .eq('status', 'closed');

    if (closedTradesError) {
      console.error('Error fetching closed trades:', closedTradesError.message);
      // tradingEngine.addLog('ERROR', `Supabase: Failed to fetch closed trades: ${closedTradesError.message}`);
    } else if (closedTrades && closedTrades.length > 0) {
      const winningTrades = closedTrades.filter(trade => (trade.profit_loss || 0) > 0).length;
      setSuccessRate((winningTrades / closedTrades.length) * 100);
    } else {
      setSuccessRate(0.0);
    }
  }, []);


  useEffect(() => {
    const updateStatusAndUptime = () => {
      const currentStatus = tradingEngine.getEngineStatus();
      setEngineStatus(currentStatus);
      setUptime(formatUptime(currentStatus.engineStartTime));
      setEngineLogs([...currentStatus.logs]);
    };

    updateStatusAndUptime();
    fetchTradesData();

    const statusIntervalId = setInterval(updateStatusAndUptime, 1000);
    const tradesIntervalId = setInterval(fetchTradesData, 30000);

    return () => {
      clearInterval(statusIntervalId);
      clearInterval(tradesIntervalId);
    };
  }, [fetchTradesData]);


  const dynamicEngineMetrics = [
    {
      title: 'Engine Uptime',
      value: engineStatus.running ? uptime : 'Stopped',
      change: engineStatus.running ? 'Active' : '-',
      icon: Activity,
      color: 'green'
    },
    {
      title: 'Trades Executed (Today)',
      value: tradesToday.toString(),
      icon: BarChart3,
      color: 'blue'
    },
    {
      title: 'Success Rate (Overall)',
      value: `${successRate.toFixed(1)}%`,
      icon: CheckCircle,
      color: successRate >= 70 ? 'green' : (successRate >= 40 ? 'yellow' : (tradesToday > 0 || successRate > 0 ? 'blue' : 'blue'))
    },
    {
      title: 'Avg Execution',
      value: '12ms', // Static as per plan
      change: 'Simulated',
      icon: Zap,
      color: 'yellow'
    }
  ];

  const dynamicSystemComponents = [
    {
      name: 'Price Feed',
      status: engineStatus.marketData?.XAUUSD &&
              engineStatus.lastPriceUpdate &&
              (Date.now() - new Date(engineStatus.lastPriceUpdate).getTime() < 5000)
              ? 'online' : 'offline',
      latency: engineStatus.marketData?.XAUUSD ? '~1s' : '-',
      description: 'Simulated real-time market data'
    },
    {
      name: 'Risk Manager',
      status: engineStatus.running ? 'online' : 'offline',
      latency: engineStatus.running ? 'Internal' : '-',
      description: 'Position sizing and risk control'
    },
    {
      name: 'Signal Generator',
      status: engineStatus.running ? 'online' : 'offline',
      latency: engineStatus.running ? 'Internal' : '-',
      description: 'Technical analysis and signals'
    },
    {
      name: 'Order Router',
      status: engineStatus.running ? 'online' : 'offline',
      latency: engineStatus.running ? 'Internal' : '-',
      description: 'Trade execution (simulated)'
    },
    {
      name: 'Database',
      status: 'online',
      latency: 'API',
      description: 'Data persistence (Supabase)'
    },
    {
      name: 'Notification Service',
      status: 'online',
      latency: 'API',
      description: 'User alerts and reporting'
    }
  ];


  return (
    <div className="p-4 md:p-8 bg-gray-950 text-gray-100 min-h-screen">
      <div className="flex items-center gap-3 mb-8">
        <Cpu className="w-8 h-8 text-yellow-400" />
        <div>
          <h1 className="text-3xl font-bold text-white">Trading Engine</h1>
          <p className="text-gray-400">Simulated AI-powered trading system management</p>
        </div>
      </div>

      {/* Engine Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
        {dynamicEngineMetrics.map((metric, index) => {
          const Icon = metric.icon;
          const colorClasses: Record<string, string> = {
            blue: 'from-blue-500 to-blue-600',
            green: 'from-green-500 to-green-600',
            yellow: 'from-yellow-500 to-yellow-600',
            purple: 'from-purple-500 to-purple-600'
          };

          return (
            <div key={index} className="bg-gray-900/70 backdrop-blur-md border border-gray-700/50 rounded-xl p-4 md:p-6 shadow-lg">
              <div className="flex items-center justify-between mb-3 md:mb-4">
                <div className={`w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br ${colorClasses[metric.color] || 'from-gray-500 to-gray-600'} rounded-lg flex items-center justify-center`}>
                  <Icon className="w-5 h-5 md:w-6 md:h-6 text-white" />
                </div>
                {metric.change && (
                  <span className="text-xs md:text-sm font-medium text-gray-400">
                    {metric.change}
                  </span>
                )}
              </div>
              <h3 className="text-xl md:text-2xl font-bold text-white mb-1">{metric.value}</h3>
              <p className="text-xs md:text-sm text-gray-400">{metric.title}</p>
            </div>
          );
        })}
      </div>

      {/* Main Controls and Market Data */}
      <div className="grid lg:grid-cols-2 gap-6 md:gap-8 mb-8">
        <TradingEngineControl />
        <MarketDataWidget />
      </div>

      {/* System Components Status */}
      <div className="bg-gray-900/70 backdrop-blur-md border border-gray-700/50 rounded-xl p-4 md:p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-semibold text-white">System Components</h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {dynamicSystemComponents.map((component, index) => (
            <div key={index} className="p-4 bg-gray-800/60 rounded-lg border border-gray-700/30">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-white text-sm md:text-base">{component.name}</h3>
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    component.status === 'online' ? 'bg-green-400 animate-pulse' : 'bg-red-400'
                  }`}></div>
                  <span className={`text-xs font-medium ${
                    component.status === 'online' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {component.status.toUpperCase()}
                  </span>
                </div>
              </div>
              
              <p className="text-xs md:text-sm text-gray-400 mb-2 h-10 overflow-hidden">{component.description}</p>
              
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Latency</span>
                <span className="text-yellow-400 font-medium">{component.latency}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Engine Logs */}
      <div className="mt-8 bg-gray-900/70 backdrop-blur-md border border-gray-700/50 rounded-xl p-4 md:p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-6">
          <Activity className="w-6 h-6 text-green-400" />
          <h2 className="text-xl font-semibold text-white">Recent Engine Activity</h2>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-800/50">
          {engineLogs.length === 0 && (
            <div className="text-center text-gray-500 py-10">No engine activity logged yet. Start the engine to see logs.</div>
          )}
          {engineLogs.map((log, index) => (
            <div key={index} className={`flex items-start gap-2 md:gap-3 p-2 md:p-3 bg-gray-800/50 rounded-lg font-mono text-xs md:text-sm ${
              log.level === 'ERROR' ? 'border-l-2 border-red-500' :
              log.level === 'WARNING' ? 'border-l-2 border-yellow-500' : ''
            }`}>
              <span className="text-gray-500 whitespace-nowrap">{log.time}</span>
              <span className={`px-1.5 md:px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${
                log.level === 'SUCCESS' ? 'bg-green-500/20 text-green-300' :
                log.level === 'WARNING' ? 'bg-yellow-500/20 text-yellow-300' :
                log.level === 'ERROR' ? 'bg-red-500/20 text-red-300' :
                'bg-blue-500/20 text-blue-300'
              }`}>
                {log.level}
              </span>
              <span className="text-gray-300 flex-1 min-w-0 break-words">{log.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}