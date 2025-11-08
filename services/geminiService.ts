import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import type { AnalysisReport, AnalysisResult, CandlestickData, VolumeData, ChartData } from '../types';

const GEMINI_API_KEY = process.env.API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error("API_KEY environment variable not set.");
}
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const FINNHUB_API_KEY = 'd4758fhr01qh8nnb7glgd4758fhr01qh8nnb7gm0'; // Finnhub key for fallback

interface MarketDataPayload {
    csv: string;
    chartData: ChartData;
}

// --- UTILITIES ---

const formatPrice = (value: number | string | null | undefined): string => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (typeof num === 'number' && isFinite(num)) return num.toFixed(2);
    return 'N/A';
};

// --- YAHOO FINANCE API FETCHING ---

// Using public CORS proxies as fallbacks for reliability.
const PROXIES = [
    { prefix: 'https://corsproxy.io/?', encode: false },
    { prefix: 'https://cors.eu.org/', encode: false }, // Added for more resilience
    { prefix: 'https://thingproxy.freeboard.io/fetch/', encode: false },
    { prefix: 'https://api.allorigins.win/raw?url=', encode: true }
];

const yahooFinanceFetch = async (url: string) => {
    let lastError: Error | null = null;

    for (const proxy of PROXIES) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30-second timeout

        try {
            const fetchUrl = proxy.encode ? proxy.prefix + encodeURIComponent(url) : proxy.prefix + url;
            const response = await fetch(fetchUrl, {
                signal: controller.signal,
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Yahoo Finance request via ${proxy.prefix} failed with status ${response.status}`);
            }
            const data = await response.json();
            if (data.chart?.error) {
                throw new Error(`Yahoo Finance API error: ${data.chart.error.description}`);
            }
            if (!data.chart?.result) {
                 throw new Error(`Yahoo Finance response via ${proxy.prefix} was empty or malformed.`);
            }
            return data;
        } catch (error) {
            clearTimeout(timeoutId);
            console.warn(`Fetch attempt via ${proxy.prefix} failed:`, error);
            if (error instanceof Error && error.name === 'AbortError') {
                lastError = new Error(`Request timed out. The data provider is not responding.`);
            } else {
                lastError = error as Error;
            }
        }
    }
    throw lastError ?? new Error("All Yahoo Finance fetch attempts failed.");
};

// --- FINNHUB API FETCHING (FALLBACK) ---

// Maps common Yahoo Finance symbols to Finnhub-compatible symbols (often ETFs for reliability on free tier).
const mapSymbolForFinnhub = (symbol: string): string => {
    const mappings: { [key: string]: string } = {
        '^GSPC': 'SPY',
        '^DJI': 'DIA',
        '^NDX': 'QQQ',
        '^FTSE': 'EWU',
        '^GDAXI': 'EWG',
        '^N225': 'EWJ',
        '^HSI': 'EWH',
        '^NSEI': 'INDA',
        'GC=F': 'GLD',
        'SI=F': 'SLV',
        'CL=F': 'USO',
        'NG=F': 'UNG',
        'HG=F': 'CPER',
    };
    if (mappings[symbol]) {
        return mappings[symbol];
    }
    
    return symbol;
};

const fetchMarketDataFromFinnhub = async (symbol: string, timeframe: string): Promise<MarketDataPayload> => {
    if (!FINNHUB_API_KEY) throw new Error("FINNHUB_API_KEY environment variable not set. Cannot use Finnhub as a fallback.");
    
    // Skip Finnhub for Indian stocks (.NS) as the free tier has limited support and often fails.
    if (symbol.endsWith('.NS')) {
        throw new Error("Primary data source failed for Indian stock; Finnhub fallback is not supported for this asset on the current plan.");
    }
    
    const finnhubSymbol = mapSymbolForFinnhub(symbol);
    let resolution: string;
    const to = Math.floor(Date.now() / 1000);
    let from: number;
    const now = new Date();

    switch (timeframe) {
        case 'Intraday': resolution = '15'; from = Math.floor(now.setDate(now.getDate() - 5) / 1000); break;
        case 'Weekly': resolution = 'W'; from = Math.floor(now.setFullYear(now.getFullYear() - 5) / 1000); break;
        case 'Monthly': resolution = 'M'; from = Math.floor(now.setFullYear(now.getFullYear() - 20) / 1000); break;
        default: resolution = 'D'; from = Math.floor(now.setFullYear(now.getFullYear() - 2) / 1000);
    }
    
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${finnhubSymbol}&resolution=${resolution}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Finnhub request for ${finnhubSymbol} failed with status ${response.status}`);
    
    const data = await response.json();
    if (data.s === 'no_data' || !data.t || data.t.length === 0) throw new Error(`Could not find time series data for '${finnhubSymbol}' in Finnhub response.`);

    const { t, o, h, l, c, v } = data;
    const header = "Date,Open,High,Low,Close,Volume\n";

    const candlestickData: CandlestickData[] = [];
    const volumeData: VolumeData[] = [];

    const csvRows = t.map((ts: number, i: number) => {
        const date = new Date(ts * 1000).toISOString().split('T')[0];
        
        candlestickData.push({ time: ts, open: o[i], high: h[i], low: l[i], close: c[i] });
        volumeData.push({ time: ts, value: v[i] ?? 0, color: c[i] >= o[i] ? 'rgba(40, 167, 69, 0.5)' : 'rgba(220, 53, 69, 0.5)' });

        return `${date},${o[i].toFixed(2)},${h[i].toFixed(2)},${l[i].toFixed(2)},${c[i].toFixed(2)},${v[i] ?? '0'}`;
    });
    const csv = header + csvRows.join('\n');
    return { csv, chartData: { candlestickData, volumeData } };
};

const fetchLivePriceFromFinnhub = async (symbol: string): Promise<string | null> => {
    if (!FINNHUB_API_KEY) {
        console.warn("FINNHUB_API_KEY not set, cannot fetch live price from Finnhub.");
        return null;
    }

    if (symbol.endsWith('.NS')) {
        // Skip Finnhub for Indian stocks
        return null;
    }

    const finnhubSymbol = mapSymbolForFinnhub(symbol);
    const url = `https://finnhub.io/api/v1/quote?symbol=${finnhubSymbol}&token=${FINNHUB_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Finnhub quote request failed with status ${response.status}`);
    const data = await response.json();
    const price = data?.c;
    if (!price || price === 0) throw new Error(`No live price found for ${symbol} in Finnhub response.`);
    return formatPrice(price);
};

// --- ORCHESTRATORS ---

const fetchLivePriceFromYahoo = async (symbol: string): Promise<string | null> => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
    const data = await yahooFinanceFetch(url);
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (!price) {
        throw new Error(`No live price found for ${symbol} in Yahoo Finance response.`);
    }
    return formatPrice(price);
};

