import type {
  GameId,
  GameMode,
  ParticipantDueStatus,
  ParticipantLearningStatus,
  RequiredGameId,
} from './types.js'

export const CURRENT_RULE_VERSION = 'v0.5-4games.1'
export const CURRENT_LEARNING_VERSION_ID = 'lv-sample-v0.5-4games.1'
export const RUN_SUBMISSION_TTL_MS = 20 * 60 * 1000
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export const PASSING_SCORE = 10
export const BASE_ACTION_POINTS = 2

export const REQUIRED_GAME_ORDER: readonly RequiredGameId[] = [
  'typing',
  'snake',
  'shooter',
  'runner',
] as const

export const ALL_GAME_IDS: readonly GameId[] = [...REQUIRED_GAME_ORDER] as const

export interface GameCatalogEntry {
  id: GameId
  title: string
  shortTitle: string
  socketIndex: number
  accentColor: string
  cardTagline: string
  howToPlayOneLine: string
  summaryLine: string
  expectedDurationLabel: string
  controlsLabel: string
  clearConditionLabel: string
  practiceGoalLabel: string
  assistedDiffLabel: string
  allowedModes: readonly GameMode[]
}

export const GAME_CATALOG: Record<GameId, GameCatalogEntry> = {
  typing: {
    id: 'typing',
    title: '산성비 타자',
    shortTitle: '산성비 타자',
    socketIndex: 0,
    accentColor: '#43E7F2',
    cardTagline: '위에서 내려오는 공식 문구를 입력해 케이블을 연결하세요!',
    howToPlayOneLine: '화면에 내려오는 LS전선 공식 문구를 똑같이 타이핑하고 Enter를 누릅니다.',
    summaryLine: '60초 · 한글 타이핑 + Enter · 10점 달성 시 통과 (문구당 +2점)',
    expectedDurationLabel: '60초 (여유 75초)',
    controlsLabel: '키보드로 문구 입력 후 Enter',
    clearConditionLabel: '10점 이상 통과 (문구 1개당 +2점 · 5개 입력 시 통과 후 최대 48점 경쟁)',
    practiceGoalLabel: '내려오는 공식 문구 1개를 입력하고 Enter 누르기',
    assistedDiffLabel: '제한 시간 60초 → 75초, 문구 낙하 속도 80%로 천천히 내려옴',
    allowedModes: ['standard', 'assisted'],
  },
  snake: {
    id: 'snake',
    title: '단어 먹는 뱀',
    shortTitle: '단어 뱀',
    socketIndex: 1,
    accentColor: '#B9F66C',
    cardTagline: '네온 뱀을 움직여 공식 문장의 단어 조각을 순서대로 모으세요!',
    howToPlayOneLine: '상단 문장 빈칸을 보고 알맞은 다음 단어 캡슐을 순서대로 먹어 문장을 완성합니다.',
    summaryLine: '90초 · 방향키(↑↓←→) 이동 · 10점 달성 시 통과 (조각 +2점 / 문장 +2점)',
    expectedDurationLabel: '90초 (여유 120초)',
    controlsLabel: '방향키(↑↓←→) 또는 WASD 이동',
    clearConditionLabel: '10점 이상 통과 (정답 조각 +2점, 문장 완성 보너스 +2점 · 통과 후 연속 경쟁)',
    practiceGoalLabel: '방향키로 움직여 정답 단어 캡슐 1개 먹기',
    assistedDiffLabel: '제한 시간 90초 → 120초, 뱀 이동 속도 80%로 여유롭게 이동',
    allowedModes: ['standard', 'assisted'],
  },
  shooter: {
    id: 'shooter',
    title: '가치 표적 슈팅',
    shortTitle: '표적 슈팅',
    socketIndex: 2,
    accentColor: '#FFBD64',
    cardTagline: '상단 문제를 읽고 알맞은 핵심가치(C·O·R·E) 표적을 명중시키세요!',
    howToPlayOneLine: '화면 상단의 설명에 해당하는 핵심가치 표적(1·2·3번)을 골라 레이저로 쏩니다.',
    summaryLine: '12문항 · 방향키+Space 또는 마우스 클릭 · 10점 달성 시 통과 (정답 +2점)',
    expectedDurationLabel: '약 1~2분 (문항당 10초)',
    controlsLabel: '←·→ + Space 발사 · 마우스 클릭 · 숫자키 1·2·3 즉시 발사',
    clearConditionLabel: '10점 이상 통과 (정답 명중 +2점 · 5문제 맞히면 통과, 12문제 만점 24점 경쟁)',
    practiceGoalLabel: '상단 문제를 읽고 알맞은 핵심가치 표적 1개 맞히기',
    assistedDiffLabel: '문항당 제한 시간 10초 → 14초로 넉넉하게 제공',
    allowedModes: ['standard', 'assisted'],
  },
  runner: {
    id: 'runner',
    title: 'C.O.R.E. 부스터 런',
    shortTitle: '부스터 런',
    socketIndex: 3,
    accentColor: '#FF6B9E',
    cardTagline: '핵심가치 발판을 밟아 부스터 질주! 바나나 함정은 피하거나 점프하세요!',
    howToPlayOneLine: '3트랙을 달리며 ⚡핵심가치 부스터(+2점)는 밟고, 🍌바나나 껍질(−1점·감속)은 피하거나 점프합니다.',
    summaryLine: '60초 · ←→ 차선 이동 + Space/↑ 점프 · 10점 달성 시 통과 (부스터 +2점)',
    expectedDurationLabel: '60초 (여유 75초)',
    controlsLabel: '←·→ 트랙 이동 · Space 또는 ↑ 점프 (바나나 회피)',
    clearConditionLabel: '10점 이상 통과 (⚡핵심가치 발판 +2점, C·O·R·E 세트 +4점, 🍌바나나 −1점)',
    practiceGoalLabel: '달리면서 ⚡핵심가치 부스터 발판 1개 밟기',
    assistedDiffLabel: '주행 시간 60초 → 75초, 기본 달리기 속도 80%로 장애물 확인 여유 확대',
    allowedModes: ['standard', 'assisted'],
  },
}

