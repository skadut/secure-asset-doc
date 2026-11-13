export function makeControlRoutes({ q, send }) {
  async function list(req, res) {
    const { rows } = await q('SELECT id, family, name, implementation, location FROM nist_controls ORDER BY family, id');
    return send(res, 200, {
      controls: rows.map((r) => ({ id: r.id, family: r.family, name: r.name, implementation: r.implementation, location: r.location })),
    });
  }
  return { list };
}
