export interface DashboardStats {
  total: number;
  inProgress: number;
  pendingReview: number;
  completed: number;
  failed: number;
  rollbacks: number;
  avgMttrMinutes: number;
}
