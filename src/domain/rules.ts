import type {
  BonusGameId,
  GameId,
  GameMode,
  ParticipantDueStatus,
  ParticipantLearningStatus,
  RequiredGameId,
} from './types.js'

export const CURRENT_RULE_VERSION = 'v0.4-pilot.1'
export const CURRENT_LEARNING_VERSION_ID = 'lv-sample-v0.4-pilot.1'
export const RUN_SUBMISSION_TTL_MS = 20 * 60 * 1000
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export const REQUIRED_GAME_ORDER: readonly RequiredGameId[] = [
  'typing',
  'snake',
  'shooter',
  'racing',
  'pinball',
] as const

export const BONUS_GAME_ID: BonusGameId = 'control-room'

export const ALL_GAME_IDS: readonly GameId[] = [
  ...REQUIRED_GAME_ORDER,
  BONUS_GAME_ID,
] as const

export interface GameCatalogEntry {
  id: GameId
  title: string
  shortTitle: string
  category: 'required' | 'bonus'
  socketIndex: number | null
  accentColor: string
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
    category: 'required',
    socketIndex: 0,
    accentColor: '#43E7F2',
    summaryLine: '60초 · 한글 입력 · 정확한 문구 10개 입력',
    expectedDurationLabel: '60초 (여유 75초)',
    controlsLabel: '한글 타이핑 · Enter 연결',
    clearConditionLabel: '정확한 공식 문구 10개 입력 (문구당 +100)',
    practiceGoalLabel: '공식 문구 1개를 입력하고 Enter로 케이블 연결하기',
    assistedDiffLabel: '라운드 제한 60초 → 75초, 문구 낙하 속도 80%로 완화',
    allowedModes: ['standard', 'assisted'],
  },
  snake: {
    id: 'snake',
    title: '단어 먹는 뱀',
    shortTitle: '단어 뱀',
    category: 'required',
    socketIndex: 1,
    accentColor: '#B9F66C',
    summaryLine: '최대 90초 · 방향키 이동 · 공식 문장 3개 완성',
    expectedDurationLabel: '최대 90초 (여유 120초)',
    controlsLabel: '방향키(↑↓←→) 격자 이동',
    clearConditionLabel: '4문장 중 서로 다른 공식 문장 3개 완성 (문장당 +300)',
    practiceGoalLabel: '방향키로 움직여 다음 정답 단어 조각 1개 먹기',
    assistedDiffLabel: '제한 시간 90초 → 120초, 뱀 이동 속도 80%로 완화',
    allowedModes: ['standard', 'assisted'],
  },
  shooter: {
    id: 'shooter',
    title: '가치 표적 슈팅',
    shortTitle: '표적 슈팅',
    category: 'required',
    socketIndex: 2,
    accentColor: '#FFBD64',
    summaryLine: '12문항 · ←→ 이동 / Space 발사 · 8문항 정답',
    expectedDurationLabel: '약 2~3분 (문항당 조준 6초)',
    controlsLabel: '←·→ 조준 이동 · Space 발사',
    clearConditionLabel: '12문항 중 8문항 이상 정답 명중 (정답 +100)',
    practiceGoalLabel: '설명 확인 후 조준을 시작해 정답 표적 1개 맞히기',
    assistedDiffLabel: '문항을 읽은 뒤 조준 제한 시간 6초 → 9초로 확대',
    allowedModes: ['standard', 'assisted'],
  },
  racing: {
    id: 'racing',
    title: '3D 케이블 터널 레이싱',
    shortTitle: '터널 레이싱',
    category: 'required',
    socketIndex: 3,
    accentColor: '#56A8FF',
    summaryLine: '75초 · ←→ 차선 / Space 부스터 · 종료 순점수 1,000점',
    expectedDurationLabel: '75초 (여유 105초)',
    controlsLabel: '←·→ 차선 변경 · Space 부스터(2회)',
    clearConditionLabel: '종료 시 순점수 1,000점 이상 (추월 +100, 충돌 −50)',
    practiceGoalLabel: '차선을 바꿔 전방 첫 차량을 충돌 없이 추월하기',
    assistedDiffLabel: '주행 시간 75초 → 105초, 자동 전진 속도 80%로 완화',
    allowedModes: ['standard', 'assisted'],
  },
  pinball: {
    id: 'pinball',
    title: 'C.O.R.E. 핀볼',
    shortTitle: 'C.O.R.E. 핀볼',
    category: 'required',
    socketIndex: 4,
    accentColor: '#FF6B9E',
    summaryLine: '최대 100초 · ←→ 플리퍼 / Space 발사 · C·O·R·E 1세트 완성',
    expectedDurationLabel: '최대 100초 (여유 125초)',
    controlsLabel: '←·→ 좌우 플리퍼 · Space 공 발사',
    clearConditionLabel: 'C·O·R·E 네 범퍼를 한 세트 이상 완성 (명중 +100, 세트 +500)',
    practiceGoalLabel: '켜진 안내 경로를 따라 플리퍼로 목표 범퍼 1개 맞히기',
    assistedDiffLabel: '제한 시간 100초 → 125초, 좌우 플리퍼 유효 길이 115% 확대',
    allowedModes: ['standard', 'assisted'],
  },
  'control-room': {
    id: 'control-room',
    title: '3D C.O.R.E. 관제실 탈출',
    shortTitle: '관제실 탈출',
    category: 'bonus',
    socketIndex: null,
    accentColor: '#A78BFA',
    summaryLine: '보너스 자유 탐색 · 가치 단서 4단계 복구 후 출구 작동',
    expectedDurationLabel: '약 3분 (자유 탐색)',
    controlsLabel: 'WASD/방향키 · 마우스/E/클릭 또는 패널 목록',
    clearConditionLabel: 'C·O·R·E 패널 4개 순서 복구 후 출구 작동 (관제등 점등)',
    practiceGoalLabel: '보너스 게임은 연습 없이 바로 관제실을 탐색합니다',
    assistedDiffLabel: '화면 우측 패널 목록으로 카메라 이동 없이 동일하게 진행 가능',
    allowedModes: ['standard'],
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

/**
 * KST (UTC+9) 날짜 변환 및 00:00 경계 계산
 */
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
