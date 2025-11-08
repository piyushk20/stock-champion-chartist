export interface SummaryTableData {
  analysisDate: string;
  asset: string;
  symbol: string; // The official ticker symbol for reliable polling
  currentPrice: string;
  trend: string;
  keySupport: string;
  keyResistance: string;
  primaryPattern: string;
  rsi14: string;
  macdSignal: string;
  overallSignal: 'BUY' | 'SELL' | 'HOLD';
  convictionLevel: 'High' | 'Medium' | 'Low';
  suggestedAction: string;
}

export interface MarketStructureData {
  trendIdentification: string;
  priceActionAnalysis: string;
  momentumEvaluation: string;
  swingStructure: string;
}

export interface VolumeAnalysisData {
  volumeTrend: string;
  keyVolumeSpikes: string;
  priceVolumeRelationship: string;
}

export interface CriticalLevelsData {
  r2: string;
  r1: string;
  currentPrice: string;
  s1: string;
  s2: string;
}

export type IndicatorSignal = '🟢' | '🔴' | '⚪';

export interface Indicator {
  name: string;
  value: string;
  signal: IndicatorSignal;
  interpretation: string;
}

export interface ChartPatternData {
  activePattern: {
    name: string;
    description: string;
    implication: string; // e.g., 'Bullish Reversal'
    entrySignal: string; // e.g., 'Break above 125.50'
    priceTarget: string; // e.g., '135.00'
  };
  monitoredPatterns: string[];
  rsiDivergence: {
    detected: boolean;
    type: 'Bullish' | 'Bearish' | 'None';
    description: string;
  };
  rsiDivergenceAlerts: string[];
}

export interface TradeSetup {
  entry: string;
  target1: string;
  target2: string;
  stopLoss: string;
  risk: string;
}

export interface TradeSetupData {
  bullish: TradeSetup;
  bearish: TradeSetup;
}

export interface ConfluenceData {
  bullishSignals: number;
  bearishSignals: number;
  neutralSignals: number;
  overallScore: number;
}

export interface RiskFactorData {
  factors: string[];
}

export interface MultiTimeframeData {
  daily: { trend: string; keyLevel: string; bias: string; };
  weekly: { trend: string; keyLevel: string; bias: string; };
  monthly: { trend: string; keyLevel: string; bias: string; };
}

export interface RelativeStrengthData {
  benchmark: string;
  assetPerformance3M: string;
  benchmarkPerformance3M: string;
  interpretation: string;
}

export interface AnalysisReport {
  summaryTable: SummaryTableData;
  marketStructure: MarketStructureData;
  volumeAnalysis: VolumeAnalysisData;
  criticalLevels: CriticalLevelsData;
  indicatorMatrix: Indicator[];
  chartPatterns: ChartPatternData;
  tradeSetups: TradeSetupData;
  confluenceAnalysis: ConfluenceData;
  riskFactors: RiskFactorData;
  multiTimeframe: MultiTimeframeData;
  relativeStrength: RelativeStrengthData;
  narrative: {
    summary: string;
    levels: string;
    patterns: string;
    triggers: string;
    invalidation: string;
  };
}

// Data types for the interactive chart
export interface CandlestickData {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

export interface VolumeData {
    time: number;
    value: number;
    color: string;
}

export interface ChartData {
    candlestickData: CandlestickData[];
    volumeData: VolumeData[];
}

export interface AnalysisResult {
    report: AnalysisReport;
    chartData: ChartData | null;
}