// Temporal worker entry point.
// Run with: npx ts-node --project tsconfig.json src/worker.ts
import path from 'path';
import { Worker, NativeConnection } from '@temporalio/worker';
import * as documentActivities from './activities/document.activity.js';
import * as reportActivities from './activities/report.activity.js';

async function main() {
  const connection = await NativeConnection.connect({
    address: process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233',
  });

  const worker = await Worker.create({
    connection,
    namespace: process.env['TEMPORAL_NAMESPACE'] ?? 'jak-swarm',
    taskQueue: process.env['TEMPORAL_TASK_QUEUE'] ?? 'jak-main',
    workflowsPath: path.join(__dirname, 'workflows'),
    activities: { ...documentActivities, ...reportActivities },
  });

  console.info('[Temporal Worker] Starting...');
  await worker.run();
}

main().catch((err) => {
  console.error('[Temporal Worker] Fatal error:', err);
  process.exit(1);
});