export function isRequiredGameId(gameId: string): gameId is RequiredGameId {
  return (REQUIRED_GAME_ORDER as readonly string[]).includes(gameId)
}

export function isValidGameId(gameId: string): gameId is GameId {
  return (ALL_GAME_IDS as readonly string[]).includes(gameId)
}

export function normalizePhraseInput(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ')
}

export function normalizeParticipantCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '')
}

export function formatParticipantCode(clean12: string): string {
  const normalized = normalizeParticipantCode(clean12)
  if (normalized.length !== 12) return clean12
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}`
}

const NICKNAME_PATTERN = /^[가-힣a-zA-Z0-9 _]{2,16}$/

export function validateAndNormalizeNickname(raw: string): {
  valid: boolean
  display: string
  key: string
  error?: string
} {
  const display = raw.normalize('NFC').trim().replace(/\s+/g, ' ')
  if (display.length < 2 || display.length > 16) {
    return {
      valid: false,
      display,
      key: '',
      error: '닉네임은 2자 이상 16자 이하로 입력해 주세요.',
    }
  }
  if (!NICKNAME_PATTERN.test(display)) {
    return {
      valid: false,
      display,
      key: '',
      error: '닉네임은 한글·영문·숫자·공백·밑줄(_)만 사용할 수 있습니다.',
    }
  }
  return {
    valid: true,
    display,
    key: display.toLowerCase(),
  }
}

export function toKstDateString(now: Date = new Date()): string {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000
  return new Date(kstMs).toISOString().slice(0, 10)
}

export function kstStartOfDayUtcMs(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00+09:00`)
}

export function kstExclusiveEndOfDayUtcMs(dateStr: string): number {
  return kstStartOfDayUtcMs(dateStr) + 24 * 60 * 60 * 1000
}

export function isAvailableOnKst(availableFromDate: string, now: Date = new Date()): boolean {
  return now.getTime() >= kstStartOfDayUtcMs(availableFromDate)
}

export function computeParticipantLearningStatus(params: {
  availableFromDate: string
  firstSeenAt: string | null
  hasAnyStartedOrFinalizedRun: boolean
  onboardingCompletedAt: string | null
  now?: Date
}): ParticipantLearningStatus {
  const now = params.now ?? new Date()
  if (!isAvailableOnKst(params.availableFromDate, now)) {
    return 'before_start'
  }
  if (params.onboardingCompletedAt) {
    return 'completed'
  }
  if (!params.firstSeenAt) {
    return 'unseen'
  }
  if (!params.hasAnyStartedOrFinalizedRun) {
    return 'ready_untried'
  }
  return 'in_progress'
}

export function computeParticipantDueStatus(params: {
  recommendedDueDate: string | null
  onboardingCompletedAt: string | null
  dueDateAtCompletion: string | null
  now?: Date
}): ParticipantDueStatus {
  const now = params.now ?? new Date()
  if (params.onboardingCompletedAt) {
    if (!params.dueDateAtCompletion) {
      return 'no_due_date'
    }
    const completedMs = Date.parse(params.onboardingCompletedAt)
    return completedMs < kstExclusiveEndOfDayUtcMs(params.dueDateAtCompletion)
      ? 'completed_on_time'
      : 'completed_late'
  }
  if (!params.recommendedDueDate) {
    return 'no_due_date'
  }
  return now.getTime() < kstExclusiveEndOfDayUtcMs(params.recommendedDueDate)
    ? 'before_due'
    : 'overdue'
}

export const LEARNING_STATUS_LABELS: Record<ParticipantLearningStatus, string> = {
  before_start: '시작 전',
  unseen: '미접속',
  ready_untried: '플레이 가능·미도전',
  in_progress: '진행 중',
  completed: '완료',
}

export const DUE_STATUS_LABELS: Record<ParticipantDueStatus, string> = {
  no_due_date: '미설정',
  before_due: '기한 전',
  overdue: '기한 경과',
  completed_on_time: '기한 내 완료',
  completed_late: '기한 후 완료',
}