export const fetchLivePrice = async (symbol: string): Promise<string | null> => {
    if (!symbol) return null;
    try {
        return await fetchLivePriceFromYahoo(symbol);
    } catch (yahooError) {
        console.warn(`Failed to fetch live price for ${symbol} from Yahoo Finance. Falling back to Finnhub.`, yahooError);
        try {
            return await fetchLivePriceFromFinnhub(symbol);
        } catch (finnhubError) {
            console.error(`Failed to fetch live price for ${symbol} from Finnhub as well.`, finnhubError);
            return null;
        }
    }
};

const fetchMarketDataFromYahoo = async (symbol: string, timeframe: string): Promise<MarketDataPayload> => {
    let range: string;
    let interval: string;

    switch (timeframe) {
        case 'Intraday': range = '5d'; interval = '15m'; break;
        case 'Weekly': range = '5y'; interval = '1wk'; break;
        case 'Monthly': range = 'max'; interval = '1mo'; break;
        default: range = '2y'; interval = '1d'; // Daily
    }
    
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const data = await yahooFinanceFetch(url);
    
    const result = data?.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators.quote[0].open) {
        throw new Error('Could not find time series data in Yahoo Finance response.');
    }

    const { timestamp, indicators } = result;
    const { open, high, low, close, volume } = indicators.quote[0];
    
    const header = "Date,Open,High,Low,Close,Volume\n";
    const candlestickData: CandlestickData[] = [];
    const volumeData: VolumeData[] = [];

    const csvRows = timestamp.map((ts: number, i: number) => {
        if (ts === null || open[i] === null || high[i] === null || low[i] === null || close[i] === null) {
            return null; // Skip rows with null data points
        }
        
        candlestickData.push({ time: ts, open: open[i], high: high[i], low: low[i], close: close[i] });
        volumeData.push({ time: ts, value: volume[i] ?? 0, color: close[i] >= open[i] ? 'rgba(40, 167, 69, 0.5)' : 'rgba(220, 53, 69, 0.5)' });
        
        const date = new Date(ts * 1000).toISOString().split('T')[0];
        const o = open[i].toFixed(2);
        const h = high[i].toFixed(2);
        const l = low[i].toFixed(2);
        const c = close[i].toFixed(2);
        const v = volume[i] ?? '0';
        return `${date},${o},${h},${l},${c},${v}`;
    }).filter(Boolean);

    const csv = header + csvRows.join('\n');
    return { csv, chartData: { candlestickData, volumeData } };
};

