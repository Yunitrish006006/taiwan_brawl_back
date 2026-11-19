import { handleSpeedCameraRequest } from '../api/speed_camera_api.js';
import { corsHeaders } from '../core/utils.js';
import { syncOfficialSpeedCameraData } from './sync.js';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    const response = await handleSpeedCameraRequest(request, env, new URL(request.url));
    return response ?? new Response('Not found', { status: 404 });
  },

  scheduled(_event, env, ctx) {
    ctx.waitUntil(syncOfficialSpeedCameraData(env).then(result => console.info('Speed camera refresh', result)));
  },
};
