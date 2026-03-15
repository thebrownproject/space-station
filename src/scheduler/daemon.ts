import { CronManager } from './scheduler.js';
import { AgentLoader } from '../agents/agent-loader.js';
import type { CronAction } from './scheduler-types.js';

export async function startDaemon(options: {
  agentsDir: string;
  stateFile: string;
}): Promise<CronManager> {
  const { agentsDir, stateFile } = options;
  const loader = new AgentLoader();
  const scheduler = new CronManager(stateFile);

  const manifests = await loader.discoverAgents(agentsDir);
  for (const manifest of manifests) {
    if (manifest.cronConfig) {
      for (const job of manifest.cronConfig.jobs) {
        scheduler.addJob(manifest.config.name, manifest.folderPath, {
          id: job.id,
          schedule: job.schedule,
          description: job.description,
          action: job.action as CronAction,
          enabled: job.enabled ?? true,
          catchUp: job.catchUp ?? false,
          protect: job.protect ?? true,
          timeout: job.timeout ?? 3600,
          timezone: job.timezone,
        });
      }
    }
  }

  await scheduler.checkMissedRuns();
  await scheduler.start();

  const jobs = scheduler.listJobs();
  console.log(`Daemon started. ${jobs.length} jobs loaded from ${manifests.length} agents.`);
  for (const job of jobs) {
    const status = job.enabled ? `next: ${job.nextRun ?? 'unknown'}` : 'disabled';
    console.log(`  ${job.agentName}/${job.jobId}: ${job.scheduleHuman} (${status})`);
  }

  const shutdown = async () => {
    console.log('\nShutting down daemon...');
    await scheduler.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return scheduler;
}