export const fetchMarketData = async (symbol: string, timeframe: string): Promise<MarketDataPayload> => {
    try {
        console.log(`Attempting to fetch market data for '${symbol}' from Yahoo Finance...`);
        return await fetchMarketDataFromYahoo(symbol, timeframe);
    } catch (yahooError) {
        console.warn(`Failed to fetch market data for '${symbol}' from Yahoo Finance.`, yahooError);
        if (!FINNHUB_API_KEY) {
            console.error("FINNHUB_API_KEY not set. Cannot fallback to Finnhub.");
            throw new Error(`Failed to fetch market data for '${symbol}'. The symbol may be invalid or not supported by the data provider.`);
        }
        console.log(`Falling back to Finnhub for '${symbol}'...`);
        try {
            return await fetchMarketDataFromFinnhub(symbol, timeframe);
        } catch (finnhubError) {
            console.error(`Failed to fetch market data for '${symbol}' from Finnhub as well.`, finnhubError);
            throw new Error(`Failed to fetch market data for '${symbol}' from all providers. The symbol may be invalid or providers are down.`);
        }
    }
};


// --- GEMINI ANALYSIS GENERATION ---

const getBenchmarkForSymbol = (symbol: string): { symbol: string; name: string } => {
    if (symbol.endsWith('.NS')) {
        return { symbol: '^NSEI', name: 'NIFTY 50' };
    }
    return { symbol: '^GSPC', name: 'S&P 500' };
};

