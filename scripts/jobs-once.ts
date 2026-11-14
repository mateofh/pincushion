// npm run jobs:once — procesa la cola de metadatos pendiente y el mantenimiento una vez (cron o depuración).
import { createApp } from '../src/server/context.ts';
import { processDue, runMaintenance } from '../src/server/jobs/worker.ts';

const app = createApp();
let processed = 0;
// Hasta vaciar lo vencido (con tope para no quedarse en bucle si algo se re-encola al instante).
for (let round = 0; round < 100; round++) {
  const n = await processDue(app, { limit: 20 });
  processed += n;
  if (n === 0) break;
}
const maintenance = await runMaintenance(app);
app.log.info('jobs_once.done', { processed, ...maintenance });
app.db.close();
