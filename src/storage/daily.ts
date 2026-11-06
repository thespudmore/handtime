const STORAGE_KEY = 'handtime.v1'

export type DayRecord = {
  /** Accumulated handstand seconds for the calendar day. */
  seconds: number
  goalMet: boolean
}

export type AppData = {
  goalMinutes: number
  days: Record<string, DayRecord>
}

const DEFAULT_DATA: AppData = {
  goalMinutes: 10,
  days: {},
}

function todayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return structuredClone(DEFAULT_DATA)
    const parsed = JSON.parse(raw) as Partial<AppData>
    return {
      goalMinutes:
        typeof parsed.goalMinutes === 'number' && parsed.goalMinutes > 0
          ? parsed.goalMinutes
          : DEFAULT_DATA.goalMinutes,
      days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
    }
  } catch {
    return structuredClone(DEFAULT_DATA)
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function getTodayRecord(data: AppData): DayRecord {
  const key = todayKey()
  return data.days[key] ?? { seconds: 0, goalMet: false }
}

export function addHandstandSeconds(data: AppData, deltaSeconds: number): AppData {
  if (deltaSeconds <= 0) return data

  const key = todayKey()
  const current = data.days[key] ?? { seconds: 0, goalMet: false }
  const seconds = current.seconds + deltaSeconds
  const goalSeconds = data.goalMinutes * 60
  const next: AppData = {
    ...data,
    days: {
      ...data.days,
      [key]: {
        seconds,
        goalMet: seconds >= goalSeconds,
      },
    },
  }
  saveData(next)
  return next
}

export function setGoalMinutes(data: AppData, goalMinutes: number): AppData {
  const clamped = Math.min(180, Math.max(1, Math.round(goalMinutes)))
  const key = todayKey()
  const current = data.days[key]
  const next: AppData = {
    ...data,
    goalMinutes: clamped,
    days: current
      ? {
          ...data.days,
          [key]: {
            ...current,
            goalMet: current.seconds >= clamped * 60,
          },
        }
      : data.days,
  }
  saveData(next)
  return next
}

export function recentDays(data: AppData, count = 7): Array<{ date: string; record: DayRecord }> {
  const out: Array<{ date: string; record: DayRecord }> = []
  const cursor = new Date()
  for (let i = 0; i < count; i++) {
    const key = todayKey(cursor)
    out.push({
      date: key,
      record: data.days[key] ?? { seconds: 0, goalMet: false },
    })
    cursor.setDate(cursor.getDate() - 1)
  }
  return out
}

export { todayKey }