const calculate3MonthPerformance = (data: any): string | null => {
    const result = data?.chart?.result?.[0];
    if (!result || !result.indicators.quote[0].close) return null;

    const closePrices = result.indicators.quote[0].close.filter((p: number | null) => p !== null && isFinite(p));
    if (closePrices.length < 2) return null;

    const firstClose = closePrices[0];
    const lastClose = closePrices[closePrices.length - 1];
    const performance = ((lastClose - firstClose) / firstClose) * 100;

    return `${performance >= 0 ? '+' : ''}${performance.toFixed(2)}%`;
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    summaryTable: {
      type: Type.OBJECT,
      properties: {
        analysisDate: { type: Type.STRING, description: "Date of analysis (YYYY-MM-DD)." },
        asset: { type: Type.STRING, description: "Name of the asset analyzed." },
        symbol: { type: Type.STRING, description: "The official ticker symbol for the asset, used for API polling." },
        currentPrice: { type: Type.STRING, description: "The most recent price from the provided data." },
        trend: { type: Type.STRING, description: "e.g., 'Bullish', 'Bearish', 'Sideways'." },
        keySupport: { type: Type.STRING, description: "The most critical support level." },
        keyResistance: { type: Type.STRING, description: "The most critical resistance level." },
        primaryPattern: { type: Type.STRING, description: "e.g., 'Rising Wedge', 'Head & Shoulders', 'None'." },
        rsi14: { type: Type.STRING, description: "The 14-period RSI value." },
        macdSignal: { type: Type.STRING, description: "e.g., 'Bullish Crossover', 'Bearish Divergence'." },
        overallSignal: { type: Type.STRING, enum: ['BUY', 'SELL', 'HOLD'] },
        convictionLevel: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
        suggestedAction: { type: Type.STRING, description: "A brief, actionable suggestion. e.g., 'Look for long entries on dips near support.'" },
      },
      required: ['analysisDate', 'asset', 'symbol', 'currentPrice', 'trend', 'keySupport', 'keyResistance', 'primaryPattern', 'rsi14', 'macdSignal', 'overallSignal', 'convictionLevel', 'suggestedAction']
    },
    marketStructure: {
      type: Type.OBJECT,
      properties: {
        trendIdentification: { type: Type.STRING },
        priceActionAnalysis: { type: Type.STRING },
        momentumEvaluation: { type: Type.STRING },
        swingStructure: { type: Type.STRING },
      },
      required: ['trendIdentification', 'priceActionAnalysis', 'momentumEvaluation', 'swingStructure']
    },
    volumeAnalysis: {
      type: Type.OBJECT,
      properties: {
        volumeTrend: { type: Type.STRING, description: "Describe the recent trend in trading volume (e.g., 'Increasing', 'Decreasing', 'Average')." },
        keyVolumeSpikes: { type: Type.STRING, description: "Identify and interpret any significant volume spikes and their context." },
        priceVolumeRelationship: { type: Type.STRING, description: "Analyze how volume confirms or diverges from price action (e.g., 'Volume confirms uptrend')." },
      },
      required: ['volumeTrend', 'keyVolumeSpikes', 'priceVolumeRelationship']
    },
    criticalLevels: {
      type: Type.OBJECT,
      properties: {
        r2: { type: Type.STRING, description: "Second resistance level." },
        r1: { type: Type.STRING, description: "First resistance level." },
        currentPrice: { type: Type.STRING, description: "The most recent price, must match summaryTable." },
        s1: { type: Type.STRING, description: "First support level." },
        s2: { type: Type.STRING, description: "Second support level." },
      },
      required: ['r2', 'r1', 'currentPrice', 's1', 's2']
    },
    indicatorMatrix: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          value: { type: Type.STRING },
          signal: { type: Type.STRING, enum: ['🟢', '🔴', '⚪'], description: "Green for bullish, Red for bearish, White for neutral." },
          interpretation: { type: Type.STRING },
        },
        required: ['name', 'value', 'signal', 'interpretation']
      }
    },
    chartPatterns: {
      type: Type.OBJECT,
      properties: {
        activePattern: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            description: { type: Type.STRING },
            implication: { type: Type.STRING, description: "The pattern's implication (e.g., 'Bullish Reversal', 'Bearish Continuation')." },
            entrySignal: { type: Type.STRING, description: "The specific price action that confirms the pattern (e.g., 'Break and close above 155.50')." },
            priceTarget: { type: Type.STRING, description: "The calculated price target based on the pattern's measured move." },
          },
          required: ['name', 'description', 'implication', 'entrySignal', 'priceTarget']
        },
        monitoredPatterns: { type: Type.ARRAY, items: { type: Type.STRING } },
        rsiDivergence: {
          type: Type.OBJECT,
          properties: {
            detected: { type: Type.BOOLEAN },
            type: { type: Type.STRING, enum: ['Bullish', 'Bearish', 'None'] },
            description: { type: Type.STRING },
          },
          required: ['detected', 'type', 'description']
        },
        rsiDivergenceAlerts: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "A list of specific, concise alerts for any detected RSI divergences (e.g., 'ALERT: Bearish RSI Divergence detected...')."
        }
      },
      required: ['activePattern', 'monitoredPatterns', 'rsiDivergence', 'rsiDivergenceAlerts']
    },
    tradeSetups: {
      type: Type.OBJECT,
      properties: {
        bullish: {
          type: Type.OBJECT,
          properties: { entry: { type: Type.STRING }, target1: { type: Type.STRING }, target2: { type: Type.STRING }, stopLoss: { type: Type.STRING }, risk: { type: Type.STRING } },
          required: ['entry', 'target1', 'target2', 'stopLoss', 'risk']
        },
        bearish: {
          type: Type.OBJECT,
          properties: { entry: { type: Type.STRING }, target1: { type: Type.STRING }, target2: { type: Type.STRING }, stopLoss: { type: Type.STRING }, risk: { type: Type.STRING } },
          required: ['entry', 'target1', 'target2', 'stopLoss', 'risk']
        },
      },
      required: ['bullish', 'bearish']
    },
    confluenceAnalysis: {
        type: Type.OBJECT,
        properties: {
            bullishSignals: { type: Type.NUMBER },
            bearishSignals: { type: Type.NUMBER },
            neutralSignals: { type: Type.NUMBER },
            overallScore: { type: Type.NUMBER, description: "A score from 0-100 indicating overall technical conviction." }
        },
        required: ['bullishSignals', 'bearishSignals', 'neutralSignals', 'overallScore']
    },
    riskFactors: {
        type: Type.OBJECT,
        properties: {
            factors: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['factors']
    },
    multiTimeframe: {
        type: Type.OBJECT,
        properties: {
            daily: {
                type: Type.OBJECT,
                properties: { trend: { type: Type.STRING }, keyLevel: { type: Type.STRING }, bias: { type: Type.STRING } },
                required: ['trend', 'keyLevel', 'bias']
            },
            weekly: {
                type: Type.OBJECT,
                properties: { trend: { type: Type.STRING }, keyLevel: { type: Type.STRING }, bias: { type: Type.STRING } },
                required: ['trend', 'keyLevel', 'bias']
            },
            monthly: {
                type: Type.OBJECT,
                properties: { trend: { type: Type.STRING }, keyLevel: { type: Type.STRING }, bias: { type: Type.STRING } },
                required: ['trend', 'keyLevel', 'bias']
            }
        },
        required: ['daily', 'weekly', 'monthly']
    },
    relativeStrength: {
        type: Type.OBJECT,
        properties: {
          benchmark: { type: Type.STRING, description: "The benchmark index used for comparison (e.g., 'S&P 500')." },
          assetPerformance3M: { type: Type.STRING, description: "The asset's performance over the last 3 months (e.g., '+10.55%')." },
          benchmarkPerformance3M: { type: Type.STRING, description: "The benchmark's performance over the last 3 months (e.g., '+5.20%')." },
          interpretation: { type: Type.STRING, description: "A concise interpretation of the relative strength (e.g., 'The asset is significantly outperforming its benchmark, showing strong market leadership.')." }
        },
        required: ['benchmark', 'assetPerformance3M', 'benchmarkPerformance3M', 'interpretation']
    },
    narrative: {
        type: Type.OBJECT,
        properties: {
            summary: { type: Type.STRING, description: "Overall summary of what the chart is telling us." },
            levels: { type: Type.STRING, description: "Explanation of why certain support/resistance levels are important." },
            patterns: { type: Type.STRING, description: "Description of how key patterns are developing." },
            triggers: { type: Type.STRING, description: "What events or price action could trigger the next significant move." },
            invalidation: { type: Type.STRING, description: "What would invalidate the current primary thesis." }
        },
        required: ['summary', 'levels', 'patterns', 'triggers', 'invalidation']
    }
  },
  required: ['summaryTable', 'marketStructure', 'volumeAnalysis', 'criticalLevels', 'indicatorMatrix', 'chartPatterns', 'tradeSetups', 'confluenceAnalysis', 'riskFactors', 'multiTimeframe', 'relativeStrength', 'narrative']
};

