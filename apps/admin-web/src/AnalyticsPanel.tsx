import { FormEvent, useEffect, useState } from 'react';
import { AnalyticsQuery, AnalyticsSummary, api, ApiError, AuthenticatedUser, downloadJourneysCsv, School } from './api';

interface Props {
  token: string;
  user: AuthenticatedUser;
  schools: School[];
}

const DAY_MS = 86_400_000;

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): AnalyticsQuery {
  const today = new Date();
  return { from: isoDay(new Date(today.getTime() - 29 * DAY_MS)), to: isoDay(today) };
}

const fmtPct = (v: number | null) => (v === null ? '—' : `${v}%`);
const fmtMin = (v: number | null) => (v === null ? '—' : `${v} min`);
const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? `${error.code}: ${error.message}` : String(error);
  return <div className="error-banner">{message}</div>;
}

function Tile({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {detail && <div className="stat-detail">{detail}</div>}
    </div>
  );
}

/** Single-series column chart: journeys scheduled per day. Hover a day for its breakdown. */
function DailyChart({ daily }: { daily: AnalyticsSummary['daily'] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.journeys));
  const peak = daily.reduce((best, d, i) => (d.journeys > daily[best].journeys ? i : best), 0);
  const active = hovered === null ? null : daily[hovered];

  return (
    <figure className="daily-chart" aria-label="Journeys per day">
      <figcaption>Journeys per day</figcaption>
      <div className="chart-plot" onMouseLeave={() => setHovered(null)}>
        <div className="chart-axis-label chart-axis-top">{max}</div>
        <div className="chart-axis-label chart-axis-zero">0</div>
        <div className="chart-bars">
          {daily.map((d, i) => (
            <div
              key={d.date}
              className={`chart-slot${hovered === i ? ' hovered' : ''}`}
              onMouseEnter={() => setHovered(i)}
              onFocus={() => setHovered(i)}
              tabIndex={0}
              aria-label={`${fmtDay(d.date)}: ${d.journeys} journeys`}
            >
              {d.journeys > 0 && (
                <div className="chart-bar" style={{ height: `${(d.journeys / max) * 100}%` }}>
                  {i === peak && daily.length > 1 && hovered === null && <span className="chart-cap">{d.journeys}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
        {active && hovered !== null && (
          <div
            className="chart-tooltip"
            style={{ left: `${((hovered + 0.5) / daily.length) * 100}%` }}
            role="status"
          >
            <strong>{fmtDay(active.date)}</strong>
            <div>{active.journeys} journeys</div>
            <div>{active.completed} completed · {active.cancelled} cancelled</div>
            <div>{active.missedPickups} missed pickups · {active.delays} delays</div>
          </div>
        )}
      </div>
      <div className="chart-x">
        <span>{fmtDay(daily[0].date)}</span>
        <span>{fmtDay(daily[daily.length - 1].date)}</span>
      </div>
    </figure>
  );
}

export default function AnalyticsPanel({ token, user, schools }: Props) {
  const [query, setQuery] = useState<AnalyticsQuery>(defaultRange);
  const [draft, setDraft] = useState<AnalyticsQuery>(defaultRange);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);

  // A school admin is pinned to their own school server-side, so the picker is operators-only.
  const canPickSchool = user.role === 'SUPER_ADMIN' || user.role === 'TRANSPORT_OPERATOR';

  async function load(q: AnalyticsQuery) {
    setLoading(true);
    setError(null);
    try {
      setSummary(await api.getAnalyticsSummary(token, q));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function handleApply(e: FormEvent) {
    e.preventDefault();
    setQuery({ ...draft });
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      await downloadJourneysCsv(token, query);
    } catch (err) {
      setError(err);
    } finally {
      setExporting(false);
    }
  }

  const j = summary?.journeys;
  const c = summary?.children;
  const em = summary?.emergencies;

  return (
    <section className="panel" aria-labelledby="analytics-heading">
      <div className="panel-header">
        <h2 id="analytics-heading">Analytics &amp; reporting</h2>
        <button type="button" className="refresh-button" onClick={handleExport} disabled={exporting || loading}>
          {exporting ? 'Exporting…' : '⇩ Export CSV'}
        </button>
      </div>

      <form onSubmit={handleApply} className="inline-form analytics-filters">
        <label>
          From
          <input type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft({ ...draft, from: e.target.value })} required />
        </label>
        <label>
          To
          <input type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft({ ...draft, to: e.target.value })} required />
        </label>
        {canPickSchool && (
          <label>
            School
            <select value={draft.schoolId ?? ''} onChange={(e) => setDraft({ ...draft, schoolId: e.target.value || undefined })}>
              <option value="">All schools</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" disabled={loading}>
          Apply
        </button>
      </form>

      <ErrorText error={error} />

      {loading && !summary ? (
        <p>Loading…</p>
      ) : summary && j && c && em ? (
        <div className={loading ? 'is-reloading' : undefined}>
          <div className="stat-grid">
            <Tile
              label="Journeys"
              value={j.total}
              detail={`${j.completed} completed · ${j.cancelled} cancelled · ${j.inProgress} in progress · ${j.scheduled} scheduled`}
            />
            <Tile label="Completion rate" value={fmtPct(j.completionRate)} detail="of completed + cancelled" />
            <Tile label="Avg. journey time" value={fmtMin(j.avgDurationMinutes)} detail="start → end, completed runs" />
            <Tile label="Delays reported" value={j.delaysReported} detail={`on ${j.journeysWithDelay} journeys`} />
            <Tile
              label="Missed pickups"
              value={c.missedPickups}
              detail={`${fmtPct(c.missedPickupRate)} of ${c.pickedUp + c.missedPickups} recorded pickups`}
            />
            <Tile
              label="Children transported"
              value={c.droppedOff}
              detail={c.notRecorded > 0 ? `${c.notRecorded} left unrecorded by driver` : `${c.pickedUp} picked up`}
            />
            <Tile
              label="SOS incidents"
              value={em.total}
              detail={em.total === 0 ? 'none in period' : `${em.byStatus.TRIGGERED} open · ${em.byStatus.ACKNOWLEDGED} acknowledged`}
            />
            <Tile
              label="SOS response"
              value={fmtMin(em.avgMinutesToAcknowledge)}
              detail={`to acknowledge · ${fmtMin(em.avgMinutesToResolve)} to resolve`}
            />
          </div>

          {j.total === 0 ? (
            <p className="hint">No journeys were scheduled in this period.</p>
          ) : (
            <>
              <DailyChart daily={summary.daily} />

              <h3>By route</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Route</th>
                      <th>School</th>
                      <th className="num">Journeys</th>
                      <th className="num">Completion</th>
                      <th className="num">Avg. time</th>
                      <th className="num">Delays</th>
                      <th className="num">Missed pickups</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.routes.map((r) => (
                      <tr key={r.routeId}>
                        <td>{r.routeName}</td>
                        <td>{r.schoolName}</td>
                        <td className="num">{r.journeys}</td>
                        <td className="num">{fmtPct(r.completionRate)}</td>
                        <td className="num">{fmtMin(r.avgDurationMinutes)}</td>
                        <td className="num">{r.delays}</td>
                        <td className="num">
                          {r.missedPickups}
                          {r.missedPickupRate !== null && <span className="mono"> ({r.missedPickupRate}%)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3>By driver</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th className="num">Journeys</th>
                      <th className="num">Completed</th>
                      <th className="num">Avg. time</th>
                      <th className="num">Delays</th>
                      <th className="num">Missed pickups</th>
                      <th className="num">SOS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.drivers.map((d) => (
                      <tr key={d.driverId}>
                        <td>{d.driverName}</td>
                        <td className="num">{d.journeys}</td>
                        <td className="num">{d.completed}</td>
                        <td className="num">{fmtMin(d.avgDurationMinutes)}</td>
                        <td className="num">{d.delays}</td>
                        <td className="num">{d.missedPickups}</td>
                        <td className="num">{d.sosTriggered}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="hint">
            On-time performance isn't shown: stop times have no timezone and per-child scheduled times aren't recorded yet,
            so any on-time figure would be a guess.
          </p>
        </div>
      ) : null}
    </section>
  );
}
