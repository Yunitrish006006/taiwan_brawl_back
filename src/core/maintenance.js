export const maintenanceEnabled = (env) => env.MAINTENANCE_MODE === 'true';

export function maintenanceResponse() {
  return new Response(JSON.stringify({ error: 'Service temporarily unavailable', code: 'MAINTENANCE' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '60' }
  });
}

export function closeForMaintenance(env, socket) {
  if (!maintenanceEnabled(env)) return false;
  try { socket?.close(1012, 'Service restarting'); } catch {}
  return true;
}
