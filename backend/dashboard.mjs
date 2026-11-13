export function clampDays(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(30, Math.max(1, Math.trunc(n))) : 14;
}

export function dashboardQueries(days) {
  return {
    sessions: ["SELECT count(*)::int AS active FROM sessions WHERE expires_at > now() AND last_seen > now() - interval '5 minutes'", []],
    access: ["SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status IN ('approved','denied'))::int AS decided, (SELECT avg(EXTRACT(EPOCH FROM (a.at - r.created_at))) FROM access_requests r JOIN LATERAL (SELECT max(at) AS at FROM access_approvals WHERE request_id = r.id) a ON a.at IS NOT NULL WHERE r.status IN ('approved','denied')) AS avg_decision_seconds, count(*) FILTER (WHERE status = 'denied' AND created_at >= now() - interval '7 days')::int AS denied_7d FROM access_requests", []],
    heatmap: ["SELECT to_char(at, 'YYYY-MM-DD') AS date, extract(hour FROM at)::int AS hour, action AS cause, count(*)::int AS count FROM audit_events WHERE at >= now() - interval '7 days' AND (action ILIKE '%denied%' OR action ILIKE '%fail%' OR action ILIKE '%locked%') GROUP BY 1, 2, 3 ORDER BY 1, 2, 3", []],
    series: ["WITH days AS (SELECT generate_series(current_date - ($1::int - 1), current_date, interval '1 day')::date AS date) SELECT to_char(days.date, 'YYYY-MM-DD') AS date, (SELECT count(*)::int FROM audit_events a WHERE a.at >= days.date AND a.at < days.date + interval '1 day') AS audit, (SELECT count(*)::int FROM document_versions v WHERE v.date >= days.date AND v.date < days.date + interval '1 day') AS documents FROM days ORDER BY days.date", [days]],
  };
}

export function makeDashboardRoutes({ q, send, forbid }) {
  async function summary(req, res) {
    if (req.me.accessLevel !== 5 && req.me.securityOfficer !== true) return forbid(res, req.me, 'dashboard', 'summary', 'dashboard view denied');
    const sp = new URL(req.url, 'http://localhost').searchParams;
    const days = clampDays(sp.get('days') ?? 14);
    const sql = dashboardQueries(days);
    const [sessions, access, heatmap, series] = await Promise.all([
      q(...sql.sessions), q(...sql.access), q(...sql.heatmap), q(...sql.series),
    ]);
    return send(res, 200, {
      generatedAt: new Date().toISOString(),
      sessions: { active: sessions.rows[0]?.active ?? 0 },
      access: {
        pending: access.rows[0]?.pending ?? 0,
        decided: access.rows[0]?.decided ?? 0,
        avgDecisionSeconds: access.rows[0]?.avg_decision_seconds == null ? null : Number(access.rows[0].avg_decision_seconds),
        denied7d: access.rows[0]?.denied_7d ?? 0,
        heatmap: heatmap.rows.map((r) => ({ date: r.date, hour: Number(r.hour), cause: r.cause, count: r.count })),
      },
      series: series.rows.map((r) => ({ date: r.date, audit: r.audit, documents: r.documents })),
    });
  }
  return { summary };
}
