/**
 * Local reproduction: run the LangGraph runner directly and inspect result.traces.
 * This bypasses the API/DB layer to determine if the worker trace exists in memory.
 */
import { SwarmRunner } from '@jak-swarm/swarm';
import { makeInMemoryCheckpointDb } from '@jak-swarm/swarm';

async function main() {
  const runner = new SwarmRunner({
    defaultTimeoutMs: 5 * 60 * 1000,
    db: makeInMemoryCheckpointDb(),
  });

  const result = await runner.run({
    workflowId: 'test-local-trace',
    tenantId: 'test-tenant',
    userId: 'test-user',
    goal: 'www.jakswarm.com, just review the website',
    roleModes: ['cto'],
    industry: 'GENERAL',
  });

  console.log('Status:', result.status);
  console.log('Error:', result.error);
  console.log('Trace count:', result.traces.length);
  console.log('Trace roles:', result.traces.map((t) => t.agentRole));
  console.log('Outputs count:', result.outputs.length);

  const workerTrace = result.traces.find((t) => t.agentRole === 'WORKER_TECHNICAL');
  if (workerTrace) {
    console.log('\nWORKER trace found!');
    console.log('stepIndex:', workerTrace.stepIndex);
    console.log('durationMs:', workerTrace.durationMs);
    console.log('toolCalls count:', workerTrace.toolCalls?.length ?? 0);
    console.log('output keys:', Object.keys(workerTrace.output ?? {}));
  } else {
    console.log('\nWORKER trace MISSING from result.traces');
  }
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
