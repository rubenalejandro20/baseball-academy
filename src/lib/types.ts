// ─────────────────────────────────────────────
// Database Types
// ─────────────────────────────────────────────

export type ExerciseCategory =
  | 'pre_training'
  | 'post_training'
  | 'recovery'
  | 'mobility'
  | 'strength'
  | 'injury_prevention';

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface Athlete {
  id: string;
  full_name: string;
  age: number | null;
  weight_lbs: number | null;
  position: string | null;
  access_code: string;
  photo_url: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Exercise {
  id: string;
  name: string;
  category: ExerciseCategory;
  description: string | null;
  sets: number | null;
  reps: number | null;
  duration_sec: number | null;
  video_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WeeklyPlan {
  id: string;
  athlete_id: string;
  week_start: string; // ISO date YYYY-MM-DD
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  athlete?: Athlete;
  assigned_exercises?: AssignedExercise[];
}

export interface AssignedExercise {
  id: string;
  weekly_plan_id: string;
  exercise_id: string;
  day: DayOfWeek;
  session_type: ExerciseCategory;
  sets_override: number | null;
  reps_override: number | null;
  duration_sec_override: number | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  // Joined
  exercise?: Exercise;
}

// ─────────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────────

export const DAYS_OF_WEEK: DayOfWeek[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

export const CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  pre_training: 'Pre-Training',
  post_training: 'Post-Training',
  recovery: 'Recovery',
  mobility: 'Mobility',
  strength: 'Strength',
  injury_prevention: 'Injury Prevention',
};

export const CATEGORY_COLORS: Record<ExerciseCategory, string> = {
  pre_training:      'bg-blue-500/20 text-blue-300 border-blue-500/30',
  post_training:     'bg-purple-500/20 text-purple-300 border-purple-500/30',
  recovery:          'bg-teal-500/20 text-teal-300 border-teal-500/30',
  mobility:          'bg-amber-500/20 text-amber-300 border-amber-500/30',
  strength:          'bg-red-500/20 text-red-300 border-red-500/30',
  injury_prevention: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

export const CATEGORY_COLORS_LIGHT: Record<ExerciseCategory, string> = {
  pre_training:      'bg-blue-50 text-blue-700 border-blue-200',
  post_training:     'bg-purple-50 text-purple-700 border-purple-200',
  recovery:          'bg-teal-50 text-teal-700 border-teal-200',
  mobility:          'bg-amber-50 text-amber-700 border-amber-200',
  strength:          'bg-red-50 text-red-700 border-red-200',
  injury_prevention: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export const BASEBALL_POSITIONS = [
  'Pitcher',
  'Catcher',
  'First Base',
  'Second Base',
  'Third Base',
  'Shortstop',
  'Left Field',
  'Center Field',
  'Right Field',
  'Designated Hitter',
  'Utility',
];

// ─────────────────────────────────────────────
// Utility: get Monday of the current week
// ─────────────────────────────────────────────
export function getMondayOfWeek(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

export function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end   = new Date(weekStart + 'T00:00:00');
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

// ─────────────────────────────────────────────
// Activity Routine Types
// ─────────────────────────────────────────────

export type ActivityType = 'pitching' | 'catching' | 'hitting' | 'fielding';

export interface ActivityRoutine {
  id: string;
  activity: ActivityType;
  session_type: ExerciseCategory;
  exercise_id: string;
  sets_override: number | null;
  reps_override: number | null;
  duration_sec_override: number | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  exercise?: Exercise;
}

export const ACTIVITIES: ActivityType[] = ['pitching', 'catching', 'hitting', 'fielding'];

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  pitching: 'Pitching',
  catching: 'Catching',
  hitting:  'Hitting',
  fielding: 'Fielding',
};

export const SESSION_TYPES: ExerciseCategory[] = [
  'pre_training', 'post_training', 'recovery', 'mobility', 'strength', 'injury_prevention',
];

// ─────────────────────────────────────────────
// Milestone 1: Organizations, Staff Roles, Audit
// ─────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string | null;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type StaffRole = 'administrator' | 'coach' | 'physician';

export interface StaffProfile {
  id: string;
  auth_user_id: string;
  organization_id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  is_active: boolean;
  invited_by: string | null;
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformAdmin {
  id: string;
  auth_user_id: string;
  created_at: string;
  created_by: string | null;
}

export interface AuditEvent {
  id: string;
  organization_id: string | null;
  actor_auth_user_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// Minimal athlete shape returned by the rate-limited get_athlete_by_code RPC —
// intentionally NOT the full Athlete row (no access_code, age, weight, notes).
export interface AthleteLookupResult {
  id: string;
  full_name: string;
  position: string | null;
  photo_url: string | null;
}