export const getTechnicalAnalysis = async (
  symbol: string,
  image: { mimeType: string; data: string } | null,
  timeframe: string
): Promise<AnalysisResult> => {
  let marketDataPayload: MarketDataPayload | null = null;
  let relativeStrengthText = '';

  if (symbol) {
    marketDataPayload = await fetchMarketData(symbol, timeframe);

    // --- New Relative Strength Logic ---
    try {
        const benchmark = getBenchmarkForSymbol(symbol);
        const benchmarkUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(benchmark.symbol)}?range=3mo&interval=1d`;
        const assetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`;

        const [benchmarkData, assetData] = await Promise.all([
            yahooFinanceFetch(benchmarkUrl),
            yahooFinanceFetch(assetUrl)
        ]);

        const benchmarkPerf = calculate3MonthPerformance(benchmarkData);
        const assetPerf = calculate3MonthPerformance(assetData);

        if (benchmarkPerf && assetPerf) {
            relativeStrengthText = `
Context: Relative Strength Analysis (3-Month Performance):
- This Asset's Performance: ${assetPerf}
- Benchmark Index (${benchmark.name}) Performance: ${benchmarkPerf}
`;
        }
    } catch (error) {
        console.warn("Could not calculate relative strength:", error);
        // Fail silently, it's an enhancement not a core feature.
    }
  }

  const systemInstruction = `You are an expert technical analyst known as the "Champion Chartist." Your analysis is purely data-driven, objective, and modeled on the methodologies of top-tier market technicians. Generate a comprehensive, professional-grade technical analysis report in JSON format based on the provided market data and/or chart image.

Key Directives:
- Adhere strictly to the provided JSON schema. Do not deviate.
- All price values in your response MUST be formatted as strings representing numbers with two decimal places (e.g., "123.45").
- Analyze the data for the specified timeframe (${timeframe}).
- **Relative Strength**: If provided, analyze the 3-month relative strength data. Compare the asset's performance to its benchmark and provide a concise interpretation of its market leadership or weakness.
- **Volume Analysis is critical**: Analyze trading volume. Comment on volume trends, significant spikes and their context, and the relationship between price and volume (e.g., confirming a trend or showing divergence).
- **Actionable Pattern Analysis**: For the primary identified chart pattern, you MUST provide its implication (e.g., 'Bullish Reversal'), a clear entry signal (e.g., 'Break above 125.50'), and a calculated price target. These details should inform the Trade Setup Recommendations.
- **RSI Divergence Alerts**: If you detect a bullish or bearish RSI divergence, you MUST generate a specific, concise alert in the 'rsiDivergenceAlerts' array. Example: "ALERT: Bearish RSI Divergence - Price is making higher highs while the RSI is making lower highs, signaling potential momentum loss." If no divergence is found, this array should be empty.
- If both a symbol and an image are provided, prioritize the most recent data but use the image for pattern and trendline context.
- If only an image is provided, derive all analysis from the visual information in the chart.
- Your narrative must be insightful, concise, and directly actionable for a trader or investor.`;
  
  const textPrompt = `Analyze the following asset. Asset symbol: ${symbol || 'N/A'}. Timeframe: ${timeframe}.
${relativeStrengthText}
${marketDataPayload?.csv ? `\n\nMarket Data (CSV):\n${marketDataPayload.csv}` : ''}
Provide a complete technical analysis based on this data and/or the accompanying chart image.`;

  const parts: any[] = [{ text: textPrompt }];
  if (image) {
    parts.unshift({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    });
  }

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts },
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: responseSchema,
      },
    });

    const jsonText = response.text.trim();
    const report = JSON.parse(jsonText) as AnalysisReport;
    
    if (!report.summaryTable || !report.criticalLevels) {
        throw new Error("AI response is missing critical data sections. Please try again.");
    }
    
    // Manually inject the calculated performance data into the report
    if (relativeStrengthText && report.relativeStrength) {
        const assetPerfMatch = relativeStrengthText.match(/- This Asset's Performance: (.*?)\n/);
        const benchmarkPerfMatch = relativeStrengthText.match(/- Benchmark Index .* Performance: (.*?)\n/);
        if(assetPerfMatch) report.relativeStrength.assetPerformance3M = assetPerfMatch[1];
        if(benchmarkPerfMatch) report.relativeStrength.benchmarkPerformance3M = benchmarkPerfMatch[1];
    }

    return { report, chartData: marketDataPayload?.chartData ?? null };

  } catch (error) {
    console.error("Error generating analysis from Gemini:", error);
    if (error instanceof Error && (error.message.includes('JSON') || error.message.includes('json'))) {
         throw new Error("The AI returned an invalid analysis format. This can be a temporary issue. Please try your request again.");
    }
    throw new Error(`AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};