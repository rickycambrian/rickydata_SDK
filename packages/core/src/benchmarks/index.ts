export { BenchmarkClient } from './benchmark-client.js';

export type {
  // Core entities
  BenchmarkTask,
  BenchmarkRun,
  DiffQualityScore,
  CostMetrics,

  // Tasks
  CreateTaskRequest,
  TaskSearchOptions,
  TaskListResult,

  // Runs
  RecordRunRequest,
  RunSearchOptions,
  RunListResult,

  // ROI
  ROIRecommendation,
  ROIQuery,
  ROIResult,
  CacheROIRequest,

  // Stats
  ConfigStatEntry,
  BenchmarkStats,

  // Config
  BenchmarkClientConfig,
} from './types.js';
