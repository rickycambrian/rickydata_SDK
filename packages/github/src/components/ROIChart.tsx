interface ROIChartProps {
  data: { model: string; quality: number; cost: number; roi: number }[];
}

export function ROIChart({ data }: ROIChartProps) {
  const maxQuality = Math.max(...data.map(d => d.quality), 1);
  const maxCost = Math.max(...data.map(d => d.cost), 0.01);

  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-4">
      <h3 className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-4">Model ROI Comparison</h3>
      <div className="space-y-3">
        {data.map(d => (
          <div key={d.model} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{d.model}</span>
              <span className="text-surface-500 dark:text-surface-400">
                ROI: {d.roi.toFixed(1)} | ${d.cost.toFixed(3)}
              </span>
            </div>
            <div className="flex gap-2 h-4">
              <div
                className="bg-primary-500 rounded-sm"
                style={{ width: `${(d.quality / maxQuality) * 100}%` }}
                title={`Quality: ${(d.quality * 100).toFixed(0)}%`}
              />
              <div
                className="bg-orange-400 rounded-sm"
                style={{ width: `${(d.cost / maxCost) * 30}%` }}
                title={`Cost: $${d.cost.toFixed(3)}`}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-3 text-xs text-surface-500">
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 bg-primary-500 rounded-sm" /> Quality
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 bg-orange-400 rounded-sm" /> Cost
        </div>
      </div>
    </div>
  );
}
