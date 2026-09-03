/**
 * SENT — metrics (§146, §437).
 *
 * §146 lists eighteen things that must be monitored — indexer lag, event delay,
 * quote latency, Stockback finalization lag, vault solvency, API latency, and
 * the rest — and §437 requires metrics as a capability. This is the registry
 * they are recorded in and the Prometheus text rendering they are scraped
 * through.
 *
 * WHY NOT prom-client
 * -------------------
 * It is the obvious choice and it is a fine library. What is needed here is
 * three metric types and a text encoder — under two hundred lines — against a
 * dependency that pulls in a default registry of Node process metrics, cluster
 * aggregation and a GC probe. The trade is a small amount of code for one fewer
 * runtime dependency in four services, and §443 asks for deviations from the
 * reference stack to be reasoned rather than assumed.
 *
 * HISTOGRAMS, NOT AVERAGES
 * ------------------------
 * §146 asks for quote latency and API latency. An average of those is close to
 * useless: the number that matters is the tail, because the request that took
 * four seconds is the one a user noticed. So latency is a histogram with
 * explicit buckets and the quantiles are computed by whatever scrapes it.
 *
 * A GAUGE IS A CALLBACK, NOT A NUMBER
 * -----------------------------------
 * Indexer lag and vault solvency are properties of the world, not events. If a
 * gauge held a number, something would have to remember to keep it fresh, and
 * a lag metric that quietly stopped updating reports "no lag" — the exact
 * failure the metric exists to catch. So a gauge is registered as a function
 * and read at scrape time.
 */

export type Labels = Readonly<Record<string, string>>;

interface Series {
  readonly labels: Labels;
  value: number;
}

/** Latency buckets in seconds, from a fast local call to a hung one. */
export const LATENCY_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

interface HistogramSeries {
  readonly labels: Labels;
  readonly counts: number[];
  sum: number;
  count: number;
}

interface CounterMetric {
  readonly kind: "counter";
  readonly help: string;
  readonly series: Map<string, Series>;
}

interface GaugeMetric {
  readonly kind: "gauge";
  readonly help: string;
  /** Read at scrape time. See the header for why this is not a stored number. */
  readonly read: () => number | null;
  readonly labels: Labels;
}

interface HistogramMetric {
  readonly kind: "histogram";
  readonly help: string;
  readonly buckets: readonly number[];
  readonly series: Map<string, HistogramSeries>;
}

type Metric = CounterMetric | GaugeMetric | HistogramMetric;

function key(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k] ?? ""}`)
    .join(",");
}

/**
 * Escape a label value for the text exposition format.
 *
 * Backslash, quote and newline. An unescaped newline in a label makes the rest
 * of the scrape unparseable, and label values here can carry an error message.
 */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function renderLabels(labels: Labels, extra?: Labels): string {
  const all = { ...labels, ...extra };
  const entries = Object.entries(all).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "";

  return `{${entries
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}="${escapeLabel(String(v))}"`)
    .join(",")}}`;
}

export class Registry {
  private readonly metrics = new Map<string, Metric>();

  counter(name: string, help: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, { kind: "counter", help, series: new Map() });
    }
  }

  /**
   * A gauge, read at scrape time.
   *
   * `read` may return null to mean "cannot be determined right now" — a vault
   * balance while RPC is down, for instance. The series is then OMITTED rather
   * than reported as zero: a solvency gauge that reads zero during an outage is
   * an alert about a problem that does not exist, and one that reports its last
   * known value is a missing alert about one that does.
   */
  gauge(name: string, help: string, read: () => number | null, labels: Labels = {}): void {
    this.metrics.set(name, { kind: "gauge", help, read, labels });
  }

  histogram(
    name: string,
    help: string,
    buckets: readonly number[] = LATENCY_BUCKETS,
  ): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, { kind: "histogram", help, buckets, series: new Map() });
    }
  }

  increment(name: string, labels: Labels = {}, by = 1): void {
    const metric = this.metrics.get(name);
    if (metric?.kind !== "counter") return;

    const k = key(labels);
    const existing = metric.series.get(k);

    if (existing === undefined) metric.series.set(k, { labels, value: by });
    else existing.value += by;
  }

  /** Record one observation, in the metric's own unit (seconds for latency). */
  observe(name: string, value: number, labels: Labels = {}): void {
    const metric = this.metrics.get(name);
    if (metric?.kind !== "histogram") return;

    const k = key(labels);
    let series = metric.series.get(k);

    if (series === undefined) {
      series = { labels, counts: metric.buckets.map(() => 0), sum: 0, count: 0 };
      metric.series.set(k, series);
    }

    for (let i = 0; i < metric.buckets.length; i++) {
      const bound = metric.buckets[i];
      if (bound !== undefined && value <= bound) series.counts[i] = (series.counts[i] ?? 0) + 1;
    }

    series.sum += value;
    series.count += 1;
  }

  /** Time a promise into a histogram, recording the outcome as a label. */
  async time<T>(name: string, labels: Labels, fn: () => Promise<T>): Promise<T> {
    const started = process.hrtime.bigint();

    try {
      const result = await fn();
      this.observe(name, elapsedSeconds(started), { ...labels, outcome: "ok" });
      return result;
    } catch (error) {
      // Failures are timed too. A dependency that fails fast and one that hangs
      // for thirty seconds are very different incidents, and excluding errors
      // from the histogram hides the second kind entirely.
      this.observe(name, elapsedSeconds(started), { ...labels, outcome: "error" });
      throw error;
    }
  }

  /** Prometheus text exposition format (version 0.0.4). */
  render(): string {
    const lines: string[] = [];

    for (const [name, metric] of [...this.metrics.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} ${metric.kind}`);

      if (metric.kind === "counter") {
        for (const series of metric.series.values()) {
          lines.push(`${name}${renderLabels(series.labels)} ${series.value}`);
        }
        // A counter with no observations is still worth exporting as zero: the
        // difference between "no errors yet" and "this metric does not exist"
        // is what an alert rule needs to distinguish.
        if (metric.series.size === 0) lines.push(`${name} 0`);
        continue;
      }

      if (metric.kind === "gauge") {
        const value = metric.read();
        if (value !== null && Number.isFinite(value)) {
          lines.push(`${name}${renderLabels(metric.labels)} ${value}`);
        }
        continue;
      }

      for (const series of metric.series.values()) {
        let cumulative = 0;

        for (let i = 0; i < metric.buckets.length; i++) {
          cumulative = series.counts[i] ?? 0;
          lines.push(
            `${name}_bucket${renderLabels(series.labels, {
              le: String(metric.buckets[i]),
            })} ${cumulative}`,
          );
        }

        lines.push(
          `${name}_bucket${renderLabels(series.labels, { le: "+Inf" })} ${series.count}`,
        );
        lines.push(`${name}_sum${renderLabels(series.labels)} ${series.sum}`);
        lines.push(`${name}_count${renderLabels(series.labels)} ${series.count}`);
      }
    }

    return `${lines.join("\n")}\n`;
  }
}

export function elapsedSeconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1e9;
}
