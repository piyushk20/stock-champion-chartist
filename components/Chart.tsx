import React, { useEffect, useRef } from 'react';
import type { ChartData, CandlestickData } from '../types';

// Declare global library loaded from CDN
declare const LightweightCharts: any;

interface ChartProps {
  data: ChartData;
  assetName: string;
}

// Helper function to create the HTML content for the tooltip.
const getTooltipContent = (assetName: string, candleData: CandlestickData, volumeValue: number | null | undefined): string => {
    const change = candleData.close - candleData.open;
    const percentChange = candleData.open === 0 ? 0 : (change / candleData.open) * 100;
    const sign = change >= 0 ? '+' : '';
    const color = change >= 0 ? 'text-green-400' : 'text-red-400';
    const changeHtml = `<span class="${color}">${sign}${change.toFixed(2)} (${sign}${percentChange.toFixed(2)}%)</span>`;
    const date = new Date(candleData.time * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

    return `
      <div class="font-sans">
        <div class="font-bold text-white">${assetName}</div>
        <div class="text-sm text-gray-400">${date}</div>
        <div class="mt-2 text-xs grid grid-cols-2 gap-x-2 gap-y-1">
          <span class="text-gray-400">Open:</span> <span class="font-mono text-right text-white">${candleData.open.toFixed(2)}</span>
          <span class="text-gray-400">High:</span> <span class="font-mono text-right text-white">${candleData.high.toFixed(2)}</span>
          <span class="text-gray-400">Low:</span> <span class="font-mono text-right text-white">${candleData.low.toFixed(2)}</span>
          <span class="text-gray-400">Close:</span> <span class="font-mono text-right text-white">${candleData.close.toFixed(2)}</span>
          <span class="text-gray-400">Change:</span> <span class="font-mono text-right">${changeHtml}</span>
          <span class="text-gray-400">Volume:</span> <span class="font-mono text-right text-white">${volumeValue?.toLocaleString() ?? 'N/A'}</span>
        </div>
      </div>
    `;
};

export const Chart: React.FC<ChartProps> = ({ data, assetName }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Effect for chart initialization (runs only once on mount)
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) {
        return;
    }

    // Using the modern, correct configuration object for layout.
    const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 450,
        layout: {
            background: {
                type: 'solid',
                color: '#1A2233', // gray-800
            },
            textColor: '#A0AEC0', // gray-400
        },
        grid: { vertLines: { color: '#2A344A' }, horzLines: { color: '#2A344A' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#4A5568' },
        timeScale: { borderColor: '#4A5568', timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    if (!chart || typeof chart.addCandlestickSeries !== 'function') {
        console.error("Chart object is invalid after creation. Cannot add series.");
        return;
    }

    candlestickSeriesRef.current = chart.addCandlestickSeries({
        upColor: '#28a745', downColor: '#dc3545',
        borderDownColor: '#dc3545', borderUpColor: '#28a745',
        wickDownColor: '#dc3545', wickUpColor: '#28a745',
    });

    volumeSeriesRef.current = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: '', // place on separate scale
        scaleMargins: { top: 0.8, bottom: 0 },
    });
    
    const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
            chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
    };
    window.addEventListener('resize', handleResize);

    // Cleanup function for when the component unmounts
    return () => {
        window.removeEventListener('resize', handleResize);
        if (chartRef.current) {
            chartRef.current.remove();
        }
        chartRef.current = null;
    };
  }, []); // Empty dependency array ensures this runs only once

  // Effect to update data and tooltip when props change
  useEffect(() => {
    if (!chartRef.current || !candlestickSeriesRef.current || !volumeSeriesRef.current || !data) {
        return;
    }

    // Update the data for the series
    candlestickSeriesRef.current.setData(data.candlestickData);
    volumeSeriesRef.current.setData(data.volumeData);
    chartRef.current.timeScale().fitContent();

    // Tooltip logic needs to be managed here to get the latest assetName
    const crosshairMoveHandler = (param: any) => {
        const tooltip = tooltipRef.current;
        if (
          !param.point || !param.time || !tooltip ||
          !param.seriesData.has(candlestickSeriesRef.current)
        ) {
          tooltip.style.display = 'none';
          return;
        }

        const candleData = param.seriesData.get(candlestickSeriesRef.current);
        const volumeDataPoint = param.seriesData.get(volumeSeriesRef.current);

        tooltip.style.display = 'block';
        tooltip.innerHTML = getTooltipContent(assetName, candleData, volumeDataPoint?.value);

        const containerWidth = chartContainerRef.current!.clientWidth;
        const tooltipWidth = tooltip.offsetWidth;
        const x = param.point.x;
        
        // Position tooltip to avoid going off-screen
        let left = x + 20;
        if (left + tooltipWidth > containerWidth) {
            left = x - tooltipWidth - 20;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${param.point.y + 20}px`;
    };

    chartRef.current.subscribeCrosshairMove(crosshairMoveHandler);

    return () => {
      // The library should handle replacing the listener on re-subscription.
    }
  }, [data, assetName]);

  return (
    <div ref={chartContainerRef} style={{ height: '450px', width: '100%', position: 'relative' }}>
        <div
            ref={tooltipRef}
            style={{
                position: 'absolute',
                display: 'none',
                pointerEvents: 'none',
                zIndex: 10,
                backgroundColor: 'rgba(30, 35, 48, 0.9)',
                padding: '8px 12px',
                borderRadius: '4px',
                border: '1px solid #4A5568',
                width: '180px',
            }}
        />
    </div>
  );
};
