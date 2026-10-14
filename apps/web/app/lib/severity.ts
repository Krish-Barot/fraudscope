// apps/web/lib/severity.ts
// Severity color mappings used across the dashboard

export type Severity = 'low' | 'medium' | 'high' | 'critical' | 'clean';

export function getSeverityFromScore(score: number): Severity {
  if (score < 20)  return 'clean';
  if (score < 40)  return 'low';
  if (score < 60)  return 'medium';
  if (score < 80)  return 'high';
  return 'critical';
}

// Tailwind classes for severity colors
export const SEVERITY_TEXT: Record<Severity, string> = {
  clean:    'text-emerald-400',
  low:      'text-blue-400',
  medium:   'text-amber-400',
  high:     'text-orange-400',
  critical: 'text-red-400',
};

export const SEVERITY_BG: Record<Severity, string> = {
  clean:    'bg-emerald-400/10',
  low:      'bg-blue-400/10',
  medium:   'bg-amber-400/10',
  high:     'bg-orange-400/10',
  critical: 'bg-red-400/10',
};

export const SEVERITY_BORDER: Record<Severity, string> = {
  clean:    'border-l-emerald-500',
  low:      'border-l-blue-500',
  medium:   'border-l-amber-500',
  high:     'border-l-orange-500',
  critical: 'border-l-red-500',
};

// CSS hex colors for inline styles
export const SEVERITY_HEX: Record<Severity, string> = {
  clean:    '#10b981',
  low:      '#60a5fa',
  medium:   '#f59e0b',
  high:     '#f97316',
  critical: '#ef4444',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  clean:    'CLEAN',
  low:      'LOW',
  medium:   'MEDIUM',
  high:     'HIGH',
  critical: 'CRITICAL',
};