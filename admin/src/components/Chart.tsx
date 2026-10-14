import { useEffect, useRef } from "react";

type ChartType = "line" | "bar" | "doughnut";
interface Props {
  type: ChartType;
  labels: string[];
  datasets: { label: string; data: number[]; color?: string }[];
  height?: number;
  /** format tooltip + axis numbers (money etc.) */
  format?: (n: number) => string;
  label: string;
}

const PALETTE = ["#0f6148", "#c9a24b", "#c2456b", "#1e7e8c", "#7c4a9e", "#d9772b", "#2f86c4"];

/**
 * Chart.js is loaded on demand (it is the heaviest dependency of the admin) and only on screens that draw a chart.
 * The chart is a <canvas>, so it is described to screen readers by the `label` text and the numbers stay available in tables.
 */
export function Chart({ type, labels, datasets, height = 240, format, label }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let chart: { destroy: () => void } | null = null;
    let dead = false;
    void import("chart.js").then(({ Chart: C, registerables }) => {
      if (dead || !canvas.current) return;
      C.register(...registerables);
      C.defaults.font.family = getComputedStyle(document.body).fontFamily;
      C.defaults.color = "#5b6a62";
      const fmt = format ?? ((n: number) => String(n));
      const isRound = type === "doughnut";
      chart = new C(canvas.current, {
        type,
        data: {
          labels,
          datasets: datasets.map((d, i) => ({
            label: d.label,
            data: d.data,
            borderColor: d.color ?? PALETTE[i % PALETTE.length],
            backgroundColor: isRound ? labels.map((_, j) => PALETTE[j % PALETTE.length]) : type === "bar" ? (d.color ?? PALETTE[i % PALETTE.length]) : `${d.color ?? PALETTE[i % PALETTE.length]}22`,
            fill: type === "line",
            tension: 0.35,
            borderWidth: type === "line" ? 2.4 : 0,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderRadius: type === "bar" ? 5 : 0,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: isRound || datasets.length > 1, position: "bottom" },
            tooltip: { callbacks: { label: (ctx: { dataset: { label?: string }; parsed: { y?: number } | number }) => ` ${ctx.dataset.label ? `${ctx.dataset.label}: ` : ""}${fmt(Number(typeof ctx.parsed === "number" ? ctx.parsed : (ctx.parsed.y ?? 0)))}` } },
          },
          scales: isRound
            ? {}
            : {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, autoSkip: true } },
                y: { beginAtZero: true, ticks: { callback: (v: string | number) => fmt(Number(v)), maxTicksLimit: 5 }, grid: { color: "#efe8d3" } },
              },
        },
      } as never) as unknown as { destroy: () => void };
    });
    return () => {
      dead = true;
      chart?.destroy();
    };
  }, [type, labels, datasets, format]);
  return (
    <div className="chart">
      <canvas ref={canvas} role="img" aria-label={label} height={height} />
    </div>
  );
}
