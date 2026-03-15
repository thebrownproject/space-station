import { jest } from '@jest/globals';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockRunAgent = jest.fn<any>().mockResolvedValue({
  exitCode: 0,
  stdout: 'ok',
  stderr: '',
  durationMs: 100,
  timedOut: false,
});
const mockBuildPrompt = jest.fn<any>().mockResolvedValue('test prompt');

jest.unstable_mockModule('../runner.js', () => ({
  runAgent: mockRunAgent,
  buildPrompt: mockBuildPrompt,
}));

const { CronManager } = await import('../scheduler.js');
type CronJobConfig = import('../scheduler-types.js').CronJobConfig;
type ExecutionLog = import('../scheduler-types.js').ExecutionLog;

function makeJob(overrides: Partial<CronJobConfig> = {}): CronJobConfig {
  return {
    id: 'test-job',
    schedule: '0 0 * * *',
    description: 'Test job',
    action: { type: 'claude', prompt: 'Do something' },
    enabled: true,
    catchUp: false,
    protect: true,
    timeout: 60,
    ...overrides,
  };
}

describe('CronManager', () => {
  let tmpDir: string;
  let stateFile: string;
  let scheduler: InstanceType<typeof CronManager>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cronmgr-'));
    stateFile = join(tmpDir, 'daemon-state.json');
    scheduler = new CronManager(stateFile);
    mockRunAgent.mockClear();
    mockBuildPrompt.mockClear();
    mockRunAgent.mockResolvedValue({
      exitCode: 0, stdout: 'ok', stderr: '', durationMs: 100, timedOut: false,
    });
    mockBuildPrompt.mockResolvedValue('test prompt');
  });

  afterEach(async () => {
    await scheduler.stop();
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('addJob and listJobs', () => {
    scheduler.addJob('agent-a', '/path/a', makeJob());
    scheduler.addJob('agent-b', '/path/b', makeJob({ id: 'other-job' }));

    const all = scheduler.listJobs();
    expect(all).toHaveLength(2);
    expect(all.map(j => j.agentName)).toEqual(['agent-a', 'agent-b']);
  });

  test('listJobs filters by agentName', () => {
    scheduler.addJob('agent-a', '/path/a', makeJob());
    scheduler.addJob('agent-b', '/path/b', makeJob({ id: 'other-job' }));

    const filtered = scheduler.listJobs('agent-a');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].agentName).toBe('agent-a');
  });

  test('removeJob stops and removes the job', async () => {
    scheduler.addJob('agent-a', '/path/a', makeJob());
    await scheduler.start();

    expect(scheduler.removeJob('agent-a', 'test-job')).toBe(true);
    expect(scheduler.listJobs()).toHaveLength(0);
  });

  test('removeJob returns false for unknown job', () => {
    expect(scheduler.removeJob('unknown', 'nope')).toBe(false);
  });

  test('start writes state with pid and startedAt', async () => {
    scheduler.addJob('agent-a', '/path/a', makeJob());
    await scheduler.start();

    const state = JSON.parse(await readFile(stateFile, 'utf-8'));
    expect(state.pid).toBe(process.pid);
    expect(state.startedAt).toBeDefined();
  });

  test('stop clears pid from state', async () => {
    scheduler.addJob('agent-a', '/path/a', makeJob());
    await scheduler.start();
    await scheduler.stop();

    const state = JSON.parse(await readFile(stateFile, 'utf-8'));
    expect(state.pid).toBeUndefined();
  });

  test('loadState handles missing state file gracefully', async () => {
    await scheduler.start();
    const state = JSON.parse(await readFile(stateFile, 'utf-8'));
    expect(state.jobs).toEqual({});
  });

  test('loadState restores persisted state', async () => {
    const prior = {
      jobs: {
        'agent-a:test-job': {
          lastRun: '2026-01-01T00:00:00.000Z',
          lastStatus: 'success',
          runCount: 5,
          errorCount: 0,
        },
      },
    };
    await writeFile(stateFile, JSON.stringify(prior));

    scheduler.addJob('agent-a', '/path/a', makeJob());
    await scheduler.start();

    const jobs = scheduler.listJobs();
    expect(jobs[0].lastRun).toBe('2026-01-01T00:00:00.000Z');
    expect(jobs[0].runCount).toBe(5);
  });

  test('triggerJob emits job:start and job:complete, updates state', async () => {
    scheduler.addJob('agent-a', '/path/a', makeJob());
    await scheduler.start();

    const starts: ExecutionLog[] = [];
    const completes: ExecutionLog[] = [];
    // Snapshot the log at emit time since the object is mutated
    scheduler.on('job:start', (log: ExecutionLog) => starts.push({ ...log }));
    scheduler.on('job:complete', (log: ExecutionLog) => completes.push({ ...log }));

    await scheduler.triggerJob('agent-a', 'test-job');

    expect(starts).toHaveLength(1);
    expect(starts[0].agentName).toBe('agent-a');
    expect(starts[0].jobId).toBe('test-job');
    expect(starts[0].status).toBe('running');

    expect(completes).toHaveLength(1);
    expect(completes[0].status).toBe('success');
    expect(completes[0].durationMs).toBe(100);
    expect(completes[0].completedAt).toBeDefined();

    const state = JSON.parse(await readFile(stateFile, 'utf-8'));
    const jobState = state.jobs['agent-a:test-job'];
    expect(jobState.lastStatus).toBe('success');
    expect(jobState.runCount).toBe(1);
    expect(jobState.errorCount).toBe(0);
  });

  test('triggerJob emits job:error on failure', async () => {
    mockRunAgent.mockResolvedValueOnce({
      exitCode: 1, stdout: '', stderr: 'something broke', durationMs: 50, timedOut: false,
    });

    scheduler.addJob('agent-a', '/path/a', makeJob());
    await scheduler.start();

    const errors: ExecutionLog[] = [];
    scheduler.on('job:error', (log: ExecutionLog) => errors.push(log));

    await scheduler.triggerJob('agent-a', 'test-job');

    expect(errors).toHaveLength(1);
    expect(errors[0].status).toBe('error');
    expect(errors[0].error).toBe('something broke');
  });

  test('triggerJob emits job:error on timeout', async () => {
    mockRunAgent.mockResolvedValueOnce({
      exitCode: 1, stdout: '', stderr: '', durationMs: 60000, timedOut: true,
    });

    scheduler.addJob('agent-a', '/path/a', makeJob());
    await scheduler.start();

    const errors: ExecutionLog[] = [];
    scheduler.on('job:error', (log: ExecutionLog) => errors.push(log));

    await scheduler.triggerJob('agent-a', 'test-job');

    expect(errors).toHaveLength(1);
    expect(errors[0].status).toBe('timeout');
    expect(errors[0].error).toBe('Execution timed out');
  });

  test('triggerJob throws for unknown job', async () => {
    await expect(scheduler.triggerJob('unknown', 'nope'))
      .rejects.toThrow('Job not found: unknown:nope');
  });

  test('triggerJob handles exception in runAgent', async () => {
    mockRunAgent.mockRejectedValueOnce(new Error('spawn failed'));

    scheduler.addJob('agent-a', '/path/a', makeJob());
    await scheduler.start();

    const errors: ExecutionLog[] = [];
    scheduler.on('job:error', (log: ExecutionLog) => errors.push(log));

    await scheduler.triggerJob('agent-a', 'test-job');

    expect(errors).toHaveLength(1);
    expect(errors[0].status).toBe('error');
    expect(errors[0].error).toBe('spawn failed');
  });

  test('disabled jobs are not scheduled', async () => {
    scheduler.addJob('agent-a', '/path/a', makeJob({ enabled: false }));
    await scheduler.start();

    const jobs = scheduler.listJobs();
    expect(jobs[0].nextRun).toBeUndefined();
  });

  test('describeSchedule returns human-readable string', () => {
    const desc = scheduler.describeSchedule('0 0 * * *');
    // cronstrue returns "At 12:00 AM" for this pattern
    expect(desc.toLowerCase()).toContain('12:00 am');
  });

  test('describeSchedule returns raw schedule on parse failure', () => {
    const desc = scheduler.describeSchedule('not-a-cron');
    expect(desc).toBe('not-a-cron');
  });

  test('error count increments on failures', async () => {
    scheduler.addJob('agent-a', '/path/a', makeJob());
    await scheduler.start();

    // First run: success (default mock)
    await scheduler.triggerJob('agent-a', 'test-job');

    // Second run: error
    mockRunAgent.mockResolvedValueOnce({
      exitCode: 1, stdout: '', stderr: 'err', durationMs: 10, timedOut: false,
    });
    await scheduler.triggerJob('agent-a', 'test-job');

    const state = JSON.parse(await readFile(stateFile, 'utf-8'));
    const jobState = state.jobs['agent-a:test-job'];
    expect(jobState.runCount).toBe(2);
    expect(jobState.errorCount).toBe(1);
  });

  test('emit action does not call runAgent', async () => {
    scheduler.addJob('agent-a', '/path/a', makeJob({
      action: { type: 'emit', subject: 'test.event' },
    }));
    await scheduler.start();

    await scheduler.triggerJob('agent-a', 'test-job');

    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  test('skill action calls buildPrompt with skill name', async () => {
    scheduler.addJob('agent-a', '/path/a', makeJob({
      action: { type: 'skill', skill: 'summarize' },
    }));
    await scheduler.start();

    await scheduler.triggerJob('agent-a', 'test-job');

    expect(mockBuildPrompt).toHaveBeenCalledWith(
      '/path/a',
      'Run your summarize skill',
      'summarize',
    );
  });
});

describe('startDaemon integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'daemon-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('discovers agents and loads jobs', async () => {
    const { startDaemon } = await import('../daemon.js');
    const { stringify } = await import('yaml');

    const agentDir = join(tmpDir, 'test-agent');
    await mkdir(agentDir, { recursive: true });

    await writeFile(join(agentDir, 'agent.yaml'), stringify({
      name: 'test-agent',
      description: 'A test agent',
      capabilities: ['general'],
    }));
    await writeFile(join(agentDir, 'cron.yaml'), stringify({
      jobs: [{
        id: 'daily',
        schedule: '0 0 * * *',
        description: 'Daily check',
        action: { type: 'claude', prompt: 'Check things' },
      }],
    }));

    const stateFile = join(tmpDir, 'state.json');
    const scheduler = await startDaemon({ agentsDir: tmpDir, stateFile });

    const jobs = scheduler.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].agentName).toBe('test-agent');
    expect(jobs[0].jobId).toBe('daily');
    expect(jobs[0].enabled).toBe(true);

    await scheduler.stop();
  });
});
